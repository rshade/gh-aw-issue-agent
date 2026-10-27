const test = require('node:test');
const assert = require('node:assert/strict');
const { parseConfig, DEFAULTS } = require('../workflows/shared/issue-bot-prefilter.cjs');

test('missing file yields defaults', () => {
  const { config, warnings } = parseConfig(null);
  assert.deepEqual(config, DEFAULTS);
  assert.deepEqual(warnings, []);
  assert.equal(DEFAULTS.trigger, 'all');
  assert.equal(DEFAULTS.triggerLabel, 'needs-brainstorm');
  assert.equal(DEFAULTS.roundCap, 3);
  assert.equal(DEFAULTS.specFormat, 'auto');
  assert.deepEqual(DEFAULTS.labels, {
    bug: 'bug', feature: 'feature', ready: 'spec-ready',
    stop: 'no-bot', done: 'spec-drafted' });
});

test('flat keys override defaults, comments and blanks ignored', () => {
  const { config } = parseConfig([
    '# issue-bot config', '', 'trigger: label', 'trigger-label: triage-me',
    'round-cap: 5', 'spec-format: openspec', 'label-ready: ready-for-spec',
    'label-stop: "quiet"' ].join('\n'));
  assert.equal(config.trigger, 'label');
  assert.equal(config.triggerLabel, 'triage-me');
  assert.equal(config.roundCap, 5);
  assert.equal(config.specFormat, 'openspec');
  assert.equal(config.labels.ready, 'ready-for-spec');
  assert.equal(config.labels.stop, 'quiet');
  assert.equal(config.labels.bug, 'bug');
});

test('invalid values fall back per key with a warning', () => {
  const { config, warnings } = parseConfig(
    'trigger: sometimes\nround-cap: 0\nspec-format: rfc\nunknown-key: x');
  assert.equal(config.trigger, 'all');
  assert.equal(config.roundCap, 3);
  assert.equal(config.specFormat, 'auto');
  assert.equal(warnings.length, 4);
});

test('parseConfig does not mutate DEFAULTS', () => {
  const first = parseConfig('label-bug: defect\nround-cap: 7');
  first.config.labels.feature = 'changed';
  assert.equal(DEFAULTS.labels.bug, 'bug');
  assert.equal(DEFAULTS.labels.feature, 'feature');
  assert.equal(DEFAULTS.roundCap, 3);
  assert.equal(parseConfig(null).config.labels.bug, 'bug');
});
