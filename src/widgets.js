// -----------------------------------------------------------------------------
// Dashboard widgets (pure functions: app.js reads Gmail, serves the contents
// and runs the buttons).
//
//   unread    the unread mails of the inbox or of a label: count, the newest
//             ones (sender, subject, date, snippet, link to Gmail), "Mark as
//             read" (gmail.modify only), "Refresh" and "Open Gmail".
//   vacation  the vacation responder: state, subject, dates, with a "Turn on"
//             form (subject, message, number of days, contacts only) and
//             "Turn off". Gladys 5.2.0+ for the form.
// -----------------------------------------------------------------------------

import { t, LANGUAGES } from './i18n.js';

const WIDGETS = { UNREAD: 'unread', VACATION: 'vacation' };
const WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  MARK_READ: 'mark_read',
  VACATION_ON: 'vacation_on',
  VACATION_OFF: 'vacation_off',
};
const TTL_SECONDS = { unread: 120, vacation: 300, message: 60 };
// Mails read for the card list (20 quota units each).
const MAX_ITEMS = 5;
const GMAIL_URL = 'https://mail.google.com/';
const MAX_DAYS = 365;

const clip = (text, max) => {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const allLanguages = (key, values) =>
  Object.fromEntries(LANGUAGES.map((lang) => [lang, t(key, lang, values)]));

/**
 * @description A content with a single message.
 * @param {string} message - The text.
 * @param {number} [ttl] - Its TTL.
 * @returns {object} The content.
 */
function messageContent(message, ttl = TTL_SECONDS.message) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: clip(message, 300) }],
  };
}

/**
 * @description A date and time in the language and time zone of the user.
 * @param {number} instant - Epoch ms.
 * @param {string} language - The language.
 * @param {string} [zone] - The time zone.
 * @returns {string} The text.
 */
