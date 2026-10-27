# Issue-to-Spec Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two installable gh-aw workflows that turn a thin GitHub issue into a
spec PR (features) or a structured bug report (bugs) through an in-thread
conversation, gated by a maintainer's `/spec`.

**Architecture:** A conversation workflow (`issue-bot`, `roles: all`) runs a
deterministic Node pre-filter in gh-aw's `pre_activation` job that decides
whether the Copilot agent runs at all and in which mode; the agent then posts
one comment per round and labels. A spec workflow (`issue-bot-spec`,
`slash_command: spec`, default write+ roles) writes the artifact. Shared
prompt files and the pre-filter ship with the workflows through `imports:` and
`resources:`, packaged by a root `aw.yml`.

**Tech Stack:** gh-aw v0.93.5 (`gh aw`), Copilot engine, Node 20+ CommonJS
with `node:test` (no npm dependencies), Bash + `gh` for end-to-end tests,
markdownlint-cli2.

**Spec:** `docs/superpowers/specs/2026-10-26-issue-to-spec-agent-design.md`

## Global Constraints

- Engine: `engine: copilot`. Minimum gh-aw: `v0.93.5`.
- Workflows compile with `gh aw compile --strict`; `permissions:` are
  read-only; every write goes through safe outputs.
- Commands: `/spec` (write access and above), `/stop` (filer or maintainer).
- Default labels: `bug`, `feature`, `spec-ready`, `no-bot`, plus
  `spec-drafted` (see Calls below).
- Config file in the consuming repo: `.github/issue-bot.yml`.
- Default round cap: `3`. Default trigger mode: `all`. Default spec format:
  `auto` (precedence: config value, then `.specify/`, then `openspec/`, then
  Spec Kit layout).
- Self-contained: no reference to `/brainstorming`, `/create-issue`, or any
  maintainer-local tool. Everything ships in `workflows/`.
- The bot never @-mentions anyone and asks a few short questions per round,
  each with a guess.
