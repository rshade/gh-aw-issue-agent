const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, DEFAULTS, BOT_MARKER, ROUND_MARKER } =
  require('../workflows/shared/issue-bot-prefilter.cjs');

const base = {
  name: 'issue_comment',
  action: 'created',
  isPullRequest: false,
  issueAuthor: 'alice',
  issueAuthorType: 'User',
  issueLabels: ['feature'],
  labelAdded: null,
  comment: {
    body: 'It should support WARN and ERROR',
    author: 'alice',
    authorType: 'User',
    association: 'NONE',
  },
};

function withComment(overrides) {
  return { ...base, comment: { ...base.comment, ...overrides } };
}

const skip = (reason) => ({ go: false, mode: null, reason });
const go = (mode, reason) => ({ go: true, mode, reason });

test('rule 1: pull requests are skipped', () => {
  assert.deepEqual(decide({ ...base, isPullRequest: true }, DEFAULTS, 1), skip('pull-request'));
});

test('rule 2: done label skips', () => {
  const ev = { ...base, issueLabels: ['feature', 'spec-drafted'] };
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('spec-drafted'));
});

test('rule 3: stop label skips', () => {
  const ev = { ...base, issueLabels: ['feature', 'no-bot'] };
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('stopped'));
});

test('label names come from config', () => {
  const cfg = { ...DEFAULTS, labels: { ...DEFAULTS.labels, stop: 'halt' } };
  const ev = { ...base, issueLabels: ['feature', 'halt'] };
  assert.equal(decide(ev, cfg, 1).reason, 'stopped');
  assert.equal(decide({ ...base, issueLabels: ['feature', 'no-bot'] }, cfg, 1).reason, 'round');
});

test('rule 4: issues opened in trigger all starts first round', () => {
  const ev = { ...base, name: 'issues', action: 'opened', comment: null };
  assert.deepEqual(decide(ev, DEFAULTS, 0), go('first', 'opened'));
});

test('rule 5: labeled with trigger label starts exactly one round', () => {
  const cfg = { ...DEFAULTS, trigger: 'label' };
  const ev = { ...base, name: 'issues', action: 'labeled', comment: null,
               labelAdded: 'needs-brainstorm' };
  assert.deepEqual(decide(ev, cfg, 0), go('first', 'label-trigger'));
  assert.equal(decide(ev, cfg, 1).go, false);
});

test('labeled with trigger label starts a first round in trigger all too', () => {
  const ev = { ...base, name: 'issues', action: 'labeled', comment: null,
               labelAdded: 'needs-brainstorm' };
  assert.deepEqual(decide(ev, DEFAULTS, 0), go('first', 'label-trigger'));
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('issue-event'));
});

test('issues opened by a bot account are skipped', () => {
  const ev = { ...base, name: 'issues', action: 'opened', comment: null,
               issueAuthorType: 'Bot' };
  assert.deepEqual(decide(ev, DEFAULTS, 0), skip('bot-author'));
});

test('trigger label on a bot-opened issue is skipped', () => {
  const ev = { ...base, name: 'issues', action: 'labeled', comment: null,
               labelAdded: 'needs-brainstorm', issueAuthorType: 'Bot' };
  assert.deepEqual(decide(ev, { ...DEFAULTS, trigger: 'label' }, 0), skip('bot-author'));
  assert.deepEqual(decide(ev, DEFAULTS, 0), skip('bot-author'));
});

test('rule 5: labeled with another label does not start', () => {
  const cfg = { ...DEFAULTS, trigger: 'label' };
  const ev = { ...base, name: 'issues', action: 'labeled', comment: null, labelAdded: 'bug' };
  assert.deepEqual(decide(ev, cfg, 0), skip('issue-event'));
});

test('label mode: opened with trigger label does not start a round', () => {
  const cfg = { ...DEFAULTS, trigger: 'label' };
  const ev = { ...base, name: 'issues', action: 'opened', comment: null,
               issueLabels: ['needs-brainstorm'] };
  assert.equal(decide(ev, cfg, 0).go, false);
});

