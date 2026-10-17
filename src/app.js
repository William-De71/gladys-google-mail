// -----------------------------------------------------------------------------
// The Google Mail integration, wired to a Gladys client.
//
// `createApp(gladys)` registers every handler on the client it receives:
// `new GladysIntegration()` in production (index.js), the fake Gladys of the
// SDK in the tests. Nothing here connects: the caller does, once the
// handlers are registered.
//
// - Communication channel (send-only): the Gladys notifications of a user are
//   sent by mail, from the connected Gmail account, to the address the user
//   entered in "My account" (onSendMessage).
// - Mailbox reading (gmail.metadata or gmail.modify only): the history is
//   read every `poll_minutes` by an internal timer; each new mail fires the
//   `new_email` scene trigger, and the widgets are refreshed.
// - Vacation responder (gmail.settings.basic): scene actions and a widget.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { ACCOUNT_FIELD, normalizeConfig } from './config.js';
import {
  AuthError,
  SCOPES_BY_ACCESS,
  buildAuthorizeUrl,
  capabilitiesOf,
  createPkce,
  createTokenManager,
  exchangeCode,
  revokeToken,
} from './auth.js';
import { createGmailClient, GmailApiError } from './gmail-api.js';
import { createMailbox } from './mailbox.js';
import { createStore } from './store.js';
import { buildRawMessage, MailInputError } from './mime.js';
import {
  VacationInputError,
  DAY_MS,
  describeVacation,
  disableSettings,
  enableSettings,
  parseUserDate,
  safeTimeZone,
} from './vacation.js';
import { TRIGGERS, mailEventData } from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  MAX_ITEMS,
  MAX_DAYS,
  messageContent,
  buildUnreadWidget,
  buildVacationWidget,
} from './widgets.js';
import { t, all, each } from './i18n.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  DIAGNOSTIC: 'diagnostic',
  DISCONNECT: 'disconnect',
};
const SCENE_ACTIONS = {
  SEND_EMAIL: 'send_email',
  ENABLE_VACATION: 'enable_vacation',
  DISABLE_VACATION: 'disable_vacation',
  GET_UNREAD: 'get_unread',
  MODIFY_MESSAGE: 'modify_message',
};
const FORMATS = { TEXT: 'text', HTML: 'html' };

const MINUTE = 60 * 1000;
const RETRY_MS = 5 * MINUTE;
// The vacation settings are read again at most this often (1 unit).
const VACATION_TTL_MS = 10 * MINUTE;
// The unread list of a widget is read again at most this often, unless the
// mailbox changed (each refresh costs up to 6 + 20 × 5 units).
const UNREAD_TTL_MS = 10 * MINUTE;
const WIDGET_REFRESH_MIN_MS = 10 * 1000;
const MAX_LABEL_LENGTH = 225;

/**
 * @description Register the handlers of the integration on a Gladys client.
 * @param {object} gladys - The GladysIntegration instance (or the fake one).
 * @param {object} [options] - Options (tests).
 * @param {Function} [options.fetchImpl] - fetch.
 * @param {Function} [options.now] - Clock.
 * @param {string} [options.timeZone] - Time zone (default: TZ).
 * @param {string} [options.dataDir] - The writable directory (default /data).
 * @param {object} [options.logger] - Logger.
 * @returns {object} What the tests look into.
 */
