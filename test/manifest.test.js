import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { TRIGGERS } from '../src/events.js';
import { SCENE_ACTIONS, ACTIONS, FORMATS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { POLL_MINUTES, ACCESS, ACCOUNT_FIELD, DEFAULT_SUBJECT } from '../src/config.js';
import { SCOPES_BY_ACCESS } from '../src/auth.js';
import { CATEGORIES } from '../src/mailbox.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('a send-only communication integration, in lockstep with package.json, at 0.x', () => {
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: false });
  assert.deepEqual(
    manifest.contact_schema.filter((field) => field.type !== 'section').map((field) => field.key),
    ['email'],
  );
  assert.match(source('../src/app.js'), /contact\?\.email/);
  assert.equal(manifest.name, 'Google Mail');
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-google-mail:${pkg.version}`);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/William-De71/gladys-google-mail/main/cover.jpg',
  );
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-google-mail');
});

test('cloud transport only, no permission, Gladys 5.2.0 for the widget forms', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.doesNotMatch(source('../src/app.js'), /GLADYS_PREFER_LOCAL|publishTransports/);
  for (const key of ['location', 'network_wake', 'containers', 'network_discovery', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
  assert.match(source('../src/widgets.js'), /fields:/, 'button forms: Gladys 5.2.0');
  assert.equal(manifest.gladys_version, '>=5.2.0');
});

test('declares exactly the scene triggers, actions and widgets the code handles', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((x) => x.key).sort(),
    Object.values(TRIGGERS).sort(),
  );
  assert.deepEqual(
    manifest.scene_actions.map((x) => x.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((x) => x.key).sort(), Object.values(WIDGETS).sort());
  assert.deepEqual(
    manifest.actions.map((x) => x.key),
    Object.values(ACTIONS),
  );
  const app = source('../src/app.js');
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(\\s*WIDGETS\\.${key}`), key);
    assert.match(app, new RegExp(`onWidgetAction\\(\\s*WIDGETS\\.${key}`), key);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.match(app, new RegExp(`onSceneAction\\(\\s*SCENE_ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`onAction\\(\\s*ACTIONS\\.${key}`), key);
  }
  for (const key of Object.keys(TRIGGERS)) {
    assert.match(app, new RegExp(`TRIGGERS\\.${key}`), key);
  }
});

test('mirrors the bounds and values of the code', () => {
  const config = byKey(manifest.config_schema);
  for (const bound of ['min', 'max', 'default']) {
    assert.equal(config.get('poll_minutes')[bound], POLL_MINUTES[bound], bound);
  }
  assert.equal(config.get(ACCOUNT_FIELD).type, 'oauth2');
  assert.equal(config.get('client_id').type, 'string');
  assert.equal(config.get('client_secret').type, 'secret');
  assert.deepEqual(values(config.get('access')), Object.values(ACCESS));
  assert.deepEqual(Object.keys(SCOPES_BY_ACCESS), Object.values(ACCESS));
  assert.equal(config.get('access').default, ACCESS.METADATA);
  assert.equal(config.get('notification_subject').default, DEFAULT_SUBJECT);
  const send = byKey(byKey(manifest.scene_actions).get('send_email').fields);
  assert.deepEqual(values(send.get('format')), Object.values(FORMATS));
  // The trigger filters are keys of the event data, the categories those of mailbox.js.
  const trigger = byKey(manifest.scene_triggers[0].fields);
  assert.deepEqual(
    values(trigger.get('category')).sort(),
    [...new Set(Object.values(CATEGORIES))].sort(),
  );
  const variables = manifest.scene_triggers[0].variables.map((variable) => variable.key);
  for (const key of trigger.keys()) {
    assert.ok(variables.includes(key), key);
  }
});

test('the redirect URI given to users is the one Gladys sends', () => {
  const intro = byKey(manifest.config_schema).get('intro');
  for (const language of LANGUAGES) {
    assert.ok(
      intro.description[language].includes('https://my.gladysassistant.com/redirect/oauth'),
      language,
    );
  }
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  assert.ok(manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    assert.ok((action.outputs ?? []).length <= 20, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('no runtime text outside widgets: no language setting', () => {
  assert.equal(byKey(manifest.config_schema).get('language'), undefined);
});

test('no Google host other than the documented ones in the code', () => {
  const hosts = new Set();
  for (const file of [
    'auth.js',
    'gmail-api.js',
    'mailbox.js',
    'config.js',
    'widgets.js',
    'app.js',
    'mime.js',
    'vacation.js',
  ]) {
    for (const [, host] of source(`../src/${file}`).matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      hosts.add(host);
    }
  }
  assert.deepEqual([...hosts].sort(), [
    'accounts.google.com',
    'developers.google.com',
    'gmail.googleapis.com',
    'mail.google.com',
    'my.gladysassistant.com',
    'oauth2.googleapis.com',
    // the scopes are URLs
    'www.googleapis.com',
  ]);
});
