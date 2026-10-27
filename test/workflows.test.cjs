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
