# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `issue-bot` workflow: classifies new issues, asks a few code-grounded
  questions in the thread, and marks the issue `spec-ready`.
- `issue-bot-spec` workflow: the maintainer command `/spec` opens a spec pull
  request for a feature or rewrites the issue body into a structured bug
  report.
- `aw.yml` package manifest for `gh aw add rshade/gh-aw-issue-agent`.
- Optional `.github/issue-bot.yml` config, with `examples/issue-bot.yml`.
- Install smoke test (`make smoke`) and CI.
- MIT `LICENSE`.
- The trigger label engages any issue in either trigger mode, including
  issues opened before the install. Comments on issues the bot never
  engaged start nothing.
- Each issue's runs queue in order (`queue: max`), so a later comment never
  replaces a queued answer.
- `/spec` on a feature whose spec PR already merged links it instead of
  drafting a new one.

### Fixed

- Recognize the comment markers gh-aw v0.93.5 actually emits
  (`gh-aw-workflow-call-id` and `workflow_id` inside `gh-aw-agentic-workflow`)
  as well as `gh-aw-workflow-id`. Without this, replies after round 1 were
  skipped as `not-engaged` and the round cap never applied.
- `/spec` can create the new spec directory. The spec workflow's shell
  allowlist lacked `mkdir` and the edit tool does not create parent
  directories, so the agent reported the task incomplete and opened no PR.
- An answer that lands after a round has read the thread but before it
  posts is no longer at risk of being ignored. The bot treated only
  comments below its last round as new; it now treats every comment its
  last round does not reflect, and always the triggering comment, as new
  input.
