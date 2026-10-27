# Issue-to-Spec Agent: Design

Date: 2026-10-26
Status: draft, pending approval

## Intent

People file thin GitHub issues: a sentence describing a feature or a bug,
written without knowing the codebase. Nothing pushes back on them, so the
issue sits until a maintainer interrogates the filer or guesses.

Locally, the maintainer already has a loop that fixes this: `/brainstorming`
and `/create-issue` read the code, ask informed questions, play back an
understanding, and only produce the final artifact after approval. This
project moves that loop into the issue thread itself, so the filer (and any
maintainer who joins) has the conversation asynchronously, and a maintainer
can turn the result into a spec with one command.

What made the local tools work, and must survive the move:

1. **Read the code before asking.** Questions come from the repo, not from a
   generic checklist. A canned "what is the expected behavior?" is the
   failure this replaces.
2. **Play back understanding; offer guesses to correct.** Correcting a
   guess is easier than authoring from nothing, especially for a filer who
   does not know the code.
3. **Separate the why from the how.** The filer owns the problem and intent;
   the maintainer owns direction and approach.
4. **A fresh-reader check decides when questioning ends.** Not a word count.
5. **A hard gate before the artifact.** Locally the answerer and the
   approver are the same person. On GitHub they are not, so the gate belongs
   to the maintainer.

## Goals

- A thin issue becomes, through conversation in the thread, a spec PR
  (features) or a structured bug report (bugs).
- The demo shows the whole arc, "idea conception to spec": thin issue,
  informed questions, answers, `/spec`, spec PR opened and linked.
- Works for both participants: usually the filer answers, a maintainer may
  add context in the same thread.
- Installable by anyone with `gh aw add`; the demo repo is the first user.
- Cost-aware: the expensive step (writing the spec) only runs when a
  maintainer asks for it.

## Non-goals (for now)

- Revising the spec in response to PR review comments.
- Breaking the spec into tasks, `tasks.md`, or sub-issues.
- Implementing anything.

## Anti-goals

The failure that gets this uninstalled after a week: **it churned too much
and made users mad.** Even if it technically works, the bot fails if it:

- floods the thread or notifications,
- re-asks what was already said,
- interrogates issues that were already well written,
- posts walls of text,
- runs (and costs money) on noise like "+1" or "any update?",
- cannot be told to stop.

## Platform and constraints

- **GitHub Agentic Workflows (gh-aw)**, engine **Copilot**. Verified against
  gh-aw v0.93.5 (upgraded locally from v0.81.6 on 2026-10-26).
- **Self-contained.** Everything the bot needs ships with the installed
  workflows: the questioning behavior, the five principles above, default
  templates, and spec-format knowledge. It must not depend on the
  maintainer's local tools (`/brainstorming`, `/create-issue`) or on any
  installer having them; those tools are the inspiration, not a dependency.
- The agent never holds a write token. All writes go through gh-aw safe
  outputs.
