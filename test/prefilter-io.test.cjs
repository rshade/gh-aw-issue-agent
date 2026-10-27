'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULTS, eventFromPayload, countRounds, formatOutputs, run,
} = require('../workflows/shared/issue-bot-prefilter.cjs');

test('maps an issue_comment payload', () => {
  const ev = eventFromPayload('issue_comment', {
    action: 'created',
    issue: { user: { login: 'alice' }, labels: [{ name: 'bug' }], pull_request: undefined },
    comment: { body: 'hi', user: { login: 'bob', type: 'User' }, author_association: 'NONE' } });
  assert.deepEqual(ev, { name: 'issue_comment', action: 'created', isPullRequest: false,
    issueAuthor: 'alice', issueLabels: ['bug'], labelAdded: null,
    comment: { body: 'hi', author: 'bob', authorType: 'User', association: 'NONE' } });
});

test('a PR comment is marked isPullRequest', () => {
  const ev = eventFromPayload('issue_comment', { action: 'created',
    issue: { user: { login: 'a' }, labels: [], pull_request: { url: 'x' } },
    comment: { body: '', user: { login: 'a', type: 'User' }, author_association: 'NONE' } });
  assert.equal(ev.isPullRequest, true);
});

test('maps an issues labeled payload with labelAdded and no comment', () => {
  const ev = eventFromPayload('issues', { action: 'labeled', label: { name: 'needs-brainstorm' },
    issue: { user: { login: 'a' }, labels: [{ name: 'needs-brainstorm' }] } });
  assert.equal(ev.labelAdded, 'needs-brainstorm');
  assert.equal(ev.comment, null);
});

test('null comment user and body normalize to empty strings', () => {
  const ev = eventFromPayload('issue_comment', { action: 'created',
    issue: { user: null, labels: null },
    comment: { body: null, user: null, author_association: null } });
  assert.equal(ev.issueAuthor, '');
  assert.deepEqual(ev.issueLabels, []);
  assert.deepEqual(ev.comment, { body: '', author: '', authorType: '', association: '' });
});

test('counts only marked comments', () => {
  assert.equal(countRounds([{ body: 'x <!-- gh-aw-workflow-id: issue-bot -->' },
    { body: 'human' }, { body: '<!-- gh-aw-workflow-id: issue-bot-spec -->' }]), 1);
});

test('outputs include final_round and configured labels', () => {
  const out = formatOutputs({ go: true, mode: 'round', reason: 'round' }, DEFAULTS, 2);
  assert.match(out, /^go=true$/m);
  assert.match(out, /^round=3$/m);
  assert.match(out, /^final_round=true$/m);
  assert.match(out, /^label_ready=spec-ready$/m);
  assert.ok(out.endsWith('\n'));
});

test('null mode is written empty', () => {
  const out = formatOutputs({ go: false, mode: null, reason: 'noise' }, DEFAULTS, 0);
  assert.match(out, /^mode=$/m);
  assert.match(out, /^final_round=false$/m);
});

test('run maps a noise comment to go=false', () => {
  const out = run({ eventName: 'issue_comment', configText: null, comments: [],
    payload: { action: 'created',
      issue: { user: { login: 'a' }, labels: [{ name: 'bug' }] },
      comment: { body: '+1', user: { login: 'b', type: 'User' }, author_association: 'NONE' } } });
  assert.match(out, /^go=false$/m);
  assert.match(out, /^reason=noise$/m);
});
