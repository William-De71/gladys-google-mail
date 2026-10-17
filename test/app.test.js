// The whole integration against the fake Gladys of the SDK and a fake Google.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS, SCENE_ACTIONS } from '../src/app.js';
import { WIDGETS, WIDGET_ACTIONS } from '../src/widgets.js';
import { TRIGGERS } from '../src/events.js';
import { SCOPES, SCOPES_BY_ACCESS } from '../src/auth.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  fakeGoogle,
  silent,
  tempDir,
  NOW,
  TZ,
  CLIENT_ID,
  CLIENT_SECRET,
  ACCOUNT,
} from './helpers/fakes.js';

const REDIRECT = 'https://my.gladysassistant.com/redirect/oauth';
const CLIENT = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
const MINUTE = 60000;

/**
 * @description Write connected tokens in a data directory.
 * @param {string} dir - The directory.
 * @param {string} access - The access level of the granted scopes.
 * @param {object} [history] - The stored cursor.
 */
function seedTokens(dir, access, history = { id: '', at: 0 }) {
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({
      tokens: {
        accessToken: 'access-0',
        refreshToken: 'refresh-1',
        expiresAt: NOW + 3600000,
        clientId: CLIENT_ID,
        scope: SCOPES_BY_ACCESS[access].join(' '),
      },
      history,
    }),
  );
}

/**
 * @description The integration on a fake Gladys and a fake Google.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, access, connected, dir, clock, google, logger }`.
 * @returns {Promise<object>} `{ gladys, app, google, clock, dir }`.
 */
async function startApp(
  t,
  {
    config = { ...CLIENT, access: 'modify' },
    access = config.access ?? 'metadata',
    connected = true,
    dir = tempDir(t),
    clock = { now: NOW },
    google,
    logger = silent,
  } = {},
) {
  if (connected) {
    seedTokens(dir, access);
  }
  const fetchImpl = google ?? fakeGoogle(clock, { access });
  const gladys = createFakeGladys({ config: { ...config } });
  const app = createApp(gladys, {
    fetchImpl,
    now: () => clock.now,
    timeZone: TZ,
    dataDir: dir,
    logger,
  });
  await gladys.connect();
  await app.idle();
  t.after(() => {
    app.stop();
    gladys.fake.shutdown();
  });
  return { gladys, app, google: fetchImpl, clock, dir };
}

const eventsOf = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const assertValid = (content) => assert.deepEqual(validateWidgetContent(content), []);
const stateFile = (dir) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('without a client, then without a connection: says what to do, calls nothing', async (t) => {
  const first = await startApp(t, { config: {}, connected: false });
  assert.equal(first.gladys.fake.connectionStatus.connected, false);
  assert.match(first.gladys.fake.connectionStatus.message.fr, /Client ID/);
  const second = await startApp(t, { config: CLIENT, connected: false });
  assert.match(second.gladys.fake.connectionStatus.message.en, /Connect with Google/);
  assert.equal(second.google.state.calls.length, 0);
});

test('OAuth: scopes of the access level, state persisted in /data, PKCE, baseline without event', async (t) => {
  const { gladys, google, dir, app } = await startApp(t, {
    config: { ...CLIENT, access: 'metadata' },
    connected: false,
  });
  const ack = await gladys.fake.oauthAuthorizeUrl('google_account', REDIRECT);
  const url = new URL(ack.data.authorize_url);
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(url.searchParams.get('scope').split(' '), [
    SCOPES.SEND,
    SCOPES.SETTINGS,
    SCOPES.METADATA,
  ]);
  const state = url.searchParams.get('state');
  assert.equal(stateFile(dir).pendingAuth.state, state, 'kept in /data across a restart');

  const wrong = await gladys.fake.oauthCallback('google_account', {
    code: 'good-code',
    state: 'forged',
    redirectUri: REDIRECT,
  });
  assert.ok(wrong.error);

  google.deliver({ from: 'Old <old@example.com>', subject: 'Before the connection' });
  const ok = await gladys.fake.oauthCallback('google_account', {
    code: 'good-code',
    state,
    redirectUri: REDIRECT,
  });
  assert.equal(ok.error, undefined);
  await app.idle();
  const saved = stateFile(dir);
  assert.equal(saved.tokens.refreshToken, 'refresh-1');
  assert.equal(saved.pendingAuth.state, '');
  assert.equal(saved.history.id, String(google.state.historyId), 'baseline cursor');
  assert.equal(gladys.fake.config.refresh_token, undefined, 'no token in the Gladys config');
  assert.equal(eventsOf(gladys, TRIGGERS.NEW_EMAIL).length, 0, 'baseline: no event');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /home@example\.com.*1 unread/);
});