test('rule 6: other issues events are skipped', () => {
  const ev = { ...base, name: 'issues', action: 'edited', comment: null };
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('issue-event'));
});

test('rule 7: Bot author is skipped', () => {
  const ev = withComment({ authorType: 'Bot' });
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('own-comment'));
});

test('PAT-posted bot comment is skipped by marker', () => {
  const ev = withComment({ author: 'rshade', authorType: 'User',
    body: 'Thanks!\n<!-- gh-aw-workflow-id: issue-bot -->' });
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('own-comment'));
});

test('spec workflow marker comment is skipped as own-comment', () => {
  const ev = withComment({ body: 'Spec\n<!-- gh-aw-workflow-id: issue-bot-spec -->' });
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('own-comment'));
});

test('markers: ROUND_MARKER only matches issue-bot', () => {
  assert.ok(ROUND_MARKER.test('<!-- gh-aw-workflow-id: issue-bot -->'));
  assert.ok(!ROUND_MARKER.test('<!-- gh-aw-workflow-id: issue-bot-spec -->'));
  assert.ok(!ROUND_MARKER.test('<!-- gh-aw-workflow-id: issue-bot2 -->'));
  assert.ok(BOT_MARKER.test('gh-aw-workflow-id: issue-bot'));
  assert.ok(BOT_MARKER.test('gh-aw-workflow-id: issue-bot-spec'));
  assert.ok(!BOT_MARKER.test('gh-aw-workflow-id: issue-bot2'));
});

const FORM_ID = (w) => `<!-- gh-aw-workflow-id: ${w} -->`;
const FORM_CALL = (w, repo = 'rshade/gh-aw-issue-agent-demo') =>
  `<!-- gh-aw-workflow-call-id: ${repo}/${w} -->`;
const FORM_AGENTIC = (w) =>
  `<!-- gh-aw-agentic-workflow: Issue bot, engine: copilot, model: auto, id: 40501482123, workflow_id: ${w}, run: https://github.com/rshade/gh-aw-issue-agent-demo/actions/runs/40501482123 -->`;
const REAL_EXECUTION =
  '<!-- gh-aw-execution: {"version":1,"repo_id":"1435590953","repository":"rshade/gh\\u002daw\\u002dissue\\u002dagent\\u002ddemo","aw_workflow_id":"issue\\u002dbot","run_id":"40501482123"} -->';
const FORMS = { id: FORM_ID, call: FORM_CALL, agentic: FORM_AGENTIC };

for (const [name, form] of Object.entries(FORMS)) {
  test(`markers (${name} form): ROUND_MARKER matches issue-bot only`, () => {
    assert.ok(ROUND_MARKER.test(form('issue-bot')));
    assert.ok(!ROUND_MARKER.test(form('issue-bot-spec')));
    assert.ok(!ROUND_MARKER.test(form('issue-bot2')));
  });

  test(`markers (${name} form): BOT_MARKER matches both workflows`, () => {
    assert.ok(BOT_MARKER.test(form('issue-bot')));
    assert.ok(BOT_MARKER.test(form('issue-bot-spec')));
    assert.ok(!BOT_MARKER.test(form('issue-bot2')));
    assert.ok(!BOT_MARKER.test(form('issue-bot-x')));
  });
}

test('markers: call-id for another repo path ending /issue-bot-x does not match', () => {
  const body = '<!-- gh-aw-workflow-call-id: other/repo/issue-bot-x -->';
  assert.ok(!ROUND_MARKER.test(body));
  assert.ok(!BOT_MARKER.test(body));
});

test('markers: call-id for the spec workflow is not a round', () => {
  assert.ok(BOT_MARKER.test(FORM_CALL('issue-bot-spec', 'other/repo')));
  assert.ok(!ROUND_MARKER.test(FORM_CALL('issue-bot-spec', 'other/repo')));
});

