# gh-aw-issue-agent

Two [GitHub Agentic Workflows](https://github.github.com/gh-aw/) that turn
thin issues into specs. The bot reads your code, asks a few informed
questions in the issue thread, and a maintainer's `/spec` produces the
artifact.

## What it does

1. **Issue opened.** The bot reads the issue and the repo, and labels it
   `bug` or `feature`.
2. **First reply.** One comment with its understanding (guesses marked as
   guesses), a few code-grounded questions each with a proposed answer, and
   the available commands.
3. **Back and forth.** Each human comment starts a round, whether it comes
   from the filer, a maintainer, or anyone else. The bot posts one new
   comment with the updated understanding and only the remaining
   questions. Earlier bot comments are hidden as outdated.
4. **Ready.** When nothing important is left that the thread could answer,
   or the round cap is reached, the bot adds `spec-ready`. A well-written
   issue skips the questions.
5. **Gate.** A maintainer comments `/spec`. Filer approval alone never
   produces a spec.
6. **Artifact.**
   - Feature: a spec pull request in the repo's spec format, linked from
     the issue.
   - Bug: the issue body is rewritten into a structured bug report. No pull
     request.

Unanswered items stay visible as open gaps. They never block `spec-ready`.

The bot engages an issue by posting its first round. Comments on issues it
never engaged start nothing. That covers issues opened before the install
and issues it judged to be neither a bug nor a feature. To engage an
existing issue, add the `trigger-label` label (default `needs-brainstorm`),
in either trigger mode.

## Install

```bash
gh aw add rshade/gh-aw-issue-agent
gh aw compile
git add .github && git commit -m "feat: add issue bot"
```

Commit the generated `.lock.yml` files; they are what Actions runs.

### Copilot authentication

Pick one:

- Org-billed Copilot: add `permissions: copilot-requests: write` to both
  workflows.
- Personal token: `gh aw secrets set COPILOT_GITHUB_TOKEN`.

### Repository settings

- Enable **Allow GitHub Actions to create and approve pull requests**
  (Settings, Actions, General). Feature specs need it. The spec workflow
  sets `fallback-as-issue: false`, so a blocked pull request fails the run
  visibly instead of filing a stray issue.
- Do not set `GH_AW_GITHUB_TOKEN` unless you understand the effect: the bot
  then posts as that user, and its comments look human.

### Labels

The bot uses `bug`, `feature`, `spec-ready`, `no-bot`, `spec-drafted` and
`spec` (on spec pull requests). Missing labels are created automatically.
Names are configurable except `spec`.

## Commands

| Command | Who | Effect |
| --- | --- | --- |
| `/spec` | Write access and above | Produce the spec PR (feature) or bug report (bug) |
| `/stop` | The filer or a maintainer | Bot goes silent on this issue |

The `no-bot` label does the same as `/stop`. Anyone else typing `/spec` is
rejected by gh-aw's role check.

## Configuration

Optional file `.github/issue-bot.yml`, read at runtime by both workflows.
It is flat `key: value` lines with `#` comments. Invalid values fall back to
the default. See [examples/issue-bot.yml](examples/issue-bot.yml).

| Key | Default | Values |
| --- | --- | --- |
| `trigger` | `all` | `all` (every new issue) or `label` (only when `trigger-label` is added; the label engages an issue in both modes) |
| `trigger-label` | `needs-brainstorm` | Any label name |
| `round-cap` | `3` | Integer 1 to 10 |
| `spec-format` | `auto` | `auto`, `spec-kit`, `openspec` |
| `label-bug` | `bug` | Any label name |
| `label-feature` | `feature` | Any label name |
| `label-ready` | `spec-ready` | Any label name |
| `label-stop` | `no-bot` | Any label name |
| `label-done` | `spec-drafted` | Any label name |

### Issue templates

Templates in `.github/ISSUE_TEMPLATE/` (Markdown or YAML forms) define what
the bot treats as enough information. They override the built-in bug and
feature defaults per type. A template's `labels:` maps it to bug or feature,
and `required: true` form fields are must-know fields. The bot treats them as
coverage, not a script: it skips answered fields and asks only what remains.

### Spec format

For features, the format is chosen in this order:

1. `spec-format` in the config, when not `auto`
2. `.specify/` present: Spec Kit
3. `openspec/` present: OpenSpec
4. Spec Kit layout

## Security notes

Both workflows set `min-integrity: none` on purpose, so the bot can read
issues from non-collaborators on public repos. They stay safe because:

- permissions are read-only and the agent never holds a write token,
- all writes go through gh-aw safe outputs (comments, labels, one issue
  update, one pull request limited to `specs/**` and `openspec/changes/**`),
- a pre-filter skips noise, pull requests, the bot's own comments, issues
  opened by bots, issues the bot never engaged, and stopped issues before
  the agent runs.

Two limits to know:

- The label safe outputs are not restricted to the bot's label names, and
  `create-if-missing` is on. The prompts name the only labels to use, but
  a manipulated run could add up to 2 labels (creating them if needed) and
  remove 1 per run.
- gh-aw sanitizes every body it posts, including mentions and links. The
  Original report kept in a rewritten bug may therefore differ from what
  the filer typed. The issue's edit history keeps the exact text.

## Development

```bash
make check   # unit tests, strict compile, markdownlint
make smoke   # install into a temp repo and compile
```

`.github/workflows/ci.yml` runs these in CI. It is not part of the installed
package: `aw.yml` `includes` lists only the two workflows.

## License

MIT. See [LICENSE](LICENSE).
