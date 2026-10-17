// Pure helpers: MIME building, header parsing, dates of the vacation
// responder, the /data store, widget contents.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildRawMessage,
  parseAddresses,
  parseFrom,
  encodeHeader,
  decodeHeader,
  htmlToText,
  MailInputError,
} from '../src/mime.js';
import {
  parseUserDate,
  enableSettings,
  describeVacation,
  VacationInputError,
} from '../src/vacation.js';
import { createStore } from '../src/store.js';
import { isReceived, toMail } from '../src/mailbox.js';
import { mailEventData } from '../src/events.js';
import { buildUnreadWidget, buildVacationWidget } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';
import { NOW, TZ, tempDir } from './helpers/fakes.js';

const decode = (raw) => Buffer.from(raw, 'base64url').toString('utf8');

test('addresses: commas, semicolons, display names; anything else is refused', () => {
  assert.deepEqual(parseAddresses(' a@b.fr ;Bob <c@d.example>, '), ['a@b.fr', 'c@d.example']);
  assert.deepEqual(parseAddresses(''), []);
  assert.throws(() => parseAddresses('a@b.fr, nope'), MailInputError);
  assert.throws(() => parseAddresses('a@b.fr\r\nBcc: x@y.z'), MailInputError);
});

test('headers: RFC 2047 both ways, From split into name and lower-cased address', () => {
  assert.equal(encodeHeader('Hello'), 'Hello');
  assert.equal(decodeHeader(encodeHeader('Été à la maison')), 'Été à la maison');
  assert.equal(decodeHeader('=?ISO-8859-1?Q?Caf=E9_cr=E8me?='), 'Café crème');
  assert.deepEqual(parseFrom('"EDF" <Factures@EDF.fr>'), {
    name: 'EDF',
    address: 'factures@edf.fr',
  });
  assert.deepEqual(parseFrom('alice@example.com'), {
    name: 'alice@example.com',
    address: 'alice@example.com',
  });
});

test('raw message: plain text in UTF-8 base64, no From, refused without recipient or content', () => {
  const { raw, recipients } = buildRawMessage({
    to: 'a@b.fr',
    bcc: 'c@d.fr',
    subject: 'Salut',
    text: 'Ligne 1\nLigne 2 é',
  });
  assert.equal(recipients, 2);
  const mime = decode(raw);
  assert.doesNotMatch(mime, /^From:/m);
  assert.match(mime, /^Bcc: c@d\.fr$/m);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Ligne 1\r\nLigne 2 é');
  assert.throws(() => buildRawMessage({ to: '', subject: 'x', text: 'y' }), /recipient/);
  assert.throws(() => buildRawMessage({ to: 'a@b.fr', subject: 'x', text: '  ' }), /empty/);
  const many = Array.from({ length: 501 }, (_, i) => `u${i}@example.com`).join(',');
  assert.throws(() => buildRawMessage({ to: many, subject: 'x', text: 'y' }), /500/);
});

test('HTML body: a plain text alternative; an unknown file is not attached', () => {
  assert.equal(htmlToText('<p>Porte <b>ouverte</b></p><p>A &amp; B</p>'), 'Porte ouverte\nA & B');
  const mime = decode(
    buildRawMessage({
      to: 'a@b.fr',
      subject: 'x',
      text: '<p>Hi</p>',
      html: true,
      image: 'bm90IGFuIGltYWdl',
    }).raw,
  );
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /text\/html/);
  assert.doesNotMatch(mime, /multipart\/mixed/);
});

test('user dates: ISO, European, relative, end of day, DST of the time zone of Gladys', () => {
  const context = { now: NOW, zone: TZ };
  assert.equal(parseUserDate('', context), null);
  assert.equal(parseUserDate('2026-10-24', context), Date.parse('2026-10-23T22:00:00Z'));
  // After the change to winter time (25 October 2026): UTC+1.
  assert.equal(parseUserDate('26/10/2026 08:30', context), Date.parse('2026-10-26T07:30:00Z'));
  assert.equal(
    parseUserDate('2026-10-26', { ...context, endOfDay: true }),
    Date.parse('2026-10-26T22:59:00Z'),
  );
  assert.equal(parseUserDate('+3', context), NOW + 3 * 86400000);
  for (const bad of ['31/02/2026', '2026-13-01', 'tomorrow', '2026-10-24 25:00']) {
    assert.throws(() => parseUserDate(bad, context), VacationInputError, bad);
  }
});

