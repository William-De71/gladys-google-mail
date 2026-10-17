// Fakes for the tests: Google (OAuth token endpoint + Gmail API v1) behind a
// `fetch`, following the documented requests and resources. Tests never
// touch the network.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOKEN_URL, REVOKE_URL, SCOPES_BY_ACCESS } from '../../src/auth.js';
import { API_BASE } from '../../src/gmail-api.js';

// Saturday 17 October 2026, 10:00 in Paris (08:00 UTC).
const NOW = Date.parse('2026-10-17T08:00:00Z');
const TZ = 'Europe/Paris';
const CLIENT_ID = '123456789012-abcdefghij.apps.googleusercontent.com';
const CLIENT_SECRET = 'GOCSPX-test-secret';
const ACCOUNT = 'home@example.com';

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * @description A temporary data directory, removed after the test.
 * @param {object} t - The test context.
 * @returns {string} The directory.
 */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gladys-google-mail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @description A fake Google, as a `fetch`.
 * @param {object} clock - `{ now }`, shared with the app.
 * @param {object} [options] - `{ access }`: the scopes granted (an access level).
 * @returns {Function} The fetch, with `state` and helpers.
 */
function fakeGoogle(clock = { now: NOW }, { access = 'modify' } = {}) {
  const state = {
    grantedScope: SCOPES_BY_ACCESS[access].join(' '),
    historyId: 1000,
    history: [],
    expiredHistory: false,
    labels: [
      { id: 'INBOX', name: 'INBOX', type: 'system' },
      { id: 'UNREAD', name: 'UNREAD', type: 'system' },
      { id: 'SENT', name: 'SENT', type: 'system' },
      { id: 'DRAFT', name: 'DRAFT', type: 'system' },
      { id: 'SPAM', name: 'SPAM', type: 'system' },
      { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system' },
      { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system' },
      { id: 'CATEGORY_PROMOTIONS', name: 'CATEGORY_PROMOTIONS', type: 'system' },
      { id: 'Label_1', name: 'Factures', type: 'user' },
    ],
    messages: new Map(),
    vacation: {
      enableAutoReply: false,
      responseSubject: '',
      responseBodyPlainText: '',
      restrictToContacts: false,
      restrictToDomain: false,
    },
    sent: [],
    revoked: false,
    apiDisabled: false,
    calls: [],
    accessCount: 0,
    nextId: 1,
  };

  const json = (status, body) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const scopeOk = (needed) => needed.some((scope) => state.grantedScope.split(' ').includes(scope));
  const G = 'https://www.googleapis.com/auth/gmail.';
  const READ = [`${G}metadata`, `${G}modify`];
  const metadataOnly = () => !state.grantedScope.includes(`${G}modify`);

  /**
   * @description Add a message to the mailbox and its history (as Gmail does).
   * @param {object} message - `{ from, subject, labelIds, snippet, to }`.
   * @returns {object} The stored message.
   */
  function deliver({
    from,
    subject,
    labelIds = ['INBOX', 'UNREAD'],
    snippet = '',
    to = ACCOUNT,
    id,
  }) {
    const message = {
      id: id ?? `m${(state.nextId++).toString(16).padStart(4, '0')}`,
      threadId: `t${state.nextId}`,
      labelIds,
      snippet,
      internalDate: String(clock.now),
      payload: {
        headers: [
          { name: 'From', value: from },
          { name: 'To', value: to },
          { name: 'Subject', value: subject },
          { name: 'Date', value: new Date(clock.now).toUTCString() },
        ],
      },
    };
    state.messages.set(message.id, message);
    state.historyId += 7;
    state.history.push({
      id: String(state.historyId),
      messagesAdded: [{ message: { id: message.id, threadId: message.threadId, labelIds } }],
    });
    return message;
  }

  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const parsed = new URL(url);
    state.calls.push(`${method} ${parsed.pathname}${parsed.search}`);
    if (url === TOKEN_URL) {
      const form = new URLSearchParams(options.body);
      if (form.get('client_secret') !== CLIENT_SECRET) {
        return json(401, { error: 'invalid_client', error_description: 'Unauthorized' });
      }
      if (form.get('grant_type') === 'authorization_code') {
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) {
          return json(400, { error: 'invalid_grant', error_description: 'Bad Request' });
        }
        state.accessCount += 1;
        return json(200, {
          access_token: `access-${state.accessCount}`,
          expires_in: 3599,
          refresh_token: 'refresh-1',
          scope: state.grantedScope,
          token_type: 'Bearer',
        });
      }
      if (state.revoked) {
        return json(400, {
          error: 'invalid_grant',
          error_description: 'Token has been expired or revoked.',
        });
      }
      state.accessCount += 1;
      return json(200, {
        access_token: `access-${state.accessCount}`,
        expires_in: 3599,
        scope: state.grantedScope,
        token_type: 'Bearer',
      });
    }
    if (url === REVOKE_URL) {
      return json(200, {});
    }
    if (!url.startsWith(API_BASE)) {
      throw new Error(`Unexpected URL ${url}`);
    }
    if (!/^Bearer access-\d+$/.test(options.headers?.Authorization ?? '')) {
      return json(401, { error: { code: 401, message: 'Invalid Credentials' } });
    }
    if (state.apiDisabled) {
      return json(403, {
        error: {
          code: 403,
          message: 'Gmail API has not been used in project 1 before or it is disabled.',
          status: 'PERMISSION_DENIED',
          errors: [{ reason: 'accessNotConfigured' }],
        },
      });
    }
    const insufficient = () =>
      json(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      });
    const path = parsed.pathname.replace('/gmail/v1/users/me', '');
    const query = parsed.searchParams;
    if (method === 'GET' && path === '/profile') {
      if (!scopeOk(READ)) return insufficient();
      return json(200, { emailAddress: ACCOUNT, historyId: String(state.historyId) });
    }
    if (method === 'GET' && path === '/labels') {
      if (!scopeOk(READ)) return insufficient();
      return json(200, { labels: state.labels.map((label) => ({ ...label })) });
    }
    const label = /^\/labels\/([^/]+)$/.exec(path);
    if (method === 'GET' && label) {
      if (!scopeOk(READ)) return insufficient();
      const id = decodeURIComponent(label[1]);
      const found = state.labels.find((entry) => entry.id === id);
      if (!found) return json(404, { error: { code: 404, message: 'Not Found' } });
      const unread = [...state.messages.values()].filter(
        (m) => m.labelIds.includes(id) && m.labelIds.includes('UNREAD'),
      ).length;
      return json(200, { ...found, messagesUnread: unread });
    }
    if (method === 'GET' && path === '/history') {
      if (!scopeOk(READ)) return insufficient();
      if (state.expiredHistory) {
        state.expiredHistory = false;
        return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
      }
      const start = Number(query.get('startHistoryId'));
      assert(query.get('historyTypes') === 'messageAdded');
      const records = state.history.filter((record) => Number(record.id) > start);
      // Pages of 1 record to exercise the pagination.
      const offset = Number(query.get('pageToken') ?? 0);
      const page = records.slice(offset, offset + 1);
      return json(200, {
        ...(page.length ? { history: page } : {}),
        ...(offset + 1 < records.length ? { nextPageToken: String(offset + 1) } : {}),
        historyId: String(state.historyId),
      });
    }
    if (method === 'GET' && path === '/messages') {
      if (!scopeOk(READ)) return insufficient();
      if (query.get('q'))
        return json(403, { error: { code: 403, message: 'Metadata scope does not support q' } });
      const wanted = query.getAll('labelIds');
      const list = [...state.messages.values()]
        .filter((m) => wanted.every((id) => m.labelIds.includes(id)))
        .reverse()
        .slice(0, Number(query.get('maxResults') ?? 100));
      return json(200, { messages: list.map((m) => ({ id: m.id, threadId: m.threadId })) });
    }
    const message = /^\/messages\/([^/]+)(\/modify)?$/.exec(path);
    if (message && path !== '/messages/send') {
      const found = state.messages.get(decodeURIComponent(message[1]));
      if (method === 'GET') {
        if (!scopeOk(READ)) return insufficient();
        if (!found) return json(404, { error: { code: 404, message: 'Not Found' } });
        assert(query.get('format') === 'metadata');
        const copy = structuredClone(found);
        // The snippet is part of the body: not with gmail.metadata.
        if (metadataOnly()) delete copy.snippet;
        return json(200, copy);
      }
      if (method === 'POST' && message[2]) {
        if (!scopeOk([`${G}modify`])) return insufficient();
        if (!found) return json(404, { error: { code: 404, message: 'Not Found' } });
        const body = JSON.parse(options.body);
        found.labelIds = [
          ...found.labelIds.filter((id) => !(body.removeLabelIds ?? []).includes(id)),
          ...(body.addLabelIds ?? []).filter((id) => !found.labelIds.includes(id)),
        ];
        return json(200, { id: found.id, threadId: found.threadId, labelIds: found.labelIds });
      }
    }
    if (method === 'POST' && path === '/messages/send') {
      if (!scopeOk([`${G}send`, `${G}modify`])) return insufficient();
      const body = JSON.parse(options.body);
      const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
      const id = `s${(state.nextId++).toString(16).padStart(4, '0')}`;
      state.sent.push({ id, mime });
      // A mail sent to the account itself lands in its inbox, same id.
      if (/^To: .*home@example\.com/m.test(mime)) {
        deliver({ id, from: ACCOUNT, subject: 'to myself', labelIds: ['SENT', 'INBOX', 'UNREAD'] });
      }
      return json(200, { id, threadId: `t-${id}`, labelIds: ['SENT'] });
    }
    if (path === '/settings/vacation') {
      if (method === 'GET') {
        if (!scopeOk([`${G}settings.basic`, `${G}modify`])) return insufficient();
        return json(200, { ...state.vacation });
      }
      if (method === 'PUT') {
        if (!scopeOk([`${G}settings.basic`])) return insufficient();
        const body = JSON.parse(options.body);
        state.vacation = { ...body };
        return json(200, { ...state.vacation });
      }
    }
    return json(404, { error: { code: 404, message: 'Not Found' } });
  };

  /**
   * @param {boolean} condition - Must hold.
   */
  function assert(condition) {
    if (!condition) {
      throw new Error('Unexpected request');
    }
  }

  Object.assign(fetchImpl, {
    state,
    deliver,
    /** Read a message as on the phone. */
    read(id) {
      const found = state.messages.get(id);
      found.labelIds = found.labelIds.filter((label) => label !== 'UNREAD');
    },
    units: () => state.calls.filter((call) => call.includes('/gmail/v1')).length,
  });
  return fetchImpl;
}

export { NOW, TZ, CLIENT_ID, CLIENT_SECRET, ACCOUNT, silent, tempDir, fakeGoogle };
