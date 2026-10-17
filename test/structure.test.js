// -----------------------------------------------------------------------------
// Non-regression of everything users store: every key of the manifest a
// scene, a widget, a saved configuration or the "My account" block of a user
// refers to, and the widget action keys.
//
// test/fixtures/keys.baseline.json was generated from version 0.1.0 (the
// first release). A failure here means existing users would lose a scene, a
// widget setting or their notification address: never update the baseline
// without a documented migration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { WIDGET_ACTIONS } from '../src/widgets.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const baseline = read('./fixtures/keys.baseline.json');
const manifest = read('../gladys-assistant-integration.json');
const keys = (list) => (list ?? []).map((entry) => entry.key);
const byKey = (list) => new Map((list ?? []).map((entry) => [entry.key, entry]));

test('no configuration key, contact key or action disappears or changes type', () => {
  assert.deepEqual(
    keys(manifest.actions).filter((key) => baseline.manifest.actions.includes(key)),
    baseline.manifest.actions,
  );
  for (const schema of ['config_schema', 'contact_schema']) {
    const current = byKey(manifest[schema]);
    for (const { key, type } of baseline.manifest[schema]) {
      assert.equal(current.get(key)?.type, type, `${schema}.${key}`);
    }
  }
});

test('scene triggers keep their keys, filters, options and variables', () => {
  const current = byKey(manifest.scene_triggers);
  for (const trigger of baseline.manifest.scene_triggers) {
    const now = current.get(trigger.key);
    assert.ok(now, `scene_triggers.${trigger.key}`);
    const fields = byKey(now.fields);
    for (const { key, options } of trigger.fields) {
      assert.ok(fields.has(key), `${trigger.key}.${key}`);
      const values = (fields.get(key)?.options ?? []).map((option) => option.value);
      options.forEach((value) =>
        assert.ok(values.includes(value), `${trigger.key}.${key}: ${value}`),
      );
    }
    const variables = byKey(now.variables);
    for (const { key, type } of trigger.variables) {
      assert.equal(variables.get(key)?.type, type, `${trigger.key}.variables.${key}`);
    }
  }
});

test('scene actions keep their keys, fields and outputs; widgets their settings and actions', () => {
  const actions = byKey(manifest.scene_actions);
  for (const action of baseline.manifest.scene_actions) {
    const now = actions.get(action.key);
    assert.ok(now, action.key);
    action.fields.forEach((field) => assert.ok(keys(now.fields).includes(field), field));
    const outputs = byKey(now.outputs);
    for (const { key, type } of action.outputs) {
      assert.equal(outputs.get(key)?.type, type, `${action.key}.${key}`);
    }
    // A new required field without a default breaks the existing scenes.
    for (const field of now.fields ?? []) {
      if (!action.fields.includes(field.key)) {
        assert.ok(!field.required || field.default !== undefined, `${action.key}.${field.key}`);
      }
    }
  }
  const widgets = byKey(manifest.widgets);
  for (const widget of baseline.manifest.widgets) {
    const now = widgets.get(widget.key);
    assert.ok(now, widget.key);
    widget.settings.forEach((key) => assert.ok(keys(now.settings).includes(key), key));
  }
  assert.deepEqual(Object.values(WIDGET_ACTIONS), baseline.manifest.widget_actions);
});