test('new mails fire one event each, filtered like Gmail shows them, cursor kept in /data', async (t) => {
  const { gladys, google, app, dir } = await startApp(t);
  google.deliver({
    from: '"EDF" <Factures@EDF.fr>',
    subject: 'Votre facture',
    snippet: 'Montant : 42 &euro; l&#39;échéance',
    labelIds: ['INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'Label_1'],
  });
  google.deliver({
    from: 'Shop <news@shop.example>',
    subject: 'Sale',
    labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
  });
  google.deliver({ from: ACCOUNT, subject: 'draft', labelIds: ['DRAFT'] });
  google.deliver({ from: ACCOUNT, subject: 'sent', labelIds: ['SENT'] });
  google.deliver({ from: 'x@spam.example', subject: 'spam', labelIds: ['SPAM', 'UNREAD'] });
  google.deliver({
    from: 'Bank <bank@example.com>',
    subject: 'Filed',
    labelIds: ['Label_1', 'UNREAD'],
  });
  assert.equal(await app.poll(), true);
  await settle();
  const events = eventsOf(gladys, TRIGGERS.NEW_EMAIL);
  assert.deepEqual(
    events.map((event) => event.data.subject),
    ['Votre facture', 'Sale', 'Filed'],
  );
  const [bill, sale, filed] = events.map((event) => event.data);
  assert.equal(bill.from_address, 'factures@edf.fr');
  assert.equal(bill.from_name, 'EDF');
  assert.equal(bill.label, 'Factures');
  assert.equal(bill.category, 'primary');
  assert.equal(bill.important, true);
  assert.equal(bill.snippet, "Montant : 42 &euro; l'échéance");
  assert.equal(sale.label, 'INBOX');
  assert.equal(sale.category, 'promotions');
  assert.equal(filed.label, 'Factures');
  for (const { data } of events) {
    assert.ok(Object.keys(data).length <= 30);
    for (const value of Object.values(data)) {
      assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
      assert.ok(typeof value !== 'string' || value.length <= 1000);
    }
  }
  assert.equal(stateFile(dir).history.id, String(google.state.historyId));
  assert.equal(await app.poll(), true);
  await settle();
  assert.equal(eventsOf(gladys, TRIGGERS.NEW_EMAIL).length, 3, 'never twice');
});

test('a restart resumes from the stored cursor; an expired cursor is a new baseline', async (t) => {
  const dir = tempDir(t);
  const clock = { now: NOW };
  const google = fakeGoogle(clock, { access: 'modify' });
  const first = await startApp(t, { dir, google, clock });
  first.app.stop();
  first.gladys.fake.shutdown();
  google.deliver({ from: 'a@example.com', subject: 'While stopped' });
  const gladys = createFakeGladys({ config: { ...CLIENT, access: 'modify' } });
  const app = createApp(gladys, {
    fetchImpl: google,
    now: () => clock.now,
    timeZone: TZ,
    dataDir: dir,
    logger: silent,
  });
  await gladys.connect();
  await app.idle();
  t.after(() => {
    app.stop();
    gladys.fake.shutdown();
  });
  await settle();
  assert.deepEqual(
    eventsOf(gladys, TRIGGERS.NEW_EMAIL).map((e) => e.data.subject),
    ['While stopped'],
  );

  google.deliver({ from: 'b@example.com', subject: 'Lost' });
  google.state.expiredHistory = true;
  assert.equal(await app.poll(), true);
  await settle();
  assert.equal(eventsOf(gladys, TRIGGERS.NEW_EMAIL).length, 1, 'no event on a new baseline');
  assert.equal(stateFile(dir).history.id, String(google.state.historyId));
});

test('send_email: recipients, encoded subject, HTML; a mail to itself fires no event', async (t) => {
  const { gladys, google, app } = await startApp(t);
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_EMAIL, {
    to: `${ACCOUNT}, Bob <bob@example.com>`,
    cc: 'carol@example.com',
    subject: 'Alarme déclenchée\r\nBcc: evil@example.com',
    body: '<p>Porte <b>ouverte</b></p>',
    format: 'html',
  });
  assert.equal(ack.error, undefined, ack.error);
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), ['message_id', 'thread_id']);
  const { mime } = google.state.sent[0];
  assert.match(mime, /^To: home@example\.com, bob@example\.com$/m);
  assert.match(mime, /^Cc: carol@example\.com$/m);
  assert.doesNotMatch(mime, /^Bcc:/m, 'no header injection');
  assert.match(mime, /^Subject: =\?UTF-8\?B\?/m);
  assert.match(mime, /multipart\/alternative/);
  assert.equal(await app.poll(), true);
  await settle();
  assert.equal(eventsOf(gladys, TRIGGERS.NEW_EMAIL).length, 0, 'quiet: sent by Gladys');

  const bad = await gladys.fake.sceneAction(SCENE_ACTIONS.SEND_EMAIL, {
    to: 'not an address',
    subject: 'x',
    body: 'y',
  });
  assert.match(bad.error, /Invalid email address/);
});

