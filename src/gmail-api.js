// -----------------------------------------------------------------------------
// Gmail API v1 client (https://developers.google.com/workspace/gmail/api/reference/rest).
//
// Only documented methods and fields are used (quota units per call, from the
// "Usage limits" page):
//   - users.getProfile               GET  /users/me/profile                  1
//   - users.labels.list              GET  /users/me/labels                   1
//   - users.labels.get               GET  /users/me/labels/{id}              1
//   - users.history.list             GET  /users/me/history                  2
//                                    (startHistoryId, historyTypes, pageToken;
//                                    404 = cursor too old, sync again)
//   - users.messages.list            GET  /users/me/messages                 5
//                                    (labelIds, maxResults; no `q`: refused
//                                    with the gmail.metadata scope)
//   - users.messages.get             GET  /users/me/messages/{id}           20
//                                    (format=metadata, metadataHeaders)
//   - users.messages.send            POST /users/me/messages/send          100
//   - users.messages.modify          POST /users/me/messages/{id}/modify     5
//   - users.settings.getVacation     GET  /users/me/settings/vacation        1
//   - users.settings.updateVacation  PUT  /users/me/settings/vacation        5
//
// Every call is counted in quota units, times out after 15 s and retries once
// with a fresh token after a 401. Errors never carry a mail content.
// -----------------------------------------------------------------------------

const API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const REQUEST_TIMEOUT_MS = 15000;
// A safety net against a pagination loop: 20 pages of 500 history records.
const MAX_PAGES = 20;
const UNITS = {
  getProfile: 1,
  listLabels: 1,
  getLabel: 1,
  listHistory: 2,
  listMessages: 5,
  getMessage: 20,
  send: 100,
  modify: 5,
  getVacation: 1,
  updateVacation: 5,
};
const METADATA_HEADERS = ['From', 'To', 'Subject', 'Date'];

/** An error of the Gmail API. */
class GmailApiError extends Error {
  /**
   * @param {string} message - The message.
   * @param {object} [options] - `{ status, reason }`.
   */
  constructor(message, { status = 0, reason = '' } = {}) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
    this.reason = reason;
  }

  /** @returns {boolean} The per-minute or daily quota is exhausted. */
  get rateLimited() {
    return (
      this.status === 429 ||
      (this.status === 403 && /rateLimit|quota|userRateLimit/i.test(this.reason))
    );
  }

  /** @returns {boolean} The Gmail API is not enabled in the Cloud project. */
  get apiDisabled() {
    return this.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(this.reason);
  }

  /** @returns {boolean} The token lacks the scope of this call. */
  get insufficientScope() {
    return (
      this.status === 403 &&
      /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(this.reason)
    );
  }
}

/**
 * @description The Gmail API client.
 * @param {object} options - `{ tokens, fetchImpl, now }`.
 * @returns {object} The client.
 */
