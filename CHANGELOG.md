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
