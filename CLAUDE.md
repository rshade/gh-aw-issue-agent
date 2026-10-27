# CLAUDE.md

Installable source for two gh-aw workflows (Copilot engine) that turn thin
issues into specs. See `README.md` for users and
`docs/superpowers/specs/2026-10-26-issue-to-spec-agent-design.md` for design.

## Commands

- `make check` runs `test`, `compile` and `lint` (markdownlint).
- `make smoke` installs the workflows into a temp repo with `gh aw add` and
  runs `gh aw compile --strict`. No network or auth beyond local `gh aw add`.
- `make e2e [SCENARIOS="stop queue"]` runs `test/e2e/scenarios.sh` against
  the demo repo (`DEMO_REPO`, `TIMEOUT`, `POLL` env). It costs Copilot credits
  and is never run in CI or `check`. The `gh` token needs Actions read access
  (run polling) and contents write (config scenarios). Config scenarios
  restore `.github/issue-bot.yml` in a trap.

## Layout

- `workflows/issue-bot.md`, `workflows/issue-bot-spec.md`: the two workflows.
- `workflows/shared/`: pre-filter (`issue-bot-prefilter.cjs`) and imported
  prompt fragments.
- `aw.yml`: package manifest; `includes` lists only the two workflows.
- `examples/issue-bot.yml`: all config keys at their defaults; a test keeps
  it in sync with the parser.
- `test/`: `node --test` unit tests.
- `.github/workflows/ci.yml`: plain Actions CI, not part of the package.

Edit workflow sources under `workflows/`, not `.github/workflows/`.
Consumers commit the generated lock files (`*.lock.yml`); this repo does
not.

## gh-aw gotchas

- `tools.github.min-integrity: none` is required, or the bot cannot read
  issues from non-collaborators.
- `update_issue` needs `operation: "replace"`; the default is append.
- `slash_command` also fires on `edited` events.
- A `GH_AW_GITHUB_TOKEN` PAT makes bot comments look human. The pre-filter
  and prompts identify the bot's own comments by marker plus Bot author or
  OWNER/MEMBER/COLLABORATOR association.
- Agents must call `noop` when they post nothing, or the run fails.
- `status-comment: false` keeps `/spec` to one comment.
- A local `gh aw add ./path` does not copy imports or resources, so
  `scripts/install-smoke.sh` copies `workflows/shared/` itself.
- Concurrency defaults to `queue: single`, which replaces older pending
  runs; both workflows set `queue: max` so no queued comment is dropped.
- Prompt bodies accept only allowlisted expressions:
  `github.event.comment.created_at` is rejected. Surface such values
  through an `on.steps` step output and `jobs.pre-activation.outputs`.
- The pre-filter engages an issue only once a counted round exists, and
  reads current labels from the API, not the event payload.
- Do not add the pre-filter to `aw.yml` `resources` as well as workflow
  frontmatter `resources`: `gh aw add` reportedly errors when a non-markdown
  resource already exists at its destination (unverified without a push).