function createGmailClient({ tokens, fetchImpl, now = Date.now }) {
  let usage = { day: '', calls: 0, units: 0, last: 0 };

  /**
   * @description Count a call (per UTC day).
   * @param {number} units - Its quota units.
   */
  function count(units) {
    const day = new Date(now()).toISOString().slice(0, 10);
    const same = usage.day === day;
    usage = {
      day,
      calls: (same ? usage.calls : 0) + 1,
      units: (same ? usage.units : 0) + units,
      last: now(),
    };
  }

  /**
   * @description One authorized request.
   * @param {string} name - The method name (UNITS key).
   * @param {string} method - The HTTP method.
   * @param {string} path - The path under /users/me.
   * @param {object} [options] - `{ query, body }`; array query values repeat the key.
   * @returns {Promise<object>} The JSON answer ({} when empty).
   */
  async function request(name, method, path, { query, body } = {}) {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== null && item !== '') {
          url.searchParams.append(key, String(item));
        }
      }
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await tokens.getAccessToken(attempt > 0);
      count(UNITS[name] ?? 1);
      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new GmailApiError(`Gmail unreachable: ${err.message}`);
      }
      if (response.status === 401 && attempt === 0) {
        continue;
      }
      const text = await response.text().catch(() => '');
      let json;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (response.ok) {
        return json ?? {};
      }
      const error = json?.error ?? {};
      const reason = [
        error.status,
        ...(Array.isArray(error.errors) ? error.errors.map((e) => e?.reason) : []),
        ...(Array.isArray(error.details) ? error.details.map((d) => d?.reason) : []),
      ]
        .filter(Boolean)
        .join(',');
      throw new GmailApiError(
        `Gmail ${name}: HTTP ${response.status}${
          error.message ? ` (${String(error.message).slice(0, 160)})` : ''
        }`,
        { status: response.status, reason },
      );
    }
    throw new GmailApiError('Gmail refused the access token twice', { status: 401 });
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    UNITS,
    /** @returns {{ day: string, calls: number, units: number, last: number }} The usage of the day. */
    usage: () => ({ ...usage }),

    /** @returns {Promise<{ emailAddress: string, historyId: string }>} The profile. */
    getProfile: () => request('getProfile', 'GET', '/profile'),

    /** @returns {Promise<object[]>} Every label (`id`, `name`, `type`). */
    listLabels: async () => (await request('listLabels', 'GET', '/labels')).labels ?? [],

    /**
     * @param {string} labelId - The label id (INBOX, Label_12…).
     * @returns {Promise<object>} The label with its counters (`messagesUnread`…).
     */
    getLabel: (labelId) => request('getLabel', 'GET', `/labels/${id(labelId)}`),

    /**
     * @description The messages added since a history id, every page.
     * @param {string} startHistoryId - The cursor.
     * @returns {Promise<{ added: object[], historyId: string }>} The messages
     *   (`id`, `threadId`, `labelIds`) in chronological order, and the new cursor.
     */
    async listAddedMessages(startHistoryId) {
      const added = [];
      let pageToken;
      let historyId = String(startHistoryId);
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const answer = await request('listHistory', 'GET', '/history', {
          query: { startHistoryId, historyTypes: 'messageAdded', maxResults: 500, pageToken },
        });
        for (const record of answer.history ?? []) {
          for (const entry of record.messagesAdded ?? []) {
            if (entry?.message?.id) {
              added.push(entry.message);
            }
          }
        }
        if (answer.historyId) {
          historyId = String(answer.historyId);
        }
        pageToken = answer.nextPageToken;
        if (!pageToken) {
          break;
        }
      }
      return { added, historyId };
    },

    /**
     * @param {string[]} labelIds - Every label the messages must carry.
     * @param {number} maxResults - At most this many (newest first).
     * @returns {Promise<object[]>} `{ id, threadId }` items.
     */
    listMessages: async (labelIds, maxResults) =>
      (
        await request('listMessages', 'GET', '/messages', {
          query: { labelIds, maxResults },
        })
      ).messages ?? [],

    /**
     * @param {string} messageId - The message id.
     * @returns {Promise<object>} The message: id, threadId, labelIds, snippet
     *   (when the scope allows it), internalDate and the From/To/Subject/Date headers.
     */
    getMessage: (messageId) =>
      request('getMessage', 'GET', `/messages/${id(messageId)}`, {
        query: { format: 'metadata', metadataHeaders: METADATA_HEADERS },
      }),

    /**
     * @param {string} raw - The RFC 2822 message, base64url.
     * @returns {Promise<{ id: string, threadId: string }>} The sent message.
     */
    send: (raw) => request('send', 'POST', '/messages/send', { body: { raw } }),

    /**
     * @param {string} messageId - The message id.
     * @param {object} change - `{ addLabelIds, removeLabelIds }`.
     * @returns {Promise<object>} The message.
     */
    modify: (messageId, change) =>
      request('modify', 'POST', `/messages/${id(messageId)}/modify`, { body: change }),

    /** @returns {Promise<object>} The VacationSettings. */
    getVacation: () => request('getVacation', 'GET', '/settings/vacation'),

    /**
     * @param {object} settings - The VacationSettings.
     * @returns {Promise<object>} The stored VacationSettings.
     */
    updateVacation: (settings) =>
      request('updateVacation', 'PUT', '/settings/vacation', { body: settings }),
  };
}

export { API_BASE, UNITS, METADATA_HEADERS, GmailApiError, createGmailClient };
