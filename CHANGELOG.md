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
- The trigger label engages any issue in either trigger mode, including
  issues opened before the install. Comments on issues the bot never
  engaged start nothing.
- Each issue's runs queue in order (`queue: max`), so a later comment never
  replaces a queued answer.
- `/spec` on a feature whose spec PR already merged links it instead of
  drafting a new one.