test('markers: real gh-aw v0.93.5 comment tail matches', () => {
  const real = [
    '> Generated by [Issue bot](https://github.com/rshade/gh-aw-issue-agent-demo/actions/runs/40501482123) for #1',
    '',
    FORM_CALL('issue-bot'),
    '',
    FORM_AGENTIC('issue-bot'),
    REAL_EXECUTION,
  ].join('\n');
  assert.ok(ROUND_MARKER.test(real));
  assert.ok(BOT_MARKER.test(real));
  assert.ok(!ROUND_MARKER.test(REAL_EXECUTION));
  assert.ok(!BOT_MARKER.test(REAL_EXECUTION));
});

test('real v0.93.5 marker comment is skipped as own-comment', () => {
  const ev = withComment({ author: 'rshade', authorType: 'User', body: FORM_CALL('issue-bot') });
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('own-comment'));
});

test('rule 8: /spec command is skipped', () => {
  assert.deepEqual(decide(withComment({ body: '/spec please' }), DEFAULTS, 1), skip('spec-command'));
});

test('rule 9: filer can /stop', () => {
  assert.deepEqual(decide(withComment({ body: '/stop' }), DEFAULTS, 1), go('stop', 'stop'));
});

test('rule 9: filer match is case-insensitive', () => {
  assert.equal(decide(withComment({ author: 'ALICE', body: '/stop' }), DEFAULTS, 1).go, true);
});

test('rule 9: maintainers can /stop', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const ev = withComment({ author: 'bob', association, body: '/stop now' });
    assert.deepEqual(decide(ev, DEFAULTS, 1), go('stop', 'stop'));
  }
});

test('third party cannot /stop someone else\'s issue', () => {
  const ev = withComment({ author: 'mallory', body: '/stop' });
  assert.deepEqual(decide(ev, DEFAULTS, 1), skip('stop-not-allowed'));
});

test('/stopping is not /stop', () => {
  const ev = withComment({ author: 'mallory', body: '/stopping by' });
  assert.equal(decide(ev, DEFAULTS, 1).reason, 'round');
});

test('rule 11: noise comments are skipped', () => {
  for (const body of ['+1', '👍', 'Bump!', 'Any updates?', 'me too', 'Same.', 'following',
    'subscribe', '   ', '', 'Thanks!', 'Thank you.', 'ty', ':+1:', 'thx']) {
    assert.deepEqual(decide(withComment({ body }), DEFAULTS, 1), skip('noise'), body);
  }
});

test('details after "me too" are not noise', () => {
  const ev = withComment({ body: 'me too, on v2.3 with --follow' });
  assert.equal(decide(ev, DEFAULTS, 1).mode, 'round');
});

test('thanks with details is not noise', () => {
  assert.equal(decide(withComment({ body: 'thanks, it fails on Windows too' }), DEFAULTS, 1).mode, 'round');
});

test('rule 12: a comment before any bot round is not engaged', () => {
  const labelMode = { ...DEFAULTS, trigger: 'label' };
  assert.deepEqual(decide({ ...base, issueLabels: ['bug'] }, labelMode, 0), skip('not-engaged'));
  assert.deepEqual(decide({ ...base, issueLabels: ['feature'] }, DEFAULTS, 0), skip('not-engaged'));
  assert.deepEqual(decide({ ...base, issueLabels: ['question'] }, DEFAULTS, 0), skip('not-engaged'));
});

test('rule 12: after a bot round the type label does not matter', () => {
  assert.deepEqual(decide({ ...base, issueLabels: [] }, DEFAULTS, 1), go('round', 'round'));
  assert.deepEqual(decide({ ...base, issueLabels: ['question'] }, DEFAULTS, 2), go('round', 'round'));
});

test('rule 13: round cap reached', () => {
  assert.deepEqual(decide(base, DEFAULTS, 3), skip('round-cap'));
});

test('rule 14: ready label produces post-ready', () => {
  const ev = { ...base, issueLabels: ['feature', 'spec-ready'] };
  assert.deepEqual(decide(ev, DEFAULTS, 1), go('post-ready', 'post-ready'));
});

test('rule 15: otherwise a round', () => {
  assert.deepEqual(decide(base, DEFAULTS, 1), go('round', 'round'));
  const bug = { ...base, issueLabels: ['bug'] };
  assert.deepEqual(decide(bug, DEFAULTS, 2), go('round', 'round'));
});
