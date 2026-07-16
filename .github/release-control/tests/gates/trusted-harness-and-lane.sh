#!/usr/bin/env bash
# Proves the required-suite runner and manifest are executed from a TRUSTED
# default-branch checkout (not the worker's checkout, which a worker PR could
# modify to fake a pass), and that a recognized lane is REQUIRED (missing/unknown
# lane fails closed instead of silently using the default suite set).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WF=.github/workflows/worker-validation.yml
MANIFEST=.github/release-control/required-suites.json
test -f "$WF"

# --- Trusted harness pinned to ONE SHA (blockers 1 + 5) ---
# resolve-head pins the harness SHA once; the harness checkout uses that exact SHA,
# so a moving default branch cannot swap the harness mid-run.
grep -qF 'harness_sha: ${{ steps.resolve.outputs.harness_sha }}' "$WF"   # output declared
grep -qF 'github.rest.repos.getBranch' "$WF"                            # resolve default-branch commit
grep -qF "core.setOutput('harness_sha'" "$WF"                           # pinned SHA emitted
grep -qF 'ref: ${{ needs.resolve-head.outputs.harness_sha }}' "$WF"     # harness checked out at pinned SHA
grep -qF 'path: _trusted' "$WF"
grep -qF '_trusted/.github/release-control/run-required-suites.sh' "$WF"
grep -qF '_trusted/.github/release-control/required-suites.json' "$WF"
# The runner must be invoked from the trusted path, never the worker checkout copy.
if grep -qE 'bash[[:space:]]+\.github/release-control/run-required-suites\.sh' "$WF"; then
  echo 'worker validation must run the TRUSTED harness (_trusted/...), not the worker checkout copy'
  exit 1
fi
# Missing trusted harness fails closed.
grep -qF 'trusted required-suite runner is not present' "$WF"

# --- Lane derived from issue+branch, then label verified (point 4) ---
# resolve-head reads the immutable lane mapping from the trusted pinned ref, derives
# the lane from the exact head branch, and requires the single lane label to match;
# a worker cannot select any recognized label.
grep -qF 'lane-mapping.json' "$WF"
grep -qF 'def.branch === pr.head.ref' "$WF"
grep -qF 'matching its derived lane' "$WF"
grep -qF 'read-only until an exact-SHA START_AUTHORIZATION' "$WF"
grep -qF 'NOT_CONFIGURED' "$WF"

# --- Every coding lane has its OWN focused required suite naming the finding's
#     actual reviewed test files (point 5) ---
jq empty "$MANIFEST"
CODING_LANES="GLM-A1 GLM-A2 GLM-X1 CHATGPT-C1 CHATGPT-C2 JULES-T1 JULES-U1 JULES-S2"
for lane in $CODING_LANES; do
  n="$(jq -r --arg l "$lane" '.lanes[$l].extra_required_suites | length' "$MANIFEST")"
  test "${n:-0}" -ge 1 || { echo "lane $lane has no focused required suite"; exit 1; }
  while IFS= read -r req; do
    test "$req" = "true" || { echo "lane $lane focused suite must be required"; exit 1; }
  done < <(jq -r --arg l "$lane" '.lanes[$l].extra_required_suites[].required' "$MANIFEST")
done
# Focused suites name the finding's ACTUAL tests, not unrelated generic suites.
jq -e '.lanes["GLM-A1"].extra_required_suites[0].command | test("tests/screenshot-state-truth-001")' "$MANIFEST" >/dev/null
jq -e '.lanes["GLM-A2"].extra_required_suites[0].command | test("tests/matching-fail-closed-negative-tests")' "$MANIFEST" >/dev/null
jq -e '.lanes["GLM-X1"].extra_required_suites[0].command | test("tests/screenshot-export-gates-003")' "$MANIFEST" >/dev/null
jq -e '.lanes["CHATGPT-C1"].extra_required_suites[0].command | test("tests/vault-review-provenance")' "$MANIFEST" >/dev/null
jq -e '.lanes["JULES-T1"].extra_required_suites[0].command | test("tests/jules-notification-bell-a11y")' "$MANIFEST" >/dev/null
jq -e '.lanes["JULES-S2"].extra_required_suites[0].command | test("tests/jules-secure-upload-policy-a11y")' "$MANIFEST" >/dev/null
# CHATGPT-C2 owns a responsive playwright suite that runs its real e2e specs (not
# the generic default e2e) and its viewport-bearing tablet spec.
c2play="$(jq -r '.lanes["CHATGPT-C2"].extra_required_suites[] | select(.kind=="playwright") | .command' "$MANIFEST")"
test -n "$c2play"
test "$c2play" != "npm run test:e2e"
printf '%s' "$c2play" | grep -qF 'e2e/tablet-universal-tender-intelligence.spec.ts'

