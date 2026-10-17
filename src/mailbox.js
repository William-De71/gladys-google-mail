// -----------------------------------------------------------------------------
// Reading the mailbox: the new mails since the last reading, the labels and
// the unread counters.
//
// Gmail offers push notifications only through Cloud Pub/Sub (users.watch),
// out of reach of a container behind a home router: the history is read on a
// timer instead (users.history.list, 2 quota units, messageAdded only).
//
// - The cursor (`historyId`) is kept in /data: a restart resumes where it
//   stopped. The very first reading only takes the current cursor (a
//   baseline, no event); a 404 (cursor too old, "typically valid for at
//   least a week") takes a new baseline too, the mails in between are lost.
// - A new mail is kept when it reached the inbox or a user label (a Gmail
//   filter may skip the inbox): drafts, sent-only mails, spam, trash and
//   chats are ignored, and so are the mails sent by Gladys itself ("quiet"
//   ids: a scene sending a mail to its own account must not fire itself).
// - At most MAX_FETCH mails are read per reading (20 units each); the others
//   are only counted.
// -----------------------------------------------------------------------------

import { GmailApiError } from './gmail-api.js';
import { parseFrom, decodeHeader } from './mime.js';

const MAX_FETCH = 20;
// Labels are read again at most every hour (a new label is rare).
const LABELS_TTL_MS = 60 * 60 * 1000;
// A mail older than the baseline by more than this is an import, not a new mail.
const OLD_MAIL_MS = 24 * 60 * 60 * 1000;
const IGNORED = ['DRAFT', 'SPAM', 'TRASH', 'CHAT'];
const CATEGORIES = {
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
};
const QUIET_MAX = 200;

/**
 * @description Read a header of a metadata message.
 * @param {object} message - The message.
 * @param {string} name - The header name.
 * @returns {string} Its value ('' when absent).
 */
function headerOf(message, name) {
  const headers = message?.payload?.headers ?? [];
  const found = headers.find((header) => String(header?.name).toLowerCase() === name.toLowerCase());
  return decodeHeader(found?.value ?? '');
}

/**
 * @description Turn a Gmail metadata message into a mail.
 * @param {object} message - The message (format=metadata).
 * @param {Map<string, object>} labels - Labels by id.
 * @returns {object} The mail.
 */
function toMail(message, labels) {
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  const from = parseFrom(headerOf(message, 'From'));
  const userLabels = labelIds
    .map((labelId) => labels.get(labelId))
    .filter((label) => label?.type === 'user')
    .map((label) => label.name);
  const category = labelIds.map((labelId) => CATEGORIES[labelId]).find(Boolean) ?? 'primary';
  const internalDate = Number(message.internalDate);
  return {
    id: String(message.id),
    threadId: String(message.threadId ?? ''),
    from: headerOf(message, 'From'),
    fromName: from.name,
    fromAddress: from.address,
    to: headerOf(message, 'To'),
    subject: headerOf(message, 'Subject'),
    snippet: decodeHtmlEntities(String(message.snippet ?? '')),
    date: Number.isFinite(internalDate) && internalDate > 0 ? internalDate : 0,
    inbox: labelIds.includes('INBOX'),
    unread: labelIds.includes('UNREAD'),
    important: labelIds.includes('IMPORTANT'),
    starred: labelIds.includes('STARRED'),
    category,
    userLabels,
    // The label scenes filter on: the first user label, else INBOX.
    label: userLabels[0] ?? (labelIds.includes('INBOX') ? 'INBOX' : ''),
  };
}

/**
 * @description Gmail snippets carry HTML entities (&#39;, &amp;…).
 * @param {string} text - The snippet.
 * @returns {string} The text.
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&#(\d+);/g, (match, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * @description Whether an added message is a new mail worth an event.
 * @param {object} message - `{ labelIds }`.
 * @param {Map<string, object>} labels - Labels by id.
 * @returns {boolean} True for a received mail in the inbox or a user label.
 */
function isReceived(message, labels) {
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  if (labelIds.some((labelId) => IGNORED.includes(labelId))) {
    return false;
  }
  if (labelIds.includes('INBOX')) {
    return true;
  }
  if (labelIds.includes('SENT')) {
    return false;
  }
  return labelIds.some(
    (labelId) => labels.get(labelId)?.type === 'user' || /^Label_/.test(labelId),
  );
}

/**
 * @description The mailbox reader.
 * @param {object} options - `{ api, store, now, logger }`.
 * @returns {object} The reader.
 */