test('notifications: sent to the address of the user, with the configured subject and image', async (t) => {
  const { gladys, google } = await startApp(t, {
    config: { ...CLIENT, access: 'send', notification_subject: 'Maison' },
  });
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  const ack = await gladys.fake.sendMessage(
    { email: 'alice@example.com' },
    { text: 'Le lave-linge a terminé', file: png },
  );
  assert.equal(ack.error, undefined, ack.error);
  const { mime } = google.state.sent[0];
  assert.match(mime, /^To: alice@example\.com$/m);
  assert.match(mime, /^Subject: Maison$/m);
  assert.match(mime, /multipart\/mixed/);
  assert.match(mime, /Content-Type: image\/png; name="image\.png"/);
  const empty = await gladys.fake.sendMessage({ email: 'nope' }, { text: 'x', file: null });
  assert.ok(empty.error);
});

test('send-only access: no reading at all, widgets and actions say what is missing', async (t) => {
  const { gladys, google } = await startApp(t, { config: { ...CLIENT, access: 'send' } });
  assert.equal(
    google.state.calls.filter((call) => /history|labels|messages|profile/.test(call)).length,
    0,
  );
  assert.match(gladys.fake.connectionStatus.message.en, /sending and vacation/);
  const widget = await gladys.fake.widgetGet(WIDGETS.UNREAD, { language: 'fr' });
  assert.match(widget.data.content.components[0].text, /lecture/);
  const action = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_UNREAD, {});
  assert.match(action.error, /not granted/);
  const vacation = await gladys.fake.widgetGet(WIDGETS.VACATION, { language: 'en' });
  assertValid(vacation.data.content);
});

test('a permission unticked at Google is reported, the access level asks to reconnect', async (t) => {
  const { gladys } = await startApp(t, {
    config: { ...CLIENT, access: 'modify' },
    access: 'metadata',
  });
  assert.match(gladys.fake.connectionStatus.message.en, /did not grant every permission/);
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.MODIFY_MESSAGE, { message_id: 'm0001' });
  assert.match(ack.error, /not granted \(modify\)/);
});

test('vacation responder: dates in the time zone of Gladys, off keeps the texts', async (t) => {
  const { gladys, google } = await startApp(t);
  const on = await gladys.fake.sceneAction(SCENE_ACTIONS.ENABLE_VACATION, {
    subject: 'Absent',
    message: 'De retour lundi.',
    start: '2026-10-24',
    end: '26/10/2026',
    contacts_only: true,
  });
  assert.equal(on.error, undefined, on.error);
  assert.deepEqual(on.data.outputs, {
    start: '2026-10-23T22:00:00.000Z',
    end: '2026-10-26T22:59:00.000Z',
  });
  assert.equal(google.state.vacation.enableAutoReply, true);
  assert.equal(google.state.vacation.restrictToContacts, true);
  assert.equal(google.state.vacation.startTime, String(Date.parse('2026-10-23T22:00:00Z')));

  for (const language of LANGUAGES) {
    const widget = await gladys.fake.widgetGet(WIDGETS.VACATION, { language });
    assertValid(widget.data.content);
  }
  const widget = await gladys.fake.widgetGet(WIDGETS.VACATION, { language: 'fr' });
  const status = widget.data.content.components[0];
  assert.equal(status.items[0].value, 'Programmée');

  const bad = await gladys.fake.sceneAction(SCENE_ACTIONS.ENABLE_VACATION, {
    message: 'x',
    start: '31/02/2026',
  });
  assert.match(bad.error, /Not a date/);

  const off = await gladys.fake.sceneAction(SCENE_ACTIONS.DISABLE_VACATION, {});
  assert.equal(off.error, undefined);
  assert.equal(google.state.vacation.enableAutoReply, false);
  assert.equal(google.state.vacation.responseSubject, 'Absent');
});