export function createApp(
  gladys,
  {
    fetchImpl = fetch,
    now = Date.now,
    timeZone = process.env.TZ,
    dataDir = process.env.GLADYS_DATA_DIR || '/data',
    logger = sdkLogger,
  } = {},
) {
  const zone = safeTimeZone(timeZone);
  const store = createStore(dataDir);
  let config = normalizeConfig();
  let lastStatus = null;
  let pollTimer = null;
  let retryTimer = null;
  let starting = Promise.resolve();
  let queue = Promise.resolve();
  let lastError = null;
  let account = '';
  let vacation = { settings: null, at: 0 };
  let mailboxVersion = 0;
  const unreadCache = new Map();
  const widgetRefreshedAt = new Map();

  const tokens = createTokenManager({
    fetchImpl,
    now,
    getClient: () => ({ clientId: config.clientId, clientSecret: config.clientSecret }),
    saveTokens: (next) => store.save({ tokens: next }),
  });
  const api = createGmailClient({ tokens, fetchImpl, now });
  const mailbox = createMailbox({ api, store, now, logger });

  // --- Helpers ---------------------------------------------------------------------

  const connected = () => tokens.hasGrant() && !tokens.lost;
  const can = () => capabilitiesOf(tokens.tokens.scope);

  /**
   * @description The permissions of the chosen access level that the token lacks.
   * @returns {string[]} The missing scopes.
   */
  function missingScopes() {
    const granted = String(tokens.tokens.scope ?? '').split(/\s+/);
    return SCOPES_BY_ACCESS[config.access].filter((scope) => !granted.includes(scope));
  }

  /**
   * @description Run one Gmail operation at a time (the cursor is shared).
   * @param {Function} task - `async () => value`.
   * @returns {Promise<unknown>} Its result.
   */
  function exclusive(task) {
    const run = queue.catch(() => {}).then(task);
    queue = run.catch(() => {});
    return run;
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} isConnected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(isConnected, message) {
    const signature = JSON.stringify([isConnected, message]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(isConnected, message);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Ask Gladys to refresh a widget (at most once every 10 s).
   * @param {string} key - The widget key.
   */
  function refreshWidget(key) {
    const last = widgetRefreshedAt.get(key) ?? 0;
    if (now() - last < WIDGET_REFRESH_MIN_MS) {
      return;
    }
    widgetRefreshedAt.set(key, now());
    try {
      gladys.requestWidgetRefresh(key);
    } catch (err) {
      logger.debug?.(`Widget refresh not sent: ${err.message}`);
    }
  }

  /**
   * @description Publish a scene event, never failing the caller.
   * @param {string} key - The trigger.
   * @param {object} data - The data.
   */
  function fire(key, data) {
    logger.info(`Scene event ${key}`);
    gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Unable to publish the scene event ${key}: ${err.message}`));
  }

  /**
   * @description The connection message for the current capabilities.
   * @returns {object} The multi-language message.
   */
  function connectedMessage() {
    if (missingScopes().length > 0) {
      return all('statusMissingScopes');
    }
    const unread = mailbox.inboxUnread();
    if (can().read && Number.isFinite(unread)) {
      return all('statusConnectedRead', { account: account || '?', unread });
    }
    return all('statusConnectedSend', { account: account || '?' });
  }

  // --- Errors ----------------------------------------------------------------------------

  /**
   * @description Log an error and show it in the connection status.
   * @param {Error} err - The error.
   * @param {string} what - What failed.
   * @returns {Promise<void>}
   */
  async function handleError(err, what) {
    lastError = { at: now(), what, message: String(err.message).slice(0, 200) };
    if (err instanceof AuthError && err.reauth) {
      await handleAuthLost(err);
      return;
    }
    logger.warn(`${what} failed: ${err.message}`);
    if (err instanceof GmailApiError && err.apiDisabled) {
      await reportStatus(false, all('statusApiDisabled'));
    } else if (err instanceof GmailApiError && err.insufficientScope) {
      await reportStatus(true, all('statusMissingScopes'));
    } else if (err instanceof GmailApiError && err.rateLimited) {
      await reportStatus(true, all('statusQuota'));
    } else {
      await reportStatus(false, all('statusUnreachable'));
    }
  }

  /**
   * @description The Google access is dead (revoked, expired): stop calling
   * Google until the user connects again.
   * @param {Error} err - The error.
   * @returns {Promise<void>}
   */
  async function handleAuthLost(err) {
    logger.error(`Google access lost: ${err.message}. Click "Connect with Google" again.`);
    stopTimers();
    await reportStatus(false, all('statusReauth'));
    Object.values(WIDGETS).forEach(refreshWidget);
  }

  /**
   * @description The user-facing reason of a failed operation.
   * @param {Error} err - The error.
   * @returns {string} A TEXTS key.
   */
  function reasonKey(err) {
    if (err instanceof MailInputError) {
      return (
        { invalid_address: 'invalidAddress', no_recipient: 'noRecipient' }[err.code] ?? 'emptyMail'
      );
    }
    if (err instanceof VacationInputError) {
      return (
        { invalid_date: 'invalidDate', end_before_start: 'endBeforeStart' }[err.code] ??
        'emptyVacation'
      );
    }
    if (err instanceof AuthError) {
      return 'statusReauth';
    }
    if (err instanceof GmailApiError && err.insufficientScope) {
      return 'statusMissingScopes';
    }
    return 'actionFailed';
  }

  // --- Reading ---------------------------------------------------------------------------

  /**
   * @description Read the vacation settings when older than VACATION_TTL_MS.
   * @param {boolean} [force] - Even if fresh.
   * @returns {Promise<object|null>} The settings.
   */
  async function readVacation(force = false) {
    if (!can().settings) {
      return null;
    }
    if (force || !vacation.settings || now() - vacation.at > VACATION_TTL_MS) {
      vacation = { settings: await api.getVacation(), at: now() };
    }
    return vacation.settings;
  }

  /**
   * @description Read the mailbox and fire the events of the new mails.
   * @returns {Promise<boolean>} True when the reading succeeded.
   */
  function poll() {
    return exclusive(async () => {
      if (!connected()) {
        return false;
      }
      try {
        if (can().read) {
          if (!account) {
            account = String((await api.getProfile()).emailAddress ?? '');
          }
          const unreadBefore = mailbox.inboxUnread();
          const result = await mailbox.read();
          if (!result.baseline) {
            for (const mail of result.mails) {
              fire(TRIGGERS.NEW_EMAIL, mailEventData(mail, mailbox.inboxUnread()));
            }
          }
          if (result.mails.length > 0 || unreadBefore !== mailbox.inboxUnread()) {
            // New mails, or mails read elsewhere: the unread widget is stale.
            mailboxVersion += 1;
            refreshWidget(WIDGETS.UNREAD);
          }
        }
        const before = JSON.stringify(vacation.settings);
        await readVacation();
        lastError = null;
        await reportStatus(true, connectedMessage());
        if (before !== JSON.stringify(vacation.settings)) {
          refreshWidget(WIDGETS.VACATION);
        }
        return true;
      } catch (err) {
        await handleError(err, 'Reading Gmail');
        return false;
      }
    });
  }

  /** Stop the timers. */
  function stopTimers() {
    clearInterval(pollTimer);
    clearTimeout(retryTimer);
    pollTimer = null;
  }

  /**
   * @description Check the configuration, read, then read on a timer.
   * @returns {Promise<void>}
   */
  async function start() {
    stopTimers();
    if (!config.clientId || !config.clientSecret) {
      await reportStatus(false, all('statusNoClient'));
      return;
    }
    if (!tokens.hasGrant()) {
      await reportStatus(false, all('statusNotConnected'));
      return;
    }
    if (tokens.lost) {
      await reportStatus(false, all('statusReauth'));
      return;
    }
    const ok = await poll();
    if (!ok && tokens.lost) {
      return;
    }
    if (!ok && mailbox.readAt() === 0) {
      // Never read yet (Google unreachable at boot): try again soon.
      retryTimer = setTimeout(() => startIfReady().catch(() => {}), RETRY_MS);
      retryTimer.unref?.();
    }
    pollTimer = setInterval(() => poll().catch(() => {}), config.pollMinutes * MINUTE);
    pollTimer.unref?.();
  }

  /**
   * @description Start, one at a time.
   * @returns {Promise<void>}
   */
  function startIfReady() {
    starting = starting.catch(() => {}).then(start);
    return starting;
  }

  // --- OAuth2 ---------------------------------------------------------------------------

  gladys.onOAuthAuthorizeUrl(async (key, redirectUri) => {
    if (key !== ACCOUNT_FIELD) {
      throw new Error(`Unknown account field: ${key}`);
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error(t('statusNoClient', 'en'));
    }
    if (!redirectUri) {
      throw new Error('Gladys gave no redirect URI: update Gladys');
    }
    const { state, verifier, challenge } = createPkce();
    // Persisted: the container may restart between "Connect" and the return
    // from Google (the memory alone would then refuse a valid answer).
    await store.save({ pendingAuth: { state, verifier } });
    logger.info(
      `Google authorization started (access "${config.access}", redirect URI ${redirectUri})`,
    );
    return buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri,
      state,
      challenge,
      scopes: SCOPES_BY_ACCESS[config.access],
    });
  });

  gladys.onOAuthCallback(async (key, { code, state, redirectUri }) => {
    try {
      if (key !== ACCOUNT_FIELD) {
        throw new Error(`Unknown account field: ${key}`);
      }
      const expected = store.get().pendingAuth;
      if (!expected.state || expected.state !== state) {
        lastStatus = null;
        await reportStatus(false, all('connectState'));
        throw new Error('OAuth state mismatch');
      }
      const next = await exchangeCode({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        verifier: expected.verifier,
        redirectUri,
        fetchImpl,
        now,
      });
      await store.save({ pendingAuth: { state: '', verifier: '' } });
      await tokens.adopt({ ...next, clientId: config.clientId });
      // Maybe another Google account: start the history from scratch.
      await store.save({ history: { id: '', at: 0 } });
      mailbox.clear();
      account = '';
      vacation = { settings: null, at: 0 };
      unreadCache.clear();
      logger.info(`Connected to Gmail (${missingScopes().length} permission(s) missing)`);
      lastStatus = null;
      await startIfReady();
    } catch (err) {
      // The SDK turns the exception into a refused connection without
      // logging it: say why here.
      logger.error(`Google connection failed: ${err.message}`);
      if (err instanceof AuthError) {
        lastStatus = null;
        await reportStatus(
          false,
          err.code === 'scope_denied'
            ? all('connectScope')
            : all('connectFailed', { reason: err.code || 'error' }),
        );
      }
      throw err;
    }
  });

  // --- Communication: Gladys notifications by mail ----------------------------------------

  /**
   * @description Send a mail, never firing the new_email trigger for it.
   * @param {object} mail - buildRawMessage input.
   * @returns {Promise<{ id: string, threadId: string }>} The sent message.
   */
  async function sendMail(mail) {
    const { raw } = buildRawMessage(mail);
    return exclusive(async () => {
      const sent = await api.send(raw);
      mailbox.quiet(sent.id);
      return { id: String(sent.id ?? ''), threadId: String(sent.threadId ?? '') };
    });
  }

  /** @throws {Error} When Google is not connected. */
  function requireConnection() {
    if (!connected()) {
      throw new Error(
        tokens.lost
          ? 'Google revoked the access: click "Connect with Google" again'
          : 'Gmail is not connected: open the configuration of the integration',
      );
    }
  }

  /**
   * @description Fail clearly when the token lacks a capability.
   * @param {string} capability - send, settings, read or modify.
   */
  function requireCapability(capability) {
    requireConnection();
    if (!can()[capability]) {
      throw new Error(
        `This needs a Gmail permission that was not granted (${capability}): choose the access level in the configuration, then connect again`,
      );
    }
  }

  gladys.onSendMessage(async (contact, message) => {
    requireCapability('send');
    const to = String(contact?.email ?? '').trim();
    try {
      const sent = await sendMail({
        to,
        subject: config.notificationSubject,
        text: message?.text ?? '',
        image: message?.file ?? null,
      });
      logger.info(
        `Notification sent by mail (${message?.file ? 'with' : 'without'} an image, ${sent.id ? 'accepted' : 'no id'})`,
      );
    } catch (err) {
      lastError = {
        at: now(),
        what: 'Sending a notification',
        message: String(err.message).slice(0, 200),
      };
      logger.warn(`Notification not sent: ${err.message}`);
      if (err instanceof AuthError && err.reauth) {
        await handleAuthLost(err);
      }
      throw err;
    }
  });

  // --- Scene actions -----------------------------------------------------------------------
  // They never fire a scene event: the mails Gladys sends are quiet (mailbox.js),
  // and label changes are not new mails.

  gladys.onSceneAction(SCENE_ACTIONS.SEND_EMAIL, async (fields = {}) => {
    requireCapability('send');
    const sent = await sendMail({
      to: fields.to,
      cc: fields.cc,
      bcc: fields.bcc,
      subject: fields.subject ?? '',
      text: fields.body ?? '',
      html: fields.format === FORMATS.HTML,
    });
    logger.info('Mail sent from a scene');
    return { message_id: sent.id, thread_id: sent.threadId };
  });

  /**
   * @description Turn the vacation responder on.
   * @param {object} input - `{ subject, message, start, end, contactsOnly }` (epoch ms or null).
   * @returns {Promise<object>} describeVacation() of the stored settings.
   */
  async function turnVacationOn(input) {
    const settings = enableSettings(input);
    return exclusive(async () => {
      vacation = { settings: await api.updateVacation(settings), at: now() };
      refreshWidget(WIDGETS.VACATION);
      return describeVacation(vacation.settings, now());
    });
  }

  /**
   * @description Turn the vacation responder off (texts kept).
   * @returns {Promise<void>}
   */
  async function turnVacationOff() {
    await exclusive(async () => {
      const current = await readVacation(true);
      vacation = { settings: await api.updateVacation(disableSettings(current ?? {})), at: now() };
      refreshWidget(WIDGETS.VACATION);
    });
  }

  gladys.onSceneAction(SCENE_ACTIONS.ENABLE_VACATION, async (fields = {}) => {
    requireCapability('settings');
    const start = parseUserDate(fields.start, { now: now(), zone });
    const end = parseUserDate(fields.end, { now: now(), zone, endOfDay: true });
    const result = await turnVacationOn({
      subject: fields.subject,
      message: fields.message,
      start,
      end,
      contactsOnly: fields.contacts_only === true,
    });
    logger.info('Vacation responder turned on from a scene');
    return {
      start: result.start ? new Date(result.start).toISOString() : '',
      end: result.end ? new Date(result.end).toISOString() : '',
    };
  });

  gladys.onSceneAction(SCENE_ACTIONS.DISABLE_VACATION, async () => {
    requireCapability('settings');
    await turnVacationOff();
    logger.info('Vacation responder turned off from a scene');
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_UNREAD, async (fields = {}) => {
    requireCapability('read');
    const result = await exclusive(async () => {
      const label = await mailbox.findLabel(fields.label);
      if (!label) {
        throw new Error('Unknown Gmail label: type its name as shown in Gmail');
      }
      return mailbox.unreadOf(label, 1);
    });
    const latest = result.mails[0];
    return {
      count: result.count,
      latest_from: latest ? latest.fromName || latest.fromAddress : '',
      latest_subject: latest?.subject ?? '',
      latest_message_id: latest?.id ?? '',
    };
  });

  gladys.onSceneAction(SCENE_ACTIONS.MODIFY_MESSAGE, async (fields = {}) => {
    requireCapability('modify');
    const messageId = String(fields.message_id ?? '').trim();
    if (!/^[0-9a-zA-Z]+$/.test(messageId)) {
      throw new Error('Give the message ID of a mail (the "Message ID" variable of the trigger)');
    }
    await exclusive(async () => {
      const add = [];
      const remove = [];
      if (fields.mark_read !== false) {
        remove.push('UNREAD');
      }
      if (fields.archive === true) {
        remove.push('INBOX');
      }
      const wanted = String(fields.add_label ?? '')
        .trim()
        .slice(0, MAX_LABEL_LENGTH);
      if (wanted) {
        const label = await mailbox.findLabel(wanted);
        if (!label || label.type !== 'user') {
          throw new Error('Unknown Gmail label: create it in Gmail first, then type its name');
        }
        add.push(label.id);
      }
      if (add.length === 0 && remove.length === 0) {
        return;
      }
      await api.modify(messageId, { addLabelIds: add, removeLabelIds: remove });
      mailboxVersion += 1;
    });
    refreshWidget(WIDGETS.UNREAD);
  });

  // --- Dashboard widgets ----------------------------------------------------------------

  /**
   * @description The unread mails of a label, cached until the mailbox changes.
   * @param {object} label - The label.
   * @returns {Promise<{ count: number, mails: object[] }>} The result.
   */
  async function cachedUnread(label) {
    const cached = unreadCache.get(label.id);
    const fresh = cached && cached.version === mailboxVersion && now() - cached.at < UNREAD_TTL_MS;
    if (fresh) {
      return cached.result;
    }
    const result = await exclusive(() => mailbox.unreadOf(label, MAX_ITEMS));
    unreadCache.set(label.id, { result, at: now(), version: mailboxVersion });
    return result;
  }

  gladys.onWidgetGet(WIDGETS.UNREAD, async ({ settings = {}, language }) => {
    if (!connected()) {
      return messageContent(t(tokens.lost ? 'statusReauth' : 'notConnected', language));
    }
    if (!can().read) {
      return messageContent(t('needsRead', language));
    }
    try {
      const label = await exclusive(() => mailbox.findLabel(settings.label));
      if (!label) {
        return messageContent(
          t('unknownLabel', language, { label: String(settings.label).slice(0, 60) }),
        );
      }
      const { count, mails } = await cachedUnread(label);
      return buildUnreadWidget({
        labelName: label.name,
        count,
        mails,
        account,
        canModify: can().modify,
        language,
      });
    } catch (err) {
      await handleError(err, 'Reading the unread mails');
      return messageContent(t(reasonKey(err), language));
    }
  });

  gladys.onWidgetAction(WIDGETS.UNREAD, async (actionKey, params = {}) => {
    if (actionKey === WIDGET_ACTIONS.REFRESH) {
      unreadCache.clear();
      const ok = await poll();
      return ok ? all('refreshDone') : all('refreshFailed');
    }
    if (actionKey !== WIDGET_ACTIONS.MARK_READ) {
      throw new Error(`Unknown action ${actionKey}`);
    }
    if (!connected() || !can().modify) {
      return all(connected() ? 'needsModify' : 'notConnected');
    }
    const ids = String(params.ids ?? '')
      .split(',')
      .filter((id) => /^[0-9a-zA-Z]+$/.test(id))
      .slice(0, MAX_ITEMS);
    try {
      await exclusive(async () => {
        for (const id of ids) {
          await api.modify(id, { removeLabelIds: ['UNREAD'] });
        }
      });
      mailboxVersion += 1;
      unreadCache.clear();
      return all('markedRead', { count: ids.length });
    } catch (err) {
      await handleError(err, 'Marking as read');
      return all(reasonKey(err));
    }
  });

  gladys.onWidgetGet(WIDGETS.VACATION, async ({ language }) => {
    if (!connected()) {
      return messageContent(t(tokens.lost ? 'statusReauth' : 'notConnected', language));
    }
    if (!can().settings) {
      return messageContent(t('needsSettings', language));
    }
    try {
      const settings = await exclusive(() => readVacation());
      return buildVacationWidget({
        vacation: describeVacation(settings ?? {}, now()),
        language,
        zone,
      });
    } catch (err) {
      await handleError(err, 'Reading the vacation responder');
      return messageContent(t(reasonKey(err), language));
    }
  });

  gladys.onWidgetAction(WIDGETS.VACATION, async (actionKey, params, { values } = {}) => {
    if (!connected() || !can().settings) {
      return all(connected() ? 'needsSettings' : 'notConnected');
    }
    try {
      if (actionKey === WIDGET_ACTIONS.REFRESH) {
        await exclusive(() => readVacation(true));
        return all('refreshDone');
      }
      if (actionKey === WIDGET_ACTIONS.VACATION_ON) {
        const days = Math.min(MAX_DAYS, Math.max(0, Math.round(Number(values?.days) || 0)));
        const result = await turnVacationOn({
          subject: values?.subject,
          message: values?.message,
          start: null,
          end: days > 0 ? now() + days * DAY_MS : null,
          contactsOnly: values?.contacts_only === true,
        });
        return result.end ? all('vacationOnUntil', { days }) : all('vacationOnDone');
      }
      if (actionKey === WIDGET_ACTIONS.VACATION_OFF) {
        await turnVacationOff();
        return all('vacationOffDone');
      }
    } catch (err) {
      if (!(err instanceof VacationInputError)) {
        await handleError(err, 'Changing the vacation responder');
      }
      return all(reasonKey(err));
    }
    throw new Error(`Unknown action ${actionKey}`);
  });

  // --- Configuration screen actions -------------------------------------------------------

  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    if (!config.clientId || !config.clientSecret) {
      return all('statusNoClient');
    }
    if (!tokens.hasGrant()) {
      return all('statusNotConnected');
    }
    if (tokens.lost) {
      return all('statusReauth');
    }
    const ok = await poll();
    if (!ok) {
      if (tokens.lost) {
        return all('statusReauth');
      }
      return each((lang) => `${t('refreshFailed', lang)} ${lastError?.message ?? ''}`.trim());
    }
    const capabilities = can();
    const allowed = ['send', 'settings', 'read', 'modify'].filter((name) => capabilities[name]);
    return each((lang) =>
      t('testResult', lang, {
        account: account || t('accountHidden', lang),
        allowed: allowed.map((name) => t(`can_${name}`, lang)).join(', '),
        units: api.usage().units,
      }),
    );
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    // Gladys passes no DEBUG variable to the container: this writes an
    // anonymized summary in the logs (Settings -> Supervision) instead. No
    // token, no address, no mail content.
    const token = tokens.tokens;
    const iso = (instant) => (instant ? new Date(instant).toISOString() : 'never');
    const usage = api.usage();
    const { history } = store.get();
    logger.info(`[diagnostic] gladys-google-mail ${version}, Node ${process.version}`);
    logger.info(
      `[diagnostic] client ID ${config.clientId ? `set (${config.clientId.length} characters, ${config.clientId.endsWith('.apps.googleusercontent.com') ? 'Google format' : 'UNEXPECTED format'})` : 'missing'}, secret ${config.clientSecret ? 'set' : 'missing'}; access level ${config.access}; connected ${connected()}, access lost ${tokens.lost}`,
    );
    logger.info(
      `[diagnostic] granted: ${JSON.stringify(can())}, missing scopes ${missingScopes().length}; access token until ${iso(token.expiresAt)}, refresh token ${token.refreshToken ? 'present' : 'absent'}, pending authorization ${Boolean(store.get().pendingAuth.state)}`,
    );
    logger.info(
      `[diagnostic] every ${config.pollMinutes} min, last reading ${iso(mailbox.readAt())}, history cursor ${history.id ? 'set' : 'none'} (${iso(history.at)}), ${mailbox.labelCount()} label(s), inbox unread ${mailbox.inboxUnread() ?? '-'}, last skipped ${mailbox.lastSkipped()}, time zone ${zone ?? 'system'}`,
    );
    logger.info(
      `[diagnostic] ${usage.calls} API call(s), ${usage.units} quota unit(s) on ${usage.day || '-'} (UTC), last ${iso(usage.last)}; last error ${lastError ? `${lastError.what} at ${iso(lastError.at)}: ${lastError.message}` : 'none'}`,
    );
    return all('diagnosticDone');
  });

  gladys.onAction(ACTIONS.DISCONNECT, async () => {
    stopTimers();
    const { refreshToken } = tokens.tokens;
    const revoked = await revokeToken(refreshToken, fetchImpl);
    logger.info(`Disconnected from Google (revocation ${revoked ? 'confirmed' : 'not confirmed'})`);
    await tokens.clear();
    await store.save({ history: { id: '', at: 0 } });
    mailbox.clear();
    account = '';
    vacation = { settings: null, at: 0 };
    unreadCache.clear();
    lastStatus = null;
    await reportStatus(false, all('statusNotConnected'));
    Object.values(WIDGETS).forEach(refreshWidget);
    return all('disconnected');
  });

  // --- Configuration ------------------------------------------------------------------------

  /**
   * @description Reload the config.
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      config = normalizeConfig(await gladys.getConfig());
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  const signatureOf = () =>
    JSON.stringify([config.clientId, config.clientSecret, config.pollMinutes, config.access]);

  gladys.onConfigUpdated(async (rawConfig) => {
    const before = signatureOf();
    const clientBefore = config.clientId;
    await loadConfig(rawConfig);
    if (clientBefore && clientBefore !== config.clientId && tokens.hasGrant()) {
      // The tokens belong to the previous OAuth client.
      logger.info('Client ID changed: connect again');
      await tokens.clear();
      mailbox.clear();
    }
    if (before !== signatureOf()) {
      lastStatus = null;
      await startIfReady();
    }
  });

  // --- Connection lifecycle -----------------------------------------------------------------

  gladys.on('connected', async () => {
    await loadConfig();
    const stored = await store.load();
    tokens.setTokens(stored.tokens);
    if (stored.tokens.clientId && config.clientId && stored.tokens.clientId !== config.clientId) {
      logger.info('The stored tokens belong to another Client ID: connect again');
      await tokens.clear();
    }
    lastStatus = null;
    await startIfReady();
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopTimers();
  });

  return {
    store,
    tokens,
    api,
    mailbox,
    poll,
    stop: stopTimers,
    idle: () => queue,
  };
}

export { ACTIONS, SCENE_ACTIONS, FORMATS };
