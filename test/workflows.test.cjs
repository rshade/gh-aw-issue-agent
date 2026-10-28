'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function frontmatter(relPath) {
  const text = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) throw new Error(`${relPath}: no frontmatter`);
  return m[1];
}

test('issue-bot: anyone can talk, filer content is visible', () => {
  const fm = frontmatter('workflows/issue-bot.md');
  assert.match(fm, /^\s*roles:\s*all\s*$/m);
  assert.match(fm, /min-integrity:\s*none/);
});

test('issue-bot: only created comments, serialized per issue', () => {
  const fm = frontmatter('workflows/issue-bot.md');
  assert.match(fm, /issue_comment:[\s\S]{0,40}types:\s*\[created\]/);
  assert.match(fm, /group:.*github\.event\.issue\.number/);
  assert.match(fm, /concurrency:[\s\S]{0,120}queue:\s*max/);
});

test('issue-bot: agent gated by pre-filter', () => {
  const fm = frontmatter('workflows/issue-bot.md');
  assert.match(fm, /needs\.pre_activation\.outputs\.go == 'true'/);
  assert.match(fm, /node \.github\/workflows\/shared\/issue-bot-prefilter\.cjs/);
});

test('issue-bot: cannot write code or rewrite issues', () => {
  const fm = frontmatter('workflows/issue-bot.md');
  assert.doesNotMatch(fm, /create-pull-request|update-issue|edit:/);
});

const spec = frontmatter('workflows/issue-bot-spec.md');
test('issue-bot-spec: maintainers only, via slash command', () => {
  assert.match(spec, /slash_command:[\s\S]{0,40}name:\s*spec/);
  assert.doesNotMatch(spec, /roles:\s*all/);
  assert.match(spec, /min-integrity:\s*none/);
});
test('issue-bot-spec: PR is scoped to spec paths and does not close the issue', () => {
  assert.match(spec, /allowed-files:.*"specs\/\*\*"/);
  assert.match(spec, /allowed-files:.*"openspec\/changes\/\*\*"/);
  assert.match(spec, /auto-close-issue:\s*false/);
});
test('issue-bot-spec: one comment per /spec and no fallback issue', () => {
  assert.match(spec, /status-comment:\s*false/);
  assert.match(spec, /fallback-as-issue:\s*false/);
});
test('issue-bot-spec: serialized per issue without dropping queued runs', () => {
  assert.match(spec, /group:.*github\.event\.issue\.number/);
  assert.match(spec, /concurrency:[\s\S]{0,120}queue:\s*max/);
});
test('issue-bot-spec: checks open and merged spec PRs before reading code', () => {
  const body = fs.readFileSync(path.join(ROOT, 'workflows/issue-bot-spec.md'), 'utf8');
  const check = body.indexOf('gh pr list');
  assert.ok(check !== -1 && check < body.indexOf('## Step 5: Read the code'));
  assert.match(body, /gh pr list[^\n]*--state all/);
  assert.match(body, /`MERGED`/);
});
test('issue-bot-spec: can create spec directories before writing files', () => {
  assert.match(spec, /bash:\s*\[[^\]]*\bmkdir\b/);
  const body = fs.readFileSync(path.join(ROOT, 'workflows/issue-bot-spec.md'), 'utf8');
  assert.match(body, /mkdir -p/);
});
test('issue-bot: the triggering comment counts as new even if it predates the last round', () => {
  const body = fs.readFileSync(path.join(ROOT, 'workflows/issue-bot.md'), 'utf8');
  assert.match(body, /\$\{\{ github\.event\.comment\.id \}\}/);
  assert.doesNotMatch(body, /human comments since your last\s+round/);
});