function formatDateTime(instant, language, zone) {
  return new Intl.DateTimeFormat(language, {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

/**
 * @description The link to a thread in Gmail, in the right account.
 * @param {string} account - The address of the connected account ('' when unknown).
 * @param {string} threadId - The thread.
 * @returns {string} The URL.
 */
function threadUrl(account, threadId) {
  const query = account ? `?authuser=${encodeURIComponent(account)}` : '';
  return `${GMAIL_URL}mail/${query}#all/${encodeURIComponent(threadId)}`;
}

const refreshButton = () => ({
  type: 'button',
  label: allLanguages('buttonRefresh'),
  icon: 'refresh-cw',
  action: { key: WIDGET_ACTIONS.REFRESH },
});

/**
 * @description The `unread` widget.
 * @param {object} params - `{ labelName, count, mails, account, canModify, language }`.
 * @returns {object} The content.
 */
function buildUnreadWidget({ labelName, count, mails, account, canModify, language }) {
  const where = labelName === 'INBOX' ? t('inbox', language) : labelName;
  const components = [
    {
      type: 'value',
      label: t('tileUnread', language),
      value: count,
      icon: 'mail',
      color: count > 0 ? 'primary' : 'success',
    },
    { type: 'text', variant: 'caption', text: clip(where, 80) },
  ];
  if (mails.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: mails.slice(0, MAX_ITEMS).map((mail) => ({
        title: clip(
          `${mail.fromName || mail.fromAddress || '?'} · ${mail.subject || t('noSubject', language)}`,
          60,
        ),
        ...(mail.date ? { date: new Date(mail.date).toISOString() } : {}),
        ...(mail.important
          ? { badge: { text: t('badgeImportant', language), color: 'warning' } }
          : {}),
        ...(mail.snippet ? { description: clip(mail.snippet, 500) } : {}),
        ...(mail.threadId
          ? { links: [{ url: threadUrl(account, mail.threadId), label: t('openMail', language) }] }
          : {}),
      })),
    });
    if (count > mails.length) {
      components.push({
        type: 'text',
        variant: 'body',
        text: t('moreMails', language, { count: count - mails.length }),
      });
    }
  } else {
    components.push({ type: 'text', variant: 'body', text: t('noUnread', language) });
  }
  if (canModify && mails.length > 0) {
    components.push({
      type: 'button',
      label: allLanguages('buttonMarkRead'),
      icon: 'check',
      action: {
        key: WIDGET_ACTIONS.MARK_READ,
        params: { ids: mails.map((mail) => mail.id).join(',') },
      },
    });
  }
  components.push(refreshButton());
  components.push({
    type: 'button',
    label: allLanguages('buttonOpenGmail'),
    icon: 'external-link',
    link: { url: GMAIL_URL },
  });
  return { ttl_seconds: TTL_SECONDS.unread, components };
}

/**
 * @description The "Turn on" button and its form, prefilled with the current texts.
 * @param {object} vacation - describeVacation().
 * @returns {object} The button.
 */
function turnOnButton(vacation) {
  return {
    type: 'button',
    label: allLanguages('buttonVacationOn'),
    icon: 'sun',
    style: 'primary',
    action: {
      key: WIDGET_ACTIONS.VACATION_ON,
      fields: [
        {
          key: 'subject',
          type: 'string',
          label: allLanguages('fieldSubject'),
          ...(vacation.subject ? { default: clip(vacation.subject, 200) } : {}),
          placeholder: allLanguages('fieldSubjectPlaceholder'),
        },
        {
          key: 'message',
          type: 'string',
          label: allLanguages('fieldMessage'),
          ...(vacation.message ? { default: clip(vacation.message, 1000) } : {}),
          placeholder: allLanguages('fieldMessagePlaceholder'),
          required: true,
        },
        {
          key: 'days',
          type: 'number',
          label: allLanguages('fieldDays'),
          description: allLanguages('fieldDaysDescription'),
          min: 0,
          max: MAX_DAYS,
          default: 0,
        },
        {
          key: 'contacts_only',
          type: 'boolean',
          label: allLanguages('fieldContactsOnly'),
          default: vacation.contactsOnly,
        },
      ],
    },
  };
}

/**
 * @description The `vacation` widget.
 * @param {object} params - `{ vacation, language, zone }` (vacation: describeVacation()).
 * @returns {object} The content.
 */
function buildVacationWidget({ vacation, language, zone }) {
  let state = { key: 'vacationOff', color: 'neutral' };
  if (vacation.expired) {
    state = { key: 'vacationExpired', color: 'warning' };
  } else if (vacation.active) {
    state = { key: 'vacationOn', color: 'success' };
  } else if (vacation.enabled) {
    state = { key: 'vacationScheduled', color: 'info' };
  }
  const rows = [
    { label: t('rowState', language), value: t(state.key, language), color: state.color },
  ];
  if (vacation.enabled) {
    if (vacation.subject) {
      rows.push({ label: t('rowSubject', language), value: clip(vacation.subject, 40) });
    }
    if (vacation.start) {
      rows.push({
        label: t('rowFrom', language),
        value: formatDateTime(vacation.start, language, zone),
      });
    }
    rows.push({
      label: t('rowUntil', language),
      value: vacation.end ? formatDateTime(vacation.end, language, zone) : t('untilOff', language),
    });
    rows.push({
      label: t('rowRecipients', language),
      value: t(vacation.contactsOnly ? 'recipientsContacts' : 'recipientsEveryone', language),
    });
  }
  const components = [{ type: 'status', items: rows }];
  if (vacation.enabled && vacation.message) {
    components.push({ type: 'text', variant: 'body', text: clip(vacation.message, 300) });
  }
  components.push(turnOnButton(vacation));
  if (vacation.enabled) {
    components.push({
      type: 'button',
      label: allLanguages('buttonVacationOff'),
      icon: 'x',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.VACATION_OFF },
    });
  }
  components.push(refreshButton());
  return { ttl_seconds: TTL_SECONDS.vacation, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  TTL_SECONDS,
  MAX_ITEMS,
  MAX_DAYS,
  GMAIL_URL,
  messageContent,
  formatDateTime,
  threadUrl,
  buildUnreadWidget,
  buildVacationWidget,
};