- gh-aw facts this design depends on (from the gh-aw reference docs):
  - Command triggers are slash commands (`slash_command:`); the command must
    be the first word of the comment. There is no @mention trigger.
  - `slash_command` cannot be combined inline with `issues` or
    `issue_comment` triggers (only via `strategy: centralized`).
  - `roles:` is an exact-match allowlist of the actor's repo role, default
    `[admin, maintainer, write]`, enforced on unsafe triggers such as
    `issues`. `roles: all` admits everyone. Whether the default also blocks
    plain `issue_comment` runs is not stated in the docs; the builder should
    confirm.
  - `on.skip-bots:` excludes bot actors.
  - `add-comment` supports `hide-older-comments: true` (minimizes the
    workflow's earlier comments as "outdated") and, alternatively,
    `replace-older-comments: true`. There is no general "edit comment"
    output.
  - `update-issue` can replace the body (`operation: replace`).
  - `add-labels` / `remove-labels` exist with `allowed:` lists and
    `create-if-missing`.
  - `create-pull-request` exists.
  - `imports:` composes shared markdown/prompt components into workflows.

## How it works

### Two workflows

Because the filer must be able to talk to the bot but must not be able to
trigger spec creation, and because of the `roles:` and `slash_command`
constraints above, the system is two workflows:

- **Conversation workflow**
  - Triggers: `issues: opened` (plus `labeled` in label mode),
    `issue_comment: created`
  - Who: `roles: all`
  - Does: classify, ask, play back, mark ready, honor `/stop`
- **Spec workflow**
  - Trigger: `slash_command: spec`
  - Who: default roles (write access and above)
  - Does: write the spec PR or the bug report

### Commands

| Command | Who may use it | Effect |
| --- | --- | --- |
| `/spec` | Maintainers (write and above) | Produce the end artifact |
| `/stop` | Filer or maintainer | Bot goes silent on this issue |

A `no-bot` label has the same effect as `/stop`. Anyone else typing `/spec`
is rejected by gh-aw's role check, not by the model.

### The journey

1. **Issue opened.** The conversation workflow reads the issue and the
   repo, and labels the issue `bug` or `feature`. By default this runs on
   every new issue; config can restrict it to issues carrying a trigger
   label.
2. **First reply.** One comment containing:
   - the bot's current understanding of the issue, with guesses marked as
     guesses,
   - a few short questions grounded in the code, each with a proposed
     answer to confirm or correct,
   - the available commands (`/stop` for everyone, `/spec` for
     maintainers), briefly.
3. **Back and forth.** Each new human comment from the filer or a
   maintainer triggers a round. The bot re-reads the whole thread, posts one
   new comment with the updated understanding and only the remaining
   questions, and its earlier round comments are hidden as outdated. The
   thread therefore always shows exactly one current understanding.
4. **Ready.** When a fresh-reader check finds nothing important left that
   the people in the thread could answer, or the round cap is reached, the
   bot posts a short wrap-up and adds `spec-ready`. An issue that arrives
   already well written skips the questions and goes straight here with a
   short note.
5. **Gate.** A maintainer comments `/spec`. Filer approval alone never
   produces a spec.
6. **Artifact.**
   - **Feature:** the spec workflow creates a branch, writes the spec in the
     repo's format, opens a PR linked to the issue, and comments the PR link
     on the issue.
   - **Bug:** no PR. The spec workflow rewrites the issue body into a
     structured bug report (below). The issue itself becomes the spec.

### What the bot asks: templates as coverage, not script

The bot needs to know what "enough information" means for this repo. It
looks, in order:

1. The repo's own `.github/ISSUE_TEMPLATE/` (Markdown templates or YAML
   issue forms). A template's `labels:` maps it to bug or feature. Fields
   marked `required: true` in issue forms are must-know fields.
2. Defaults shipped with this project: one bug template and one feature
   template.

Templates define **coverage**, not the question script. The bot:

- skips fields already answered in the thread,
- fills what it can infer from the code (affected module, version that
  introduced a behavior, existing patterns), stated as a guess to confirm,
- asks only about what remains.

**Best effort.** Filers often genuinely do not know. Required fields never
block `spec-ready`. Unanswered items are carried as explicit open gaps
("Unknown: filer could not say which version") in the understanding
comment and in the final artifact, so the maintainer sees the holes rather
than having the bot paper over them.

### Spec format (features)

Auto-detected per repo, overridable by config:

- `.specify/` present: **Spec Kit**. Write `specs/NNN-<slug>/spec.md`
  following the repo's Spec Kit spec template.
- `openspec/` present: **OpenSpec**. Write a change under
  `openspec/changes/<change-id>/` (proposal plus spec deltas).
- Neither: use the format named in config; if none is configured, Spec Kit
  layout.

Only the spec is produced. No plan, no tasks (see non-goals), except where
the format's own validation requires a file to exist.

### Bug report (bugs)

`/spec` on a bug replaces the issue body with:

- **Reproduce:** exact steps, version, environment
- **Expected vs actual**
- **Likely location:** `file:line` candidates found by reading the code
- **Done when:** the regression test that would prove the fix
- **Open gaps:** anything still unknown
- **Original report:** the filer's original text preserved verbatim in a
  collapsed section

### Churn guards

- At most one new comment per round, and only when there is something to
  say. Earlier rounds are hidden as outdated.
- Round cap, default **3**, configurable. At the cap the bot wraps up with
  what it has and marks `spec-ready`.
- Well-written issues get no questions.
- Every round re-reads the whole thread; never re-ask what was answered.
- Few, short questions per round, each with a guess. No essays.
- Noise does not cause a round: "+1", "any update?", reactions, bot
  comments (`skip-bots`), and the bot's own comments.