test('vacation widget: turn on for N days from the form, then off', async (t) => {
  const { gladys, google, clock } = await startApp(t);
  const on = await gladys.fake.widgetAction(
    WIDGETS.VACATION,
    WIDGET_ACTIONS.VACATION_ON,
    {},
    {
      values: { subject: 'Congés', message: 'Je reviens bientôt.', days: 7, contacts_only: false },
    },
  );
  assert.match(on.data.message.fr, /7 jour/);
  assert.equal(google.state.vacation.endTime, String(clock.now + 7 * 24 * 60 * MINUTE));
  const widget = await gladys.fake.widgetGet(WIDGETS.VACATION, { language: 'en' });
  assertValid(widget.data.content);
  const keys = widget.data.content.components
    .filter((component) => component.type === 'button')
    .map((button) => button.action.key);
  assert.deepEqual(keys, [
    WIDGET_ACTIONS.VACATION_ON,
    WIDGET_ACTIONS.VACATION_OFF,
    WIDGET_ACTIONS.REFRESH,
  ]);
  const empty = await gladys.fake.widgetAction(
    WIDGETS.VACATION,
    WIDGET_ACTIONS.VACATION_ON,
    {},
    {
      values: { subject: '', message: '', days: 0 },
    },
  );
  assert.match(JSON.stringify(empty.data), /Enter a message/);
  await gladys.fake.widgetAction(WIDGETS.VACATION, WIDGET_ACTIONS.VACATION_OFF, {}, {});
  assert.equal(google.state.vacation.enableAutoReply, false);
});

test('unread widget: valid in every language, mark as read, a label by name', async (t) => {
  const { gladys, google } = await startApp(t);
  google.deliver({
    from: 'Alice <alice@example.com>',
    subject: 'Dîner samedi ?',
    snippet: 'On se retrouve',
  });
  google.deliver({
    from: 'Bank <bank@example.com>',
    subject: 'Relevé',
    labelIds: ['Label_1', 'UNREAD'],
  });
  for (const language of LANGUAGES) {
    const widget = await gladys.fake.widgetGet(WIDGETS.UNREAD, { language });
    assertValid(widget.data.content);
  }
  const widget = await gladys.fake.widgetGet(WIDGETS.UNREAD, { language: 'en' });
  const [tile, , list] = widget.data.content.components;
  assert.equal(tile.value, 1);
  assert.equal(list.items[0].title, 'Alice · Dîner samedi ?');
  assert.match(list.items[0].links[0].url, /authuser=home%40example\.com#all\//);
  const mark = widget.data.content.components.find(
    (c) => c.action?.key === WIDGET_ACTIONS.MARK_READ,
  );
  const done = await gladys.fake.widgetAction(
    WIDGETS.UNREAD,
    WIDGET_ACTIONS.MARK_READ,
    mark.action.params,
    {},
  );
  assert.match(JSON.stringify(done.data), /1 mail\(s\) marked as read/);
  assert.equal(
    [...google.state.messages.values()].filter((m) => m.labelIds.includes('UNREAD')).length,
    1,
  );
  const labelled = await gladys.fake.widgetGet(WIDGETS.UNREAD, {
    settings: { label: 'factures' },
    language: 'fr',
  });
  assertValid(labelled.data.content);
  assert.equal(labelled.data.content.components[1].text, 'Factures');
  const unknown = await gladys.fake.widgetGet(WIDGETS.UNREAD, {
    settings: { label: 'Nope' },
    language: 'en',
  });
  assert.match(unknown.data.content.components[0].text, /No Gmail label is named "Nope"/);
});

test('metadata access: no snippet, no "Mark as read" button', async (t) => {
  const { gladys, google } = await startApp(t, { config: { ...CLIENT, access: 'metadata' } });
  google.deliver({ from: 'alice@example.com', subject: 'Hello', snippet: 'secret body' });
  const widget = await gladys.fake.widgetGet(WIDGETS.UNREAD, { language: 'en' });
  assertValid(widget.data.content);
  assert.equal(widget.data.content.components[2].items[0].description, undefined);
  assert.equal(
    widget.data.content.components.some((c) => c.action?.key === WIDGET_ACTIONS.MARK_READ),
    false,
  );
});

test('get_unread and modify_message: count, newest, mark as read, label, archive', async (t) => {
  const { gladys, google } = await startApp(t);
  google.deliver({ from: 'Alice <alice@example.com>', subject: 'First' });
  const newest = google.deliver({ from: 'Bob <bob@example.com>', subject: 'Second' });
  const unread = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_UNREAD, {});
  assert.deepEqual(unread.data.outputs, {
    count: 2,
    latest_from: 'Bob',
    latest_subject: 'Second',
    latest_message_id: newest.id,
  });
  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.MODIFY_MESSAGE, {
    message_id: newest.id,
    mark_read: true,
    add_label: 'Factures',
    archive: true,
  });
  assert.equal(ack.error, undefined, ack.error);
  assert.deepEqual(google.state.messages.get(newest.id).labelIds.sort(), ['Label_1']);
  const unknown = await gladys.fake.sceneAction(SCENE_ACTIONS.MODIFY_MESSAGE, {
    message_id: newest.id,
    add_label: 'INBOX',
  });
  assert.match(unknown.error, /Unknown Gmail label/);
  const injected = await gladys.fake.sceneAction(SCENE_ACTIONS.MODIFY_MESSAGE, {
    message_id: '../x',
  });
  assert.match(injected.error, /message ID/);
});

