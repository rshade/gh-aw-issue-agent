#!/usr/bin/env bash
# End-to-end scenarios against a real demo repo. Costs Copilot credits; never run in CI.
# Usage: scenarios.sh [--list] [name...]
set -euo pipefail

DEMO_REPO="${DEMO_REPO:-rshade/gh-aw-issue-agent-demo}"
TIMEOUT="${TIMEOUT:-900}"
POLL="${POLL:-20}"
BOT_LOCK="issue-bot.lock.yml"
SPEC_LOCK="issue-bot-spec.lock.yml"
CONFIG_PATH=".github/issue-bot.yml"

SCENARIOS=(feature-flow stop spec-bug openspec round-cap label-mode queue)

THIN_FEATURE_BODY="Please add a way to filter logs by severity."
THIN_BUG_BODY="The app crashes."
ANSWER="Filtering applies to the web log viewer. Users pick one or more levels (debug, info, warn, error) from a dropdown, entries of other levels are hidden, and the selection persists across reloads. Out of scope: server-side filtering and saved filter presets."

CUR=""

pass() { echo "PASS ${1:-$CUR}"; }
die() { echo "FAIL ${CUR}: $*"; exit 1; }

wait_for() {
  local secs=$1 deadline
  shift
  deadline=$((SECONDS + secs))
  until "$@"; do
    ((SECONDS < deadline)) || return 1
    sleep "$POLL"
  done
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

new_issue() {
  local title=$1 body=$2 url
  shift 2
  url=$(gh issue create --repo "$DEMO_REPO" --title "[e2e $CUR $(now_iso)] $title" --body "$body" "$@")
  echo "${url##*/}"
}

issue_created_at() { gh api "repos/$DEMO_REPO/issues/$1" --jq .created_at; }

post_comment() {
  gh api -X POST "repos/$DEMO_REPO/issues/$1/comments" -f body="$2" --jq .created_at
}

issue_labels() { gh api "repos/$DEMO_REPO/issues/$1" --jq '.labels[].name'; }
has_label() { issue_labels "$1" | grep -qxF "$2"; }

issue_body() { gh api "repos/$DEMO_REPO/issues/$1" --jq .body; }

bot_comment_ids() {
  gh api --paginate "repos/$DEMO_REPO/issues/$1/comments" --jq \
    '.[] | select((.body | contains("gh-aw-workflow-id: issue-bot")) and (.body | contains("gh-aw-workflow-id: issue-bot-spec") | not)) | .node_id'
}

bot_comments() { bot_comment_ids "$1" | grep -c . || true; }

bot_comment_bodies() {
  gh api --paginate "repos/$DEMO_REPO/issues/$1/comments" --jq \
    '.[] | select((.body | contains("gh-aw-workflow-id: issue-bot")) and (.body | contains("gh-aw-workflow-id: issue-bot-spec") | not)) | .body'
}

spec_comments() {
  gh api --paginate "repos/$DEMO_REPO/issues/$1/comments" --jq \
    '.[] | select(.body | contains("gh-aw-workflow-id: issue-bot-spec")) | .body'
}

spec_comment_count() { spec_comments "$1" | grep -c 'gh-aw-workflow-id: issue-bot-spec' || true; }

bot_comments_at_least() { (($(bot_comments "$1") >= $2)); }
spec_comments_at_least() { (($(spec_comment_count "$1") >= $2)); }

is_minimized() {
  # shellcheck disable=SC2016
  [[ $(gh api graphql -f id="$1" \
    -f query='query($id: ID!) { node(id: $id) { ... on IssueComment { isMinimized } } }' \
    --jq .data.node.isMinimized) == true ]]
}

# Earliest run of a workflow created at or after an ISO time: "<id> <status>".
earliest_run() {
  gh run list --repo "$DEMO_REPO" --workflow "$1" --limit 50 --json databaseId,createdAt,status |
    jq -r --arg since "$2" '[.[] | select(.createdAt >= $since)] | sort_by(.createdAt) | .[0] | select(. != null) | "\(.databaseId) \(.status)"'
}

run_completed() { [[ $(earliest_run "$1" "$2") == *" completed" ]]; }
run_in_progress() { [[ $(earliest_run "$1" "$2") == *" in_progress" ]]; }

all_runs_done() {
  gh run list --repo "$DEMO_REPO" --workflow "$1" --limit 50 --json createdAt,status |
    jq -e --arg since "$2" '[.[] | select(.createdAt >= $since)] | length > 0 and all(.status == "completed")' >/dev/null
}

# Conclusion of the agent job of the earliest run at or after the given time.
agent_conclusion_since() {
  local id
  id=$(earliest_run "$1" "$2" | cut -d' ' -f1)
  [[ -n $id ]] || return 1
  gh run view "$id" --repo "$DEMO_REPO" --json jobs --jq '.jobs[] | select(.name == "agent") | .conclusion'
}

assert_agent_skipped() {
  local lock=$1 since=$2 got
  wait_for "$TIMEOUT" run_completed "$lock" "$since" || die "no completed $lock run since $since"
  got=$(agent_conclusion_since "$lock" "$since")
  [[ $got == skipped ]] || die "expected agent job skipped, got '${got:-none}'"
}

spec_pr() {
  gh pr list --repo "$DEMO_REPO" --state all --limit 100 --json number,title |
    jq -r --arg p "[spec] #$1:" '.[] | select(.title | startswith($p)) | .number'
}

spec_pr_exists() { [[ -n $(spec_pr "$1") ]]; }

assert_first_bot_round() {
  local n=$1
  wait_for "$TIMEOUT" bot_comments_at_least "$n" 1 || die "no bot comment on #$n"
  wait_for "$TIMEOUT" all_runs_done "$BOT_LOCK" "$(issue_created_at "$n")" || die "bot runs did not finish on #$n"
}

CFG_ORIG_B64=""
CFG_CHANGED=0

cfg_sha() { gh api "repos/$DEMO_REPO/contents/$CONFIG_PATH" --jq .sha; }

cfg_put() {
  gh api -X PUT "repos/$DEMO_REPO/contents/$CONFIG_PATH" \
    -f message="test(e2e): $2" -f content="$1" -f sha="$(cfg_sha)" >/dev/null
}

cfg_restore() {
  if ((CFG_CHANGED)); then
    cfg_put "$CFG_ORIG_B64" "restore issue-bot config" || echo "WARN: failed to restore $CONFIG_PATH in $DEMO_REPO" >&2
    CFG_CHANGED=0
  fi
}

cfg_set() {
  local key=$1 value=$2 text
  if [[ -z $CFG_ORIG_B64 ]]; then
    CFG_ORIG_B64=$(gh api "repos/$DEMO_REPO/contents/$CONFIG_PATH" --jq .content | tr -d '\n')
    trap cfg_restore EXIT
  fi
  text=$(printf '%s' "$CFG_ORIG_B64" | base64 -d | sed -E "s/^${key}:.*/${key}: ${value}/")
  CFG_CHANGED=1
  cfg_put "$(printf '%s\n' "$text" | base64 -w0)" "set $key: $value" || die "could not set $key"
}

pr_files_under() {
  local pr=$1 pattern=$2 files
  files=$(gh pr view "$pr" --repo "$DEMO_REPO" --json files --jq '.files[].path')
  [[ -n $files ]] || return 1
  ! grep -qvE "$pattern" <<<"$files"
}

scn_feature-flow() {
  local n created since c1 pr ids before_prs

  CUR=thin-feature
  n=$(new_issue "Filter logs by severity" "$THIN_FEATURE_BODY")
  created=$(issue_created_at "$n")
  echo "feature-flow issue #$n"
  assert_first_bot_round "$n"
  wait_for "$TIMEOUT" has_label "$n" feature || die "label feature missing"
  [[ $(bot_comments "$n") == 1 ]] || die "expected exactly 1 bot comment"
  bot_comment_bodies "$n" | grep -q '/spec' || die "bot comment lacks /spec"
  bot_comment_bodies "$n" | grep -q '/stop' || die "bot comment lacks /stop"
  pass

  CUR=noise
  c1=$(bot_comments "$n")
  since=$(post_comment "$n" "+1")
  assert_agent_skipped "$BOT_LOCK" "$since"
  [[ $(bot_comments "$n") == "$c1" ]] || die "bot comment count changed"
  pass

  CUR=answer
  post_comment "$n" "$ANSWER" >/dev/null
  wait_for "$TIMEOUT" bot_comments_at_least "$n" 2 || die "no 2nd bot comment"
  mapfile -t ids < <(bot_comment_ids "$n")
  wait_for "$TIMEOUT" is_minimized "${ids[0]}" || die "first bot comment not minimized"
  pass

  CUR=spec-feature
  since=$(now_iso)
  post_comment "$n" "/spec" >/dev/null
  wait_for "$TIMEOUT" spec_pr_exists "$n" || die "no [spec] PR for #$n"
  pr=$(spec_pr "$n" | head -n1)
  wait_for "$TIMEOUT" run_completed "$SPEC_LOCK" "$since" || die "spec run did not complete"
  pr_files_under "$pr" '^specs/[0-9]+-[^/]+/spec\.md$' || die "PR #$pr has files outside specs/NNN-*/spec.md"
  if gh pr view "$pr" --repo "$DEMO_REPO" --json body --jq .body | grep -qE 'Fixes #'; then
    die "PR #$pr body contains 'Fixes #'"
  fi
  wait_for "$TIMEOUT" has_label "$n" spec-drafted || die "label spec-drafted missing"
  wait_for "$TIMEOUT" spec_comments_at_least "$n" 1 || die "no spec workflow comment"
  [[ $(spec_comment_count "$n") == 1 ]] || die "expected exactly 1 spec workflow comment, got $(spec_comment_count "$n")"
  pass

  CUR=spec-repeat
  before_prs=$(spec_pr "$n" | grep -c . || true)
  since=$(now_iso)
  post_comment "$n" "/spec" >/dev/null
  wait_for "$TIMEOUT" spec_comments_at_least "$n" 2 || die "no new spec comment"
  wait_for "$TIMEOUT" run_completed "$SPEC_LOCK" "$since" || die "spec run did not complete"
  [[ $(spec_pr "$n" | grep -c . || true) == "$before_prs" ]] || die "a new PR was opened"
  spec_comments "$n" | grep -qE "(#|/pull/)$pr([^0-9]|$)" || die "no comment links PR #$pr"
  pass

  CUR=silent-after
  since=$(post_comment "$n" "Thanks, one more detail: the filter should also work on the mobile layout.")
  assert_agent_skipped "$BOT_LOCK" "$since"
  pass
}

scn_stop() {
  local n c since
  CUR=stop
  n=$(new_issue "App crashes on start" "$THIN_BUG_BODY")
  assert_first_bot_round "$n"
  c=$(bot_comments "$n")
  post_comment "$n" "/stop" >/dev/null
  wait_for "$TIMEOUT" has_label "$n" no-bot || die "label no-bot missing"
  wait_for "$TIMEOUT" all_runs_done "$BOT_LOCK" "$(issue_created_at "$n")" || die "bot runs did not finish"
  [[ $(bot_comments "$n") == "$c" ]] || die "bot commented after /stop"
  since=$(post_comment "$n" "$ANSWER")
  assert_agent_skipped "$BOT_LOCK" "$since"
  [[ $(bot_comments "$n") == "$c" ]] || die "bot commented after /stop"
  pass
}

scn_spec-bug() {
  local n body since
  CUR=spec-bug
  n=$(new_issue "App crashes on start" "$THIN_BUG_BODY")
  assert_first_bot_round "$n"
  post_comment "$n" "Steps: run the app on a fresh install with no config file. Expected: the app starts with defaults. Actual: it exits immediately with a null pointer error. Version 1.2.0 on Linux." >/dev/null
  wait_for "$TIMEOUT" bot_comments_at_least "$n" 2 || die "no 2nd bot comment"
  since=$(now_iso)
  post_comment "$n" "/spec" >/dev/null
  wait_for "$TIMEOUT" has_label "$n" spec-drafted || die "label spec-drafted missing"
  wait_for "$TIMEOUT" run_completed "$SPEC_LOCK" "$since" || die "spec run did not complete"
  body=$(issue_body "$n")
  grep -q 'Reproduce' <<<"$body" || die "body lacks 'Reproduce'"
  grep -q 'Original report' <<<"$body" || die "body lacks 'Original report'"
  spec_pr_exists "$n" && die "a spec PR was opened for a bug"
  pass
}

scn_openspec() {
  local n pr since
  CUR=openspec
  cfg_set spec-format openspec
  n=$(new_issue "Filter logs by severity" "$THIN_FEATURE_BODY")
  assert_first_bot_round "$n"
  since=$(now_iso)
  post_comment "$n" "/spec" >/dev/null
  wait_for "$TIMEOUT" spec_pr_exists "$n" || die "no [spec] PR for #$n"
  pr=$(spec_pr "$n" | head -n1)
  wait_for "$TIMEOUT" run_completed "$SPEC_LOCK" "$since" || die "spec run did not complete"
  pr_files_under "$pr" '^openspec/changes/' || die "PR #$pr has files outside openspec/changes/"
  pass
}

scn_round-cap() {
  local n since
  CUR=round-cap
  cfg_set round-cap 1
  n=$(new_issue "Filter logs by severity" "$THIN_FEATURE_BODY")
  assert_first_bot_round "$n"
  wait_for "$TIMEOUT" has_label "$n" spec-ready || die "label spec-ready missing"
  since=$(post_comment "$n" "$ANSWER")
  assert_agent_skipped "$BOT_LOCK" "$since"
  [[ $(bot_comments "$n") == 1 ]] || die "expected exactly 1 bot comment after the cap"
  pass
}

scn_label-mode() {
  local n since created
  CUR=label-mode
  cfg_set trigger label
  n=$(new_issue "Filter logs by severity" "$THIN_FEATURE_BODY" --label bug)
  created=$(issue_created_at "$n")
  assert_agent_skipped "$BOT_LOCK" "$created"
  since=$(post_comment "$n" "$ANSWER")
  assert_agent_skipped "$BOT_LOCK" "$since"
  [[ $(bot_comments "$n") == 0 ]] || die "bot commented without the trigger label"
  gh issue edit "$n" --repo "$DEMO_REPO" --add-label needs-brainstorm >/dev/null
  wait_for "$TIMEOUT" bot_comments_at_least "$n" 1 || die "no bot comment after trigger label"
  wait_for "$TIMEOUT" all_runs_done "$BOT_LOCK" "$created" || die "bot runs did not finish"
  [[ $(bot_comments "$n") == 1 ]] || die "expected exactly 1 bot comment"
  pass
}

scn_queue() {
  local n created
  CUR=queue
  n=$(new_issue "Filter logs by severity" "$THIN_FEATURE_BODY")
  created=$(issue_created_at "$n")
  until run_in_progress "$BOT_LOCK" "$created"; do
    if run_completed "$BOT_LOCK" "$created"; then
      echo "SKIP queue: could not hit the in-flight window"
      return 0
    fi
    sleep 2
  done
  post_comment "$n" "$ANSWER" >/dev/null
  post_comment "$n" "+1" >/dev/null
  wait_for "$TIMEOUT" bot_comments_at_least "$n" 2 || die "answer posted during an in-flight run was dropped"
  wait_for "$TIMEOUT" all_runs_done "$BOT_LOCK" "$created" || die "bot runs did not finish"
  [[ $(bot_comments "$n") == 2 ]] || die "expected exactly 2 bot comments, got $(bot_comments "$n")"
  pass
}

main() {
  local name rc failed=0 selected=("$@")
  if [[ ${1:-} == --list ]]; then
    printf '%s\n' "${SCENARIOS[@]}"
    return 0
  fi
  ((${#selected[@]})) || selected=("${SCENARIOS[@]}")
  for name in "${selected[@]}"; do
    declare -F "scn_$name" >/dev/null || { echo "unknown scenario: $name" >&2; return 2; }
  done
  for name in "${selected[@]}"; do
    rc=0
    ("scn_$name") || rc=$?
    ((rc == 0)) || failed=$((failed + 1))
  done
  ((failed == 0))
}

main "$@"
