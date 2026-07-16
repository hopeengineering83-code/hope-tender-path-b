#!/usr/bin/env bash
# Point 5: for every LIVE worker PR, prove the real (branch, issue, base, changed
# files) tuple is accepted, and that mismatching ANY single dimension — changed
# file outside the permitted set, wrong owning issue, wrong lane label, moved worker
# head, moved control SHA, missing independent audit, or a failing focused suite —
# blocks the cycle. The permitted-file check mirrors the integration controller:
# an entry is an exact file name unless it ends with '/', which is a directory prefix.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

MAP=.github/release-control/lane-mapping.json
EXPECTED_BASE="$(jq -r '.expected_base' "$MAP")"

lane_for_branch() { jq -r --arg b "$1" '[.lanes | to_entries[] | select(.value.branch == $b) | .key] | (.[0] // "NONE")' "$MAP"; }
issue_for_lane()  { jq -r --arg l "$1" '.lanes[$l].issue' "$MAP"; }
path_allowed() {  # path_allowed <lane> <file> -> 0 if allowed
  jq -e --arg l "$1" --arg f "$2" \
    '.lanes[$l].permitted_paths | any(if endswith("/") then ($f|startswith(.)) else . == $f end)' "$MAP" >/dev/null
}

# cycle <branch> <label> <closes> <base> <file> <head_match> <control_match> <audit_ok> <suite_ok>
cycle() {
  local branch="$1" label="$2" closes="$3" base="$4" file="$5" head_match="$6" control_match="$7" audit_ok="$8" suite_ok="$9"
  local lane; lane="$(lane_for_branch "$branch")"
  [ "$lane" != "NONE" ] || { echo BLOCK; return; }
  [ "$label" = "$lane" ] || { echo BLOCK; return; }                       # label must match derived lane
  [ "$closes" = "$(issue_for_lane "$lane")" ] || { echo BLOCK; return; }   # one owning issue must match
  [ "$base" = "$EXPECTED_BASE" ] || { echo BLOCK; return; }               # base must be the integration branch
  path_allowed "$lane" "$file" || { echo BLOCK; return; }                  # every changed file in the permitted set
  [ "$head_match" = 1 ] || { echo BLOCK; return; }                        # worker head unchanged
  [ "$control_match" = 1 ] || { echo BLOCK; return; }                     # validation harness == control SHA
  [ "$audit_ok" = 1 ] || { echo BLOCK; return; }                          # independent exact-head+control audit
  [ "$suite_ok" = 1 ] || { echo BLOCK; return; }                          # focused suite EXECUTED_PASS
  echo ACCEPT
}

# Live PRs: branch | lane | issue | one in-scope file | one out-of-scope file
# (from each PR's real changed-file list).
run_live() { # run_live <branch> <lane> <issue> <in_scope> <out_scope>
  local b="$1" l="$2" i="$3" inf="$4" outf="$5"
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$inf" 1 1 1 1)" = ACCEPT   # the real, fully-authorized tuple
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$outf" 1 1 1 1)" = BLOCK    # changed file outside permitted set
  test "$(cycle "$b" "$l" 9999 "$EXPECTED_BASE" "$inf" 1 1 1 1)" = BLOCK     # wrong owning issue
  test "$(cycle "$b" WRONG-LANE "$i" "$EXPECTED_BASE" "$inf" 1 1 1 1)" = BLOCK # wrong lane label
  test "$(cycle "$b" "$l" "$i" main "$inf" 1 1 1 1)" = BLOCK                 # wrong base
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$inf" 0 1 1 1)" = BLOCK     # worker head moved
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$inf" 1 0 1 1)" = BLOCK     # control SHA moved
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$inf" 1 1 0 1)" = BLOCK     # missing independent audit
  test "$(cycle "$b" "$l" "$i" "$EXPECTED_BASE" "$inf" 1 1 1 0)" = BLOCK     # focused suite failed
}

run_live worker/screenshot-state-truth-001 GLM-A1 1134 app/dashboard/analysis/page.tsx app/api/settings/route.ts
run_live worker/screenshot-matching-002 GLM-A2 1135 lib/engine/matching.ts app/dashboard/page.tsx
run_live worker/screenshot-export-gates-003 GLM-X1 1136 prisma/migrations/20260715192500_tender_currency_nullable/migration.sql prisma/migrations/evil/migration.sql
run_live worker/screenshot-vault-privacy-004 CHATGPT-C1 1137 lib/vault-review-provenance.ts lib/engine/matching.ts
run_live worker/screenshot-responsive-contract-005 CHATGPT-C2 1138 components/nav-links.tsx lib/vault-review-provenance.ts
run_live worker/jules-notification-a11y-006-16137658204389118457 JULES-T1 1143 app/components/notification-bell.tsx components/nav-links.tsx
run_live worker/jules-upload-policy-a11y-008 JULES-S2 1145 components/secure-upload-policy-enforcer.tsx app/dashboard/page.tsx

# GLM-X1's bare migration directory is NOT permitted (only the exact migration file is),
# so a different migration file under the same directory is rejected.
test "$(cycle worker/screenshot-export-gates-003 GLM-X1 1136 "$EXPECTED_BASE" prisma/migrations/20990101000000_other/migration.sql 1 1 1 1)" = BLOCK

# The independent-auditor allow-list stays empty and never contains the authoring account.
AUD=.github/release-control/independent-auditors.json
test "$(jq -r '.independent_auditor_logins | length' "$AUD")" = "0"
test "$(jq -r '.independent_auditor_app_slugs | length' "$AUD")" = "0"
test "$(jq -r '[.independent_auditor_logins[] | select(ascii_downcase == "hopeengineering83-code")] | length' "$AUD")" = "0"

echo "live-pr-authority-matrix simulation passed"
