# CLAUDE.md

Installable source for two gh-aw workflows (Copilot engine) that turn thin
issues into specs. See `README.md` for users and
`docs/superpowers/specs/2026-10-26-issue-to-spec-agent-design.md` for design.

## Commands

- `make check` runs `test`, `compile` and `lint` (markdownlint).
- `make smoke` installs the workflows into a temp repo with `gh aw add` and
  runs `gh aw compile --strict`. No network or auth beyond local `gh aw add`.
- `make e2e` runs the scenarios against a real demo repo. It costs Copilot
  credits and is never run in CI.

## Layout

- `workflows/issue-bot.md`, `workflows/issue-bot-spec.md`: the two workflows.
- `workflows/shared/`: pre-filter (`issue-bot-prefilter.cjs`) and imported
  prompt fragments.
- `aw.yml`: package manifest; `includes` lists only the two workflows.
- `examples/issue-bot.yml`: all config keys at their defaults; a test keeps
  it in sync with the parser.
- `test/`: `node --test` unit tests.
- `.github/workflows/ci.yml`: plain Actions CI, not part of the package.

Edit workflow sources under `workflows/`, not `.github/workflows/`. Lock
files (`*.lock.yml`) are not committed here.

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