function createMailbox({ api, store, now, logger }) {
  let labels = new Map();
  let labelsAt = 0;
  let readAt = 0;
  let inboxUnread = null;
  let lastSkipped = 0;
  const quiet = new Set();

  /**
   * @description Read the labels when unknown or older than an hour.
   * @param {boolean} [force] - Even if fresh.
   * @returns {Promise<Map<string, object>>} Labels by id.
   */
  async function refreshLabels(force = false) {
    if (!force && labels.size > 0 && now() - labelsAt < LABELS_TTL_MS) {
      return labels;
    }
    const list = await api.listLabels();
    labels = new Map(list.map((label) => [String(label.id), label]));
    labelsAt = now();
    return labels;
  }

  /**
   * @description The label a name or id designates ('' = the inbox).
   * @param {string} nameOrId - As typed by the user.
   * @returns {Promise<object|null>} The label, or null when unknown.
   */
  async function findLabel(nameOrId) {
    const wanted = String(nameOrId ?? '').trim();
    if (!wanted) {
      return { id: 'INBOX', name: 'INBOX', type: 'system' };
    }
    for (const force of [false, true]) {
      const all = await refreshLabels(force);
      if (all.has(wanted)) {
        return all.get(wanted);
      }
      const lower = wanted.toLowerCase();
      const byName = [...all.values()].find((label) => String(label.name).toLowerCase() === lower);
      if (byName) {
        return byName;
      }
    }
    return null;
  }

  /**
   * @description Take the current cursor without any event.
   * @returns {Promise<void>}
   */
  async function baseline() {
    const profile = await api.getProfile();
    await store.save({
      history: { id: String(profile.historyId ?? ''), at: now(), account: '' },
    });
  }

  /**
   * @description Read what changed since the last reading.
   * @returns {Promise<{ mails: object[], baseline: boolean, skipped: number }>}
   *   The new mails (oldest first), whether this reading was a baseline, and
   *   how many new mails were only counted.
   */
  async function read() {
    const { history } = store.get();
    await refreshLabels();
    if (!history.id) {
      await baseline();
      inboxUnread = await readInboxUnread();
      readAt = now();
      return { mails: [], baseline: true, skipped: 0 };
    }
    let answer;
    try {
      answer = await api.listAddedMessages(history.id);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) {
        logger.warn(
          'The Gmail history cursor expired: new baseline, the mails in between are skipped',
        );
        await baseline();
        inboxUnread = await readInboxUnread();
        readAt = now();
        return { mails: [], baseline: true, skipped: 0 };
      }
      throw err;
    }
    const seen = new Set();
    const candidates = answer.added.filter((message) => {
      if (seen.has(message.id) || quiet.has(message.id)) {
        return false;
      }
      seen.add(message.id);
      return isReceived(message, labels);
    });
    const fetched = candidates.slice(-MAX_FETCH);
    const skipped = candidates.length - fetched.length;
    const mails = [];
    for (const message of fetched) {
      try {
        const full = await api.getMessage(message.id);
        // The labels may have changed since (read on the phone, archived…).
        if (!isReceived(full, labels) && !isReceived(message, labels)) {
          continue;
        }
        const mail = toMail(full, labels);
        if (mail.date && history.at && mail.date < history.at - OLD_MAIL_MS) {
          continue;
        }
        mails.push(mail);
      } catch (err) {
        // Deleted between the history and the reading: not a new mail anymore.
        if (err instanceof GmailApiError && err.status === 404) {
          continue;
        }
        throw err;
      }
    }
    if (skipped > 0) {
      logger.warn(`${skipped} new mail(s) only counted (more than ${MAX_FETCH} in one reading)`);
    }
    lastSkipped = skipped;
    await store.save({ history: { id: answer.historyId, at: now() } });
    inboxUnread = await readInboxUnread();
    readAt = now();
    return { mails, baseline: false, skipped };
  }

  /** @returns {Promise<number|null>} The unread mails of the inbox. */
  async function readInboxUnread() {
    const label = await api.getLabel('INBOX');
    const count = Number(label.messagesUnread);
    return Number.isFinite(count) ? count : null;
  }

  /**
   * @description The unread mails of a label: count and the newest ones.
   * @param {object} label - `{ id }`.
   * @param {number} max - How many mails to read (20 units each).
   * @returns {Promise<{ count: number, mails: object[] }>} The result.
   */
  async function unreadOf(label, max) {
    const info = await api.getLabel(label.id);
    const count = Number(info.messagesUnread) || 0;
    if (label.id === 'INBOX') {
      inboxUnread = count;
    }
    if (count === 0 || max <= 0) {
      return { count, mails: [] };
    }
    const ids = await api.listMessages([label.id, 'UNREAD'], max);
    const mails = [];
    for (const { id } of ids) {
      try {
        mails.push(toMail(await api.getMessage(id), labels));
      } catch (err) {
        if (!(err instanceof GmailApiError && err.status === 404)) {
          throw err;
        }
      }
    }
    return { count, mails };
  }

  return {
    read,
    findLabel,
    refreshLabels,
    unreadOf,
    /** @param {string} id - A message sent by Gladys: never an event. */
    quiet(id) {
      if (!id) {
        return;
      }
      quiet.add(String(id));
      if (quiet.size > QUIET_MAX) {
        quiet.delete(quiet.values().next().value);
      }
    },
    readAt: () => readAt,
    inboxUnread: () => inboxUnread,
    labelCount: () => labels.size,
    lastSkipped: () => lastSkipped,
    /** Forget everything in memory (disconnect, new account). */
    clear() {
      labels = new Map();
      labelsAt = 0;
      readAt = 0;
      inboxUnread = null;
      quiet.clear();
    },
  };
}

export { MAX_FETCH, CATEGORIES, headerOf, toMail, isReceived, createMailbox };