# --- Immutable lane mapping bound to the real fixed pool (points 1-3) ---
MAP=.github/release-control/lane-mapping.json
test -f "$MAP"
jq empty "$MAP"
test "$(jq -r '.expected_base' "$MAP")" = "integration/controlled-recovery"
# Each coding lane: mapped to its exact issue, a real (non-null) branch, exact
# permitted paths, and present in the suite manifest.
declare -A LANE_ISSUE=( [GLM-A1]=1134 [GLM-A2]=1135 [GLM-X1]=1136 [CHATGPT-C1]=1137 [CHATGPT-C2]=1138 [JULES-T1]=1143 [JULES-U1]=1144 [JULES-S2]=1145 )
for lane in $CODING_LANES; do
  test "$(jq -r --arg l "$lane" '.lanes | has($l)' "$MAP")" = "true" || { echo "lane $lane missing from immutable mapping"; exit 1; }
  test "$(jq -r --arg l "$lane" '.lanes[$l].issue' "$MAP")" = "${LANE_ISSUE[$lane]}" || { echo "lane $lane wrong issue"; exit 1; }
  br="$(jq -r --arg l "$lane" '.lanes[$l].branch' "$MAP")"
  test -n "$br" && test "$br" != "null" || { echo "lane $lane has no real branch"; exit 1; }
  pp="$(jq -r --arg l "$lane" '.lanes[$l].permitted_paths | length' "$MAP")"
  test "${pp:-0}" -ge 1 || { echo "lane $lane has no permitted_paths"; exit 1; }
  test "$(jq -r --arg l "$lane" '.lanes | has($l)' "$MANIFEST")" = "true" || { echo "lane $lane not in suite manifest"; exit 1; }
done
# Real branch bindings match the current authorized PR branches exactly.
test "$(jq -r '.lanes["GLM-A1"].branch' "$MAP")" = "worker/screenshot-state-truth-001"
test "$(jq -r '.lanes["JULES-T1"].branch' "$MAP")" = "worker/jules-notification-a11y-006-16137658204389118457"
test "$(jq -r '.lanes["JULES-S2"].branch' "$MAP")" = "worker/jules-upload-policy-a11y-008"
# The single Codex chat is read-only: no branch, no manifest suite, needs authorization.
test "$(jq -r '.lanes["CODEX-D1"].requires_start_authorization' "$MAP")" = "true"
test "$(jq -r '.lanes["CODEX-D1"].branch' "$MAP")" = "null"
test "$(jq -r '.lanes | has("CODEX-D1")' "$MANIFEST")" = "false"
# Cross-cutting critical findings are dependencies, never lanes.
for dep in 1149 1151 1152 1153 1154 1155; do
  test "$(jq -r --arg d "$dep" '.dependencies[$d].is_lane' "$MAP")" = "false" || { echo "dependency $dep must not be a lane"; exit 1; }
done
for notlane in AI-SAFETY AI-RUNTIME TENANCY OPERATIONS PRODUCT-TRUTH; do
  test "$(jq -r --arg l "$notlane" '.lanes | has($l)' "$MAP")" = "false" || { echo "$notlane must not be a lane"; exit 1; }
done
# Every coding lane in the manifest is a real mapped coding lane (no phantom authority).
while IFS= read -r l; do
  test "$(jq -r --arg l "$l" '.lanes | has($l)' "$MAP")" = "true" || { echo "manifest lane $l is not mapped"; exit 1; }
done < <(jq -r '.lanes | keys[]' "$MANIFEST")

# --- Deterministic lane-requirement simulation ---
valid_lanes="$(printf '%s' "$CODING_LANES" | tr ' ' ',')"
lane_ok() { # lane_ok <lane> -> OK|NOT_CONFIGURED
  local lane="$1"
  [ -n "$lane" ] || { echo NOT_CONFIGURED; return; }
  case ",$valid_lanes," in *",$lane,"*) echo OK ;; *) echo NOT_CONFIGURED ;; esac
}
test "$(lane_ok '')" = NOT_CONFIGURED             # missing lane blocks
test "$(lane_ok 'UNKNOWN')" = NOT_CONFIGURED      # unknown lane blocks
test "$(lane_ok 'CHATGPT-C2')" = OK               # recognized coding lane proceeds
test "$(lane_ok 'JULES-T1')" = OK                 # recognized coding lane proceeds
test "$(lane_ok 'CODEX-D1')" = NOT_CONFIGURED     # read-only lane has no validated suite
test "$(lane_ok 'AI-SAFETY')" = NOT_CONFIGURED    # a dependency is not a claimable lane

echo "trusted-harness-and-lane simulation passed"
