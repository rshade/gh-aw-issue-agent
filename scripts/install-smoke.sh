#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cd "$TMP"
git init -q .
# A local `gh aw add <path>` copies only the workflow files, not their imports
# or resources (it reports "import file not found"). Only remote installs
# resolve them, so copy workflows/shared/ here by hand.
mkdir -p .github/workflows
cp -r "$ROOT/workflows/shared" .github/workflows/shared
gh aw add "$ROOT/workflows/issue-bot.md" "$ROOT/workflows/issue-bot-spec.md"

for f in issue-bot-prefilter.cjs issue-bot-principles.md issue-bot-defaults.md issue-bot-formats.md; do
  test -f ".github/workflows/shared/$f" || { echo "missing .github/workflows/shared/$f" >&2; exit 1; }
done

gh aw compile --strict
echo "install smoke OK"
