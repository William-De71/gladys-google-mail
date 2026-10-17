// -----------------------------------------------------------------------------
// Configuration of the Google Mail integration.
//
// Fields of the config_schema:
//   - `client_id` / `client_secret`  the OAuth client ("Web application") the
//                                    user created in their own Google Cloud
//                                    project: never shipped with the image;
//   - `access`                       what Gladys may do with the mailbox, hence
//                                    the OAuth scopes asked at "Connect"
//                                    (auth.js, SCOPES_BY_ACCESS);
//   - `google_account`               the Connect button (oauth2 field);
//   - `poll_minutes`                 how often the mailbox history is read;
//   - `notification_subject`         subject of the Gladys notifications.
//
// Everything else the integration keeps (tokens, the pending OAuth request,
// the Gmail history cursor) lives in /data (store.js), never in the config.
// -----------------------------------------------------------------------------

const ACCESS = { SEND: 'send', METADATA: 'metadata', MODIFY: 'modify' };
// Minutes. Each reading costs 3 Gmail quota units (history.list + labels.get).
const POLL_MINUTES = { min: 1, max: 60, default: 2 };
const ACCOUNT_FIELD = 'google_account';
const DEFAULT_SUBJECT = 'Gladys';
const MAX_SUBJECT = 200;

/**
 * @description Read a bounded integer field, falling back to its default.
 * @param {unknown} raw - The raw value (the form can send numbers as strings).
 * @param {{ min: number, max: number, default: number }} bounds - The bounds.
 * @returns {number} The value.
 * @example
 * readNumber('6', POLL_MINUTES); // -> 6
 */
function readNumber(raw, bounds) {
  const value = Number(raw ?? bounds.default);
  if (raw === '' || raw === null || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/**
 * @description Read a trimmed string.
 * @param {unknown} raw - The raw value.
 * @returns {string} The string, '' when absent.
 * @example
 * readString(' abc '); // -> 'abc'
 */
function readString(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} The config.
 * @example
 * normalizeConfig({ client_id: 'abc' }).clientId; // -> 'abc'
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const subject = readString(config.notification_subject).replace(/[\r\n]+/g, ' ');
  return {
    clientId: readString(config.client_id),
    clientSecret: readString(config.client_secret),
    access: Object.values(ACCESS).includes(config.access) ? config.access : ACCESS.METADATA,
    pollMinutes: readNumber(config.poll_minutes, POLL_MINUTES),
    notificationSubject: (subject || DEFAULT_SUBJECT).slice(0, MAX_SUBJECT),
  };
}

export {
  ACCESS,
  POLL_MINUTES,
  ACCOUNT_FIELD,
  DEFAULT_SUBJECT,
  readNumber,
  readString,
  normalizeConfig,
};