test('vacation settings: a subject or a message, the end after the start, a readable view', () => {
  assert.throws(() => enableSettings({ subject: '', message: ' ' }), /subject or a message/);
  assert.throws(() => enableSettings({ message: 'x', start: 2, end: 1 }), /before the start/);
  const settings = enableSettings({ subject: 'A\r\nB', message: 'Back soon', end: NOW + 1000 });
  assert.equal(settings.responseSubject, 'A B');
  assert.equal(settings.endTime, String(NOW + 1000));
  assert.equal(settings.startTime, undefined);
  assert.equal(describeVacation(settings, NOW).active, true);
  assert.equal(describeVacation(settings, NOW + 2000).expired, true);
  assert.equal(describeVacation({ ...settings, startTime: String(NOW + 500) }, NOW).active, false);
});

test('store: survives a broken file, writes atomically with 0600', async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 'state.json'), '{broken');
  const store = createStore(dir);
  const loaded = await store.load();
  assert.equal(loaded.tokens.refreshToken, '');
  await store.save({ history: { id: '42', at: 1 } });
  await store.save({ tokens: { refreshToken: 'r' } });
  const saved = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(saved.history.id, '42');
  assert.equal(saved.tokens.refreshToken, 'r');
  assert.equal(statSync(join(dir, 'state.json')).mode & 0o777, 0o600);
});

test('received mails: inbox or user label, never drafts, sent-only, spam, trash or chats', () => {
  const labels = new Map([['Label_1', { id: 'Label_1', name: 'Factures', type: 'user' }]]);
  const ok = (labelIds) => isReceived({ labelIds }, labels);
  assert.equal(ok(['INBOX', 'UNREAD']), true);
  assert.equal(ok(['Label_1']), true);
  assert.equal(ok(['SENT', 'INBOX']), true, 'a mail to oneself');
  for (const labelIds of [['DRAFT'], ['SENT'], ['SPAM', 'INBOX'], ['TRASH'], ['CHAT'], []]) {
    assert.equal(ok(labelIds), false, labelIds.join());
  }
});

test('event data: flat, bounded, every declared variable', () => {
  const labels = new Map([['Label_1', { id: 'Label_1', name: 'Factures', type: 'user' }]]);
  const mail = toMail(
    {
      id: 'm1',
      threadId: 't1',
      labelIds: ['INBOX', 'Label_1', 'CATEGORY_UPDATES'],
      internalDate: String(NOW),
      snippet: 'x'.repeat(5000),
      payload: {
        headers: [
          { name: 'from', value: 'A <a@b.c>' },
          { name: 'Subject', value: 'S' },
        ],
      },
    },
    labels,
  );
  const data = mailEventData(mail, 3);
  const manifest = JSON.parse(
    readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.keys(data).sort(),
    [
      ...new Set([...manifest.scene_triggers[0].variables.map((v) => v.key), 'from_address']),
    ].sort(),
  );
  assert.equal(data.snippet.length, 1000);
  assert.equal(data.category, 'updates');
  assert.equal(data.labels, 'Factures');
  assert.equal(data.date, new Date(NOW).toISOString());
});

test('widget contents stay within the budget, even with long texts', () => {
  const long = 'Ü'.repeat(300);
  const mails = Array.from({ length: 5 }, (_, i) => ({
    id: `m${i}`,
    threadId: `t${i}`,
    fromName: long,
    fromAddress: 'a@b.c',
    subject: long,
    snippet: long,
    date: NOW,
    important: i === 0,
  }));
  for (const language of LANGUAGES) {
    const unread = buildUnreadWidget({
      labelName: long,
      count: 12,
      mails,
      account: 'a@b.c',
      canModify: true,
      language,
    });
    assert.deepEqual(validateWidgetContent(unread), [], language);
    const vacation = buildVacationWidget({
      vacation: describeVacation(
        enableSettings({
          subject: long,
          message: long.repeat(10),
          start: NOW,
          end: NOW + 86400000,
        }),
        NOW,
      ),
      language,
      zone: TZ,
    });
    assert.deepEqual(validateWidgetContent(vacation), [], language);
  }
});