- `/stop` or the `no-bot` label silences the bot on that issue.

### Lifecycle and edge cases

- **Not a bug or feature.** Classification has a third result, "other"
  (support questions, docs/chores, duplicates, spam). The bot stays silent
  on those: no questions, no labels.
- **After `spec-ready`.** A later human comment that adds new information
  gets one updated-understanding comment with no new questions. Noise gets
  nothing. After the round cap, the bot stays silent until `/spec`.
- **`/spec` without `spec-ready`.** Allowed. The maintainer can override the
  bot's judgment, including on issues the bot never touched or was told to
  stop on; the artifact then carries more open gaps.
- **After the artifact exists.** The conversation workflow goes silent on
  that issue.
- **Undoing `/stop`.** `/stop` applies the `no-bot` label. A maintainer
  removing the label resumes the bot.
- **Third-party commenters.** Comments from people who are neither the
  filer nor a maintainer trigger rounds and count as answers; "me too, plus
  details" comments are often the best information in a thread. Only the
  filer or a maintainer can `/stop` an issue.
- **Maintainer-opened issues.** Treated like any other issue. Whether to ask
  questions depends only on how complete the issue is.
- **Repeated `/spec` on a feature.** If an open spec PR for the issue
  already exists, the bot does not regenerate or open another; it replies
  with a link to the existing PR. Revision belongs to the PR review
  (non-goal for now). A repeated `/spec` on a bug rewrites the body again
  from the current thread, keeping the original report section.
- **Why vs how in the thread.** Questions focus on the problem and intended
  behavior. Where the code suggests a direction ("this likely belongs in
  `X`"), the bot states it as a guess for anyone to correct. It does not
  @-mention maintainers. Unanswered direction questions become open gaps and
  never block `spec-ready`. Approach appears in the artifact only where the
  format has a place for it (OpenSpec's proposal); a Spec Kit `spec.md`
  stays free of implementation detail.
- **Noise filtering cost.** Obvious noise (bot authors, "+1"-style
  comments, comments on issues labeled `no-bot` or already past the
  artifact) is dropped by a deterministic check before the agent starts.
  Anything subtler reaches the agent, which may end with no output.

### Configuration

A repo-level config file read by both workflows at runtime, so that
upgrading the installed workflows does not overwrite local choices.
Options:

- trigger mode: `all` (default) or `label`, plus the label name
- round cap (default 3)
- spec format: `auto` (default), `spec-kit`, `openspec`
- label names: `bug`, `feature`, `spec-ready`, `no-bot`

### Packaging

- This repository is the installable source: workflows plus shared
  components (default templates, shared prompt) are consumable with
  `gh aw add`.
- A separate demo repository installs it and exercises the full arc.

## Calls made in the design (not explicitly decided by the maintainer)

- Commands are `/spec` and `/stop` (gh-aw has no @mention trigger; the
  maintainer originally proposed `@issue-bot create spec`).
- One comment per round with older rounds hidden, rather than a single
  comment edited in place (gh-aw has no general edit-comment output).
- Two workflows, split by who may trigger them.
- Round cap default of 3.
- Config lives in a repo file rather than in workflow frontmatter.
- Repo templates take precedence over shipped defaults; no merging.
- Fallback spec format when neither framework is present is Spec Kit.
- Bug reports preserve the original text in a collapsed section.
- Third-party comments count as answers; only filer or maintainer can
  `/stop`.
- A repeated `/spec` on a feature points to the existing PR instead of
  regenerating.
- After `spec-ready`, new information gets one updated-understanding
  comment with no new questions; after the round cap the bot is silent.
- "Other" issues (not bug or feature) get no response.
- Obvious noise is filtered deterministically before the agent runs.

## Left to the builder

- Exact workflow and file names, repo layout, config file name and schema.
- How rounds are counted (for example, counting the bot's own round
  comments on the issue).
- How `/stop` is detected in the conversation workflow (it cannot use a
  `slash_command` trigger there).
- How the fresh-reader check is performed inside one agent run.
- Prompt wording and comment formatting, within the churn guards.
- Spec Kit numbering and slug rules, and OpenSpec change-id rules, following
  each framework's conventions.
- Copilot engine setup (secrets/tokens) and documenting it for installers.
- Demo repository content and the sample thin issues used in the demo.