test('a revoked access stops the readings and asks to connect again', async (t) => {
  const { gladys, google, app, clock } = await startApp(t);
  google.state.revoked = true;
  clock.now += 2 * 3600000;
  assert.equal(await app.poll(), false);
  assert.match(gladys.fake.connectionStatus.message.en, /revoked/);
  const before = google.state.calls.length;
  assert.equal(await app.poll(), false);
  assert.equal(google.state.calls.length, before, 'Google is not hammered');
});

test('the Gmail API disabled in the project is reported', async (t) => {
  const { gladys, google, app } = await startApp(t);
  google.state.apiDisabled = true;
  assert.equal(await app.poll(), false);
  assert.match(gladys.fake.connectionStatus.message.en, /Gmail API is not enabled/);
});

test('configuration actions: test, diagnostic without secrets, disconnect', async (t) => {
  const lines = [];
  const logger = { ...silent, info: (line) => lines.push(String(line)) };
  const { gladys, google, dir } = await startApp(t, { logger });
  google.deliver({ from: 'Alice <alice@example.com>', subject: 'Private subject' });
  const test1 = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(
    JSON.stringify(test1.data),
    /home@example\.com.*send, vacation responder, reading, organizing/,
  );
  await gladys.fake.action(ACTIONS.DIAGNOSTIC);
  const diagnostic = lines.filter((line) => line.startsWith('[diagnostic]')).join('\n');
  assert.ok(diagnostic.length > 100);
  for (const secret of [
    'access-',
    'refresh-1',
    CLIENT_SECRET,
    CLIENT_ID,
    ACCOUNT,
    'Private subject',
    'alice',
  ]) {
    assert.ok(!diagnostic.includes(secret), secret);
  }
  assert.ok(!lines.join('\n').includes('Private subject'), 'no mail content in the logs');
  const out = await gladys.fake.action(ACTIONS.DISCONNECT);
  assert.match(JSON.stringify(out.data), /revoked/);
  assert.equal(stateFile(dir).tokens.refreshToken, '');
  assert.equal(stateFile(dir).history.id, '');
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('a widget rendered before the connection explains it', async (t) => {
  const { gladys } = await startApp(t, { config: CLIENT, connected: false });
  for (const key of Object.values(WIDGETS)) {
    const widget = await gladys.fake.widgetGet(key, { language: 'de' });
    assertValid(widget.data.content);
    assert.match(widget.data.content.components[0].text, /nicht verbunden/);
  }
});
