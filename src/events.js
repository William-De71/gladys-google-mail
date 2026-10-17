// -----------------------------------------------------------------------------
// Scene triggers and their event data.
//
// `new_email`: a mail reached the inbox or a user label. The core filters the
// scenes on the declared fields by equality (`from_address`, `label`) or
// membership (`category`): the values are therefore normalized here
// (lower-cased address, label name as shown in Gmail, category key).
// -----------------------------------------------------------------------------

const TRIGGERS = { NEW_EMAIL: 'new_email' };
// Bounds of an event value (the host API refuses longer strings).
const MAX_VALUE = 1000;

const clip = (text) => {
  const value = String(text ?? '');
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
};

/**
 * @description The data of a `new_email` event (flat, scalar values).
 * @param {object} mail - A mail of mailbox.js.
 * @param {number|null} inboxUnread - The unread mails of the inbox after it.
 * @returns {object} The data.
 */
function mailEventData(mail, inboxUnread) {
  return {
    from_address: clip(mail.fromAddress),
    from_name: clip(mail.fromName),
    from: clip(mail.from),
    to: clip(mail.to),
    subject: clip(mail.subject),
    snippet: clip(mail.snippet),
    label: clip(mail.label),
    labels: clip(mail.userLabels.join(', ')),
    category: mail.category,
    important: mail.important,
    date: mail.date ? new Date(mail.date).toISOString() : null,
    message_id: mail.id,
    thread_id: mail.threadId,
    inbox_unread: Number.isFinite(inboxUnread) ? inboxUnread : null,
  };
}

export { TRIGGERS, mailEventData };