- No npm dependencies in the pre-filter (it runs with the runner's `node`).

### Calls made while planning (not in the design)

- **`spec-drafted` label.** The spec workflow adds it after producing an
  artifact; it is how the conversation workflow knows to go silent.
- **Flat config format.** `.github/issue-bot.yml` is flat `key: value` lines
  so the pre-filter can parse it without a YAML library.
- **Label safe outputs are not `allowed:`-restricted**, because label names
  are configurable; they are capped with `max:` instead.
- **Fail closed.** If the pre-filter errors (API failure), the agent does not
  run.
- **Comments on issues the bot never engaged are skipped.** Rounds only
  happen on issues carrying the configured bug or feature label. This is how
  "other" issues stay silent without a label of their own.
- **Repeated `/spec` on a feature** links to an open spec PR if one exists;
  if the earlier PR was closed, a new one is generated.

## Review Focus

1. **Public-repo integrity filter.** gh-aw applies `min-integrity: approved`
   on public repos, which hides non-collaborator content: the filer's own
   words. Both workflows must set `min-integrity: none`. Pinned by the
   invariant test in Task 4.
2. **Self-retrigger through a PAT.** If an installer sets
   `GH_AW_GITHUB_TOKEN`, safe outputs post as a user, which retriggers
   `issue_comment` and bypasses `skip-bots`. The pre-filter must skip any
   comment carrying the bot's workflow marker, whoever authored it. Pinned in
   Task 2.
3. **Comment bursts.** Two quick comments start two runs that both post a
   round. A per-issue `concurrency` group must serialize them. Pinned by the
   invariant test in Task 4.
4. **Edited comments.** gh-aw's `slash_command` also fires on `edited`, so
   editing an old `/spec` comment re-runs the spec workflow, and it must take
   the repeat path. The conversation workflow must listen to `created` only.
   Pinned by Task 4's invariant test and Task 8's repeat-`/spec` scenario.
5. **Label mode double events.** An issue opened with the trigger label
   fires both `opened` and `labeled`; a later unrelated label fires
   `labeled` again. Exactly one first round must happen. Pinned in Task 2.

---

### Task 1: Repository scaffold and config parser

**Files:**

- Create: `.gitignore`, `package.json`, `Makefile`
- Exists already: `.markdownlint.yaml` (MD013 exempts tables and code
  blocks); commit it in Step 6
- Create: `workflows/shared/issue-bot-prefilter.cjs`
- Test: `test/prefilter-config.test.cjs`

**Interfaces:**

- Produces: `parseConfig(text: string | null) -> { config: Config, warnings:
  string[] }` and `DEFAULTS: Config`, exported from
  `workflows/shared/issue-bot-prefilter.cjs`, where

  ```js
  // Config
  { trigger: 'all' | 'label', triggerLabel: string, roundCap: number,
    specFormat: 'auto' | 'spec-kit' | 'openspec',
    labels: { bug, feature, ready, stop, done } } // all strings
  ```

- [ ] **Step 1: Initialize the repo**

Run `git init -b main`. `.gitignore`: `node_modules/`, `*.lock.yml` (lock
files are generated in consuming repos, not here). `package.json`:
`{"name": "gh-aw-issue-agent", "private": true, "scripts": {"test": "node
--test test/*.test.cjs"}}`. `Makefile` targets:

- `test`: `node --test test/*.test.cjs`
- `compile`: `gh aw compile --dir workflows --strict --no-emit`
- `lint`: `markdownlint-cli2 "**/*.md" "#node_modules"`
- `check`: `test compile lint`

- [ ] **Step 2: Write the failing tests**

```js
// test/prefilter-config.test.cjs
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `make test`
Expected: FAIL with "Cannot find module".

- [ ] **Step 4: Implement `parseConfig` and `DEFAULTS`**

Line-based: strip `#` comments, split on the first `:`, trim, strip one pair
of surrounding quotes. Keys: `trigger`, `trigger-label`, `round-cap` (integer
1-10), `spec-format`, `label-bug`, `label-feature`, `label-ready`,
`label-stop`, `label-done`. Never throws.

- [ ] **Step 5: Run tests to verify they pass**

Run: `make test`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .markdownlint.yaml package.json Makefile workflows test docs
git commit -m "feat: add config parser for issue-bot pre-filter"
```

### Task 2: Pre-filter decision

**Files:**

- Modify: `workflows/shared/issue-bot-prefilter.cjs`
- Test: `test/prefilter-decide.test.cjs`

**Interfaces:**

- Consumes: `Config` from Task 1.
- Produces: `decide(event: Event, config: Config, rounds: number) ->
  { go: boolean, mode: 'first' | 'round' | 'post-ready' | 'stop' | null,
  reason: string }`, where

  ```js
  // Event
  { name: 'issues' | 'issue_comment', action: string, isPullRequest: boolean,
    issueAuthor: string, issueLabels: string[], labelAdded: string | null,
    comment: null | { body: string, author: string, authorType: string,
                      association: string } }
  ```

  and `BOT_MARKER = /gh-aw-workflow-id:\s*issue-bot\b/`.

Rules, first match wins:

| # | Condition | Result |
| --- | --- | --- |
| 1 | `isPullRequest` | skip `pull-request` |
| 2 | issue has `labels.done` | skip `spec-drafted` |
| 3 | issue has `labels.stop` | skip `stopped` |
| 4 | `issues/opened`, trigger `all` | go `first` |
| 5 | `issues/labeled`, trigger `label`, `labelAdded === triggerLabel`, `rounds === 0` | go `first` |
| 6 | any other `issues` event | skip `issue-event` |
| 7 | comment `authorType === 'Bot'` or body matches `BOT_MARKER` | skip `own-comment` |
| 8 | first word `/spec` | skip `spec-command` |
| 9 | first word `/stop`, author is filer or association in OWNER/MEMBER/COLLABORATOR | go `stop` |
| 10 | first word `/stop`, anyone else | skip `stop-not-allowed` |
| 11 | body is noise | skip `noise` |
| 12 | issue has neither `labels.bug` nor `labels.feature` | skip `not-engaged` |
| 13 | `rounds >= roundCap` | skip `round-cap` |
| 14 | issue has `labels.ready` | go `post-ready` |
| 15 | otherwise | go `round` |

Noise: the body lowercased, stripped of whitespace and `.,!?`, equals one of
`+1`, `👍`, `bump`, `anyupdate`, `anyupdates`, `metoo`, `same`, `samehere`,
`following`, `subscribe`, or is empty.

- [ ] **Step 1: Write the failing tests**

One `test()` per rule row above, built from a `base` event (`issue_comment`,
`created`, filer `alice`, labels `['feature']`, comment by `alice`,
association `NONE`, type `User`, body `It should support WARN and ERROR`) with
`DEFAULTS` and `rounds = 1`, asserting the exact `{go, mode, reason}`. Add
these Review Focus cases explicitly:

```js
test('PAT-posted bot comment is skipped by marker', () => {
  const ev = withComment({ author: 'rshade', authorType: 'User',
    body: 'Thanks!\n<!-- gh-aw-workflow-id: issue-bot -->' });
  assert.deepEqual(decide(ev, DEFAULTS, 1),
    { go: false, mode: null, reason: 'own-comment' });
});

test('label mode: opened with trigger label does not start a round', () => {
  const cfg = { ...DEFAULTS, trigger: 'label' };
  const ev = { ...base, name: 'issues', action: 'opened', comment: null,
               issueLabels: ['needs-brainstorm'] };
  assert.equal(decide(ev, cfg, 0).go, false);
});

test('label mode: labeled with trigger label starts exactly one round', () => {
  const cfg = { ...DEFAULTS, trigger: 'label' };
  const ev = { ...base, name: 'issues', action: 'labeled', comment: null,
               labelAdded: 'needs-brainstorm' };
  assert.deepEqual(decide(ev, cfg, 0), { go: true, mode: 'first', reason: 'label-trigger' });
  assert.equal(decide(ev, cfg, 1).go, false);
});

test('details after "me too" are not noise', () => {
  const ev = withComment({ body: 'me too, on v2.3 with --follow' });
  assert.equal(decide(ev, DEFAULTS, 1).mode, 'round');
});

test('third party cannot /stop someone else\'s issue', () => {
  const ev = withComment({ author: 'mallory', body: '/stop' });
  assert.deepEqual(decide(ev, DEFAULTS, 1),
    { go: false, mode: null, reason: 'stop-not-allowed' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make test`
Expected: FAIL, `decide is not a function`.

- [ ] **Step 3: Implement `decide` and export `BOT_MARKER`**

Pure function, no I/O. Reasons for `go: true` rows: `opened`,
`label-trigger`, `stop`, `post-ready`, `round`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `make test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workflows/shared/issue-bot-prefilter.cjs test/prefilter-decide.test.cjs
git commit -m "feat: add pre-filter decision rules"
```

### Task 3: Pre-filter entry point

**Files:**

- Modify: `workflows/shared/issue-bot-prefilter.cjs`
- Test: `test/prefilter-io.test.cjs`

**Interfaces:**

- Consumes: `parseConfig`, `decide`, `BOT_MARKER`.
- Produces:
  - `eventFromPayload(eventName: string, payload: object) -> Event`
  - `countRounds(comments: {body: string}[]) -> number` (comments matching
    `BOT_MARKER`)
  - `formatOutputs(decision, config, rounds) -> string`, the
    `$GITHUB_OUTPUT` lines `go`, `mode`, `reason`, `round` (`rounds + 1`),
    `round_cap`, `final_round` (`true` when `rounds + 1 >= roundCap`),
    `label_bug`, `label_feature`, `label_ready`, `label_stop`, `label_done`
  - `main()` runs when the file is executed directly (`require.main ===
    module`); it reads `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`,
    `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, and appends to `GITHUB_OUTPUT`.

- [ ] **Step 1: Write the failing tests**

```js
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make test`
Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement the three pure functions and `main()`**

`main()` uses global `fetch` against the REST API with the
`Bearer ${GITHUB_TOKEN}` header: `GET /repos/{repo}/contents/.github/issue-bot.yml`
(404 means `null` config; decode base64 `content`) and
`GET /repos/{repo}/issues/{n}/comments?per_page=100`, following `Link`
`rel="next"`. Log `reason` and config warnings to stdout. Any thrown error:
log it, write `go=false` and `reason=prefilter-error`, and exit 0 (fail
closed without failing the run).

- [ ] **Step 4: Run tests to verify they pass**

Run: `make test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add workflows/shared/issue-bot-prefilter.cjs test/prefilter-io.test.cjs
git commit -m "feat: add pre-filter entry point and outputs"
```

### Task 4: Conversation workflow

**Files:**

- Create: `workflows/issue-bot.md`
- Create: `workflows/shared/issue-bot-principles.md`
- Create: `workflows/shared/issue-bot-defaults.md`
- Test: `test/workflows.test.cjs`

**Interfaces:**

- Consumes: the pre-filter outputs from Task 3, read in the prompt as
  `${{ needs.pre_activation.outputs.<name> }}`.
- Produces: `workflows/shared/issue-bot-defaults.md` (imported again by
  Task 5); the comment marker `gh-aw-workflow-id: issue-bot` emitted by gh-aw.

- [ ] **Step 1: Write the failing invariant tests**

`test/workflows.test.cjs` reads each workflow's frontmatter (the text between
the first two `---` lines) and asserts with regexes:

```js
const fm = frontmatter('workflows/issue-bot.md');
test('issue-bot: anyone can talk, filer content is visible', () => {
  assert.match(fm, /^\s*roles:\s*all\s*$/m);
  assert.match(fm, /min-integrity:\s*none/);
});
test('issue-bot: only created comments, serialized per issue', () => {
  assert.match(fm, /issue_comment:[\s\S]{0,40}types:\s*\[created\]/);
  assert.match(fm, /group:.*github\.event\.issue\.number/);
});
test('issue-bot: agent gated by pre-filter', () => {
  assert.match(fm, /needs\.pre_activation\.outputs\.go == 'true'/);
  assert.match(fm, /node \.github\/workflows\/shared\/issue-bot-prefilter\.cjs/);
});
test('issue-bot: cannot write code or rewrite issues', () => {
  assert.doesNotMatch(fm, /create-pull-request|update-issue|edit:/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make test`
Expected: FAIL, the workflow file does not exist.

- [ ] **Step 3: Write `workflows/issue-bot.md` frontmatter**

Exact settings:

- `on`:
  - `issues: {types: [opened, labeled]}`
  - `issue_comment: {types: [created]}`
  - `roles: all`
  - `skip-bots: [github-actions, copilot, dependabot, renovate]`
  - `permissions: {issues: read, contents: read}`
  - `steps:` an `actions/checkout` step with `sparse-checkout:
    .github/workflows/shared`, then `id: prefilter` running `node
    .github/workflows/shared/issue-bot-prefilter.cjs` with `env: GITHUB_TOKEN:
    ${{ github.token }}`
- `jobs.pre-activation.outputs`: each Task 3 output name mapped to
  `${{ steps.prefilter.outputs.<name> }}`
- `if: needs.pre_activation.outputs.go == 'true'`
- `concurrency: {group: "issue-bot-${{ github.event.issue.number }}",
  cancel-in-progress: false}`
- `permissions: {contents: read, issues: read, pull-requests: read}`
- `engine: copilot`, `timeout-minutes: 10`, `network: {}`
- `resources: [shared/issue-bot-prefilter.cjs]`
- `imports: [shared/issue-bot-principles.md, shared/issue-bot-defaults.md]`
- `tools`:
  - `github: {mode: gh-proxy, toolsets: [default], min-integrity: none}`
  - `bash: [cat, grep, find, ls, head, wc, "git log", "git blame"]`
- `safe-outputs`:
  - `add-comment: {max: 1, hide-older-comments: true}`
  - `add-labels: {max: 2, create-if-missing: true}`
  - `remove-labels: {max: 1}`

- [ ] **Step 4: Write the shared prompt files and the workflow body**

- **`issue-bot-principles.md`** (empty frontmatter): the five principles from
  the spec's Intent, phrased as instructions; every churn guard from the
  spec; the comment shape:
  1. "What I understand" (guesses marked as guesses)
  2. "Questions", at most 3, each with a proposed answer
  3. "Open gaps"
  4. a one-line commands footer: "`/stop` silences me on this issue ·
     maintainers: `/spec` writes the spec"

  Also: direction ("this likely belongs in `X`") is offered as a guess,
  never as an @-mention, and unanswered direction questions are open gaps
  that never block ready; and the agent must call `noop` whenever it posts
  nothing.
- **`issue-bot-defaults.md`** (empty frontmatter): default bug coverage
  (reproduce steps, version, environment, expected vs actual; the first two
  required) and default feature coverage (who needs it, the problem, desired
  behavior, done-when; the first three required). Coverage, not a script.
- **Workflow body:** read the issue and thread through the github tool. Read
  `.github/ISSUE_TEMPLATE/*` with bash; a repo template whose `labels:`
  matches overrides the defaults. Branch on `mode`:
  - `first`: classify as bug, feature, or other. "Other" means `noop` with
    no label. Otherwise add the label; if the issue is complete, post the
    short note and add the ready label; else post round 1.
  - `round`: post the next round. Before deciding ready, re-read the draft
    as a builder who cannot ask anything; if nothing the people in the
    thread could answer is left, wrap up and add the ready label. When
    `final_round` is `true`, always wrap up and add the ready label.
  - `post-ready`: post an updated understanding with no questions only if
    the comment adds information; otherwise `noop`.
  - `stop`: add the stop label, then `noop` (no comment).

  Label names come from the `label_*` outputs.

- [ ] **Step 5: Run invariants and compile**

Run: `make test && make compile`
Expected: PASS; `gh aw compile` reports 0 errors and 0 warnings. If
`actions/checkout` inside `on.steps` is rejected for pinning, pin it to the
SHA the error names, then re-run.

- [ ] **Step 6: Lint and commit**

Run: `make lint`
Expected: 0 errors.

```bash
git add workflows test/workflows.test.cjs
git commit -m "feat: add issue-bot conversation workflow"
```

### Task 5: Spec workflow

**Files:**

- Create: `workflows/issue-bot-spec.md`
- Create: `workflows/shared/issue-bot-formats.md`
- Modify: `test/workflows.test.cjs`

**Interfaces:**

- Consumes: `workflows/shared/issue-bot-defaults.md`; the `spec-drafted` and
  `spec-ready` labels; the config file read by the agent with `cat`.
- Produces: the spec PR title convention `[spec] #<N>: <issue title>`, which
  the repeat-`/spec` path searches for.

- [ ] **Step 1: Add the failing invariants**

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make test`
Expected: FAIL, the file does not exist.

- [ ] **Step 3: Write `workflows/issue-bot-spec.md` frontmatter**

Exact settings:

- `on: {slash_command: {name: spec, events: [issue_comment]}}`
- `concurrency` keyed by issue number, as in Task 4
- `permissions: {contents: read, issues: read, pull-requests: read}`
- `engine: copilot`, `timeout-minutes: 20`, `network: {}`
- `imports: [shared/issue-bot-defaults.md, shared/issue-bot-formats.md]`
- `tools`:
  - `github: {mode: gh-proxy, toolsets: [default], min-integrity: none}`
  - `edit:`
  - `bash: [cat, grep, find, ls, head, wc, "git log", "git blame"]`
- `safe-outputs`:
  - `add-comment: {max: 1}`
  - `add-labels: {max: 2, create-if-missing: true}`
  - `update-issue: {body: true, target: triggering}`
  - `create-pull-request`:
    - `title-prefix: "[spec] "`, `labels: [spec]`
    - `draft: false`, `if-no-changes: error`, `auto-close-issue: false`
    - `allowed-files: ["specs/**", "openspec/changes/**"]`

- [ ] **Step 4: Write `issue-bot-formats.md` and the workflow body**

**`issue-bot-formats.md`** (empty frontmatter) defines three outputs.

- **Spec Kit:**
  - Path: `specs/NNN-<slug>/spec.md`. NNN is one more than the highest
    existing three-digit prefix in `specs/`, zero-padded to 3 digits. The
    slug is 2-4 kebab-case words.
  - Follow `.specify/templates/spec-template.md` when present. Otherwise use
    its headings: User Scenarios & Testing, Requirements, Success Criteria,
    Assumptions.
  - Open gaps are written as `[NEEDS CLARIFICATION: …]`.
  - No implementation detail.
- **OpenSpec:**
  - First read `openspec/AGENTS.md`, `openspec/project.md`, and existing
    changes, and follow them over these defaults.
  - Path: `openspec/changes/<change-id>/proposal.md` (Why, What Changes,
    Impact) plus `specs/<capability>/spec.md`. Requirements go under
    `## ADDED Requirements` / `### Requirement:` using SHALL, each with a
    `#### Scenario:` using WHEN/THEN.
  - The change-id is kebab-case and verb-led.
  - Write `tasks.md` only if the repo's instructions require it.
- **Bug report:**
  - Sections: Reproduce, Expected vs actual, Likely location (`file:line`),
    Done when, Open gaps, and Original report in `<details>`.
  - If the original report is over 20000 characters, truncate it there with
    a note that the full text is in the issue's edit history.

**Workflow body:**

- Read the config with `cat .github/issue-bot.yml` (flat keys as in Task 1;
  missing file means defaults).
- Resolve the format: config value, then `.specify/`, then `openspec/`, then
  Spec Kit.
- **Bug:** send `update_issue` with `operation: "replace"` (the default is
  `append`, so say it explicitly). If the body already has an Original report
  section, keep it. Add the done label and post a one-line comment.
- **Feature:** first search open PRs for the title `"[spec] #<N>:"`.
  - If one is found, comment its link and stop.
  - Otherwise write the spec files and create the PR. The PR body links the
    issue ("Spec for #N"), never with "Fixes", and lists open gaps. Add the
    done label and post a comment on the issue linking the PR.
- **Neither bug nor feature label:** classify from the thread first. Never
  @-mention anyone.

- [ ] **Step 5: Run invariants, compile, lint**

Run: `make check`
Expected: all tests pass; compile reports 0 errors; markdownlint reports 0
errors.

- [ ] **Step 6: Commit**

```bash
git add workflows test/workflows.test.cjs
git commit -m "feat: add issue-bot-spec workflow"
```

### Task 6: Package, docs, and CI

**Files:**

- Create: `aw.yml`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`
- Create: `examples/issue-bot.yml`
- Create: `.github/workflows/ci.yml`
- Create: `scripts/install-smoke.sh`

**Interfaces:**

- Consumes: everything under `workflows/`.
- Produces: an installable package, `gh aw add rshade/gh-aw-issue-agent`.

- [ ] **Step 1: Write the failing install smoke test**

`scripts/install-smoke.sh`:

1. Creates a temporary git repo under `$TMPDIR` and runs `gh aw add
   "$PWD/workflows/issue-bot.md" "$PWD/workflows/issue-bot-spec.md"` into
   it.
2. Asserts these files exist:
   - `.github/workflows/shared/issue-bot-prefilter.cjs`
   - `.github/workflows/shared/issue-bot-principles.md`
   - `.github/workflows/shared/issue-bot-defaults.md`
   - `.github/workflows/shared/issue-bot-formats.md`
3. Runs `gh aw compile --strict` there and expects exit 0.
4. Exits non-zero on the first failure.

Add a `smoke` target to the Makefile.

- [ ] **Step 2: Run it to see what local add copies**

Run: `make smoke`
Expected: it passes, or it fails naming a missing shared file. If imports
or resources are not copied on a local add, change the script to copy
`workflows/shared/` itself and note in a comment that only remote installs
resolve them. Task 7 then verifies the remote install.

- [ ] **Step 3: Write the package and docs**

- **`aw.yml`:** `manifest-version: "1"`, `name: issue-bot`, a one-line
  description, `min-version: v0.93.5`, `includes: [workflows/issue-bot.md,
  workflows/issue-bot-spec.md]`.
- **`README.md`:**
  - what it does (the journey from the spec)
  - install: `gh aw add rshade/gh-aw-issue-agent`, then compile and commit
  - Copilot auth, two options: `permissions: copilot-requests: write` for
    org-billed Copilot, or `gh aw secrets set COPILOT_GITHUB_TOKEN`
  - the config reference
  - the commands
  - a warning not to set `GH_AW_GITHUB_TOKEN` without understanding that
    the bot will post as that user
- **`examples/issue-bot.yml`:** every key at its default, with comments.
- **`CHANGELOG.md`:** Keep a Changelog format, with an `## [Unreleased]`
  section listing the two workflows.
- **`CLAUDE.md`:** `make check`/`smoke`/`e2e`, plus the gh-aw gotchas
  (`min-integrity`, `operation: replace`, `slash_command` fires on `edited`,
  PAT retrigger, the `noop` requirement).
- **`.github/workflows/ci.yml`:** on push and pull_request:
  1. setup-node 22
  2. `gh extension install github/gh-aw --pin v0.93.5`
  3. `make test compile smoke`
  4. markdownlint-cli2-action

- [ ] **Step 4: Run all local checks**

Run: `make check smoke`
Expected: all pass, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add aw.yml README.md CHANGELOG.md CLAUDE.md examples .github scripts Makefile
git commit -m "feat: package issue-bot for gh aw add"
```

### Task 7: Publish and demo repository

Outward-facing: **ask the maintainer to confirm before each push or repo
creation in this task.**

**Files (demo repo `rshade/gh-aw-issue-agent-demo`):**

- `cmd/logq/main.go`, `go.mod`: a tiny log-reading CLI, so "filter by
  severity" is a natural thin issue
- `.specify/` from `specify init --here --integration copilot
  --ignore-agent-tools`
- `openspec/project.md`: a short hand-written OpenSpec project description,
  used by the Task 8 OpenSpec scenario
- `.github/issue-bot.yml`: copied from `examples/issue-bot.yml`
- Installed workflows from `gh aw add rshade/gh-aw-issue-agent`

- [ ] **Step 1: Publish this repo**

After confirmation: `gh repo create rshade/gh-aw-issue-agent --public
--source . --push`.

- [ ] **Step 2: Create and scaffold the demo repo**

After confirmation, create it, add the files above, install the package,
run `gh aw compile`, set Copilot auth (the maintainer runs `! gh aw secrets
set COPILOT_GITHUB_TOKEN --repo rshade/gh-aw-issue-agent-demo`), commit, and
push. Create the labels `bug`, `feature`, `spec-ready`, `no-bot`,
`spec-drafted`, `spec`.

- [ ] **Step 3: Verify the remote install**

Run: `gh aw status --repo rshade/gh-aw-issue-agent-demo` and list
`.github/workflows/shared/` in the demo repo.
Expected: both workflows are listed and enabled; all four shared files and
the `.cjs` are present.

### Task 8: End-to-end scenarios

**Files:**

- Create: `test/e2e/scenarios.sh`
- Modify: `Makefile` (`e2e` target, `DEMO_REPO` defaulting to
  `rshade/gh-aw-issue-agent-demo`)

**Interfaces:**

- Consumes: the demo repo from Task 7. The script needs a `gh` login with
  write access. Each Copilot run costs credits, so `make e2e` is never part
  of `check` or CI.

`scenarios.sh [name...]` runs the named scenarios, or all of them. It uses
a `wait_for <seconds> <command>` poll helper with a 900-second default.
Assertions are structural only, never about the wording of model output.

| Scenario | Action | Assert |
| --- | --- | --- |
| `thin-feature` | Open "Filter logs by severity" with a one-line body | label `feature`; exactly 1 bot comment containing `/spec` and `/stop` |
| `noise` | Comment `+1` on it | latest `issue-bot` run has the agent job `skipped`; bot comment count unchanged |
| `answer` | Comment a substantive answer | a 2nd bot comment exists; the 1st is minimized (GraphQL `isMinimized`) |
| `spec-feature` | Comment `/spec` | an open PR titled `[spec] #N:` with only files under `specs/NNN-*/spec.md`; PR body lacks `Fixes #`; issue has `spec-drafted` |
| `spec-repeat` | Comment `/spec` again | no new PR; a new comment links the existing PR |
| `silent-after` | Comment a substantive message | the `issue-bot` agent job is `skipped` |
| `stop` | New thin bug issue, then `/stop` | label `no-bot`; no new bot comment; a later comment's agent job is `skipped` |
| `spec-bug` | New thin bug issue, answer once, `/spec` | body contains `Reproduce` and `Original report`; no PR; `spec-drafted` |
| `openspec` | Commit `spec-format: openspec` to the config, new feature issue, `/spec`, then restore the config | PR files are only under `openspec/changes/` |
| `round-cap` | Commit `round-cap: 1`, new thin feature issue, then a substantive comment, then restore | first comment exists and `spec-ready` is added; the second comment's agent job is `skipped` |

- [ ] **Step 1: Write `scenarios.sh` with all scenarios**

- [ ] **Step 2: Run it**

Run: `make e2e`
Expected: every scenario prints `PASS`. If a scenario fails, use `gh aw
logs`/`gh aw audit <run>` to find the cause, fix it in `workflows/`,
reinstall in the demo repo with `gh aw update`, and re-run that scenario.

- [ ] **Step 3: Commit**

```bash
git add test/e2e Makefile
git commit -m "test: add end-to-end scenarios against demo repo"
```
