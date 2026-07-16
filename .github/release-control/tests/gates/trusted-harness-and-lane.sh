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

# --- Lane is required (blocker 3) ---
# resolve-head reads the lane registry from the trusted default ref and fails
# closed when the lane is missing or unrecognized.
grep -qF 'the trusted lane registry (required-suites.json)' "$WF"
grep -qF 'must carry exactly one recognized lane label' "$WF"
grep -qF 'NOT_CONFIGURED' "$WF"

# --- Every registered lane has its OWN focused required suite (blockers 1 + 3 + 8) ---
# All 13 current lanes must be registered so an unrelated green suite can never
# satisfy a matching, Vault, export, responsive, database, or AI-runtime finding.
jq empty "$MANIFEST"
ALL_LANES="GLM-A1 GLM-A2 GLM-X1 CHATGPT-C1 CHATGPT-C2 JULES-T1 JULES-U1 JULES-S2 CODEX-D1 AI-SAFETY AI-RUNTIME TENANCY OPERATIONS"
for lane in $ALL_LANES; do
  n="$(jq -r --arg l "$lane" '.lanes[$l].extra_required_suites | length' "$MANIFEST")"
  test "${n:-0}" -ge 1 || { echo "lane $lane has no focused required suite"; exit 1; }
  req="$(jq -r --arg l "$lane" '.lanes[$l].extra_required_suites[0].required' "$MANIFEST")"
  test "$req" = "true" || { echo "lane $lane focused suite must be required"; exit 1; }
done
# CHATGPT-C2 responsive suite is distinct (not a duplicate of the default e2e) and
# names the exact responsive spec/viewports.
c2cmd="$(jq -r '.lanes["CHATGPT-C2"].extra_required_suites[0].command' "$MANIFEST")"
test -n "$c2cmd"
test "$c2cmd" != "npm run test:e2e"
printf '%s' "$c2cmd" | grep -qE '390|1024|1440|responsive'

# --- Immutable lane mapping (blocker 2 + master-prompt point 2 + point 8) ---
# Lane authority is derived from an immutable finding->lane map (issue, branch
# prefix, expected base, permitted paths), NOT a label alone. Every mapped lane
# must also exist in the required-suite manifest, and the manifest must not carry
# an unmapped lane, so the two authorities stay consistent.
MAP=.github/release-control/lane-mapping.json
test -f "$MAP"
jq empty "$MAP"
test "$(jq -r '.expected_base' "$MAP")" = "integration/controlled-recovery"
for lane in $ALL_LANES; do
  test "$(jq -r --arg l "$lane" '.lanes | has($l)' "$MAP")" = "true" || { echo "lane $lane missing from immutable mapping"; exit 1; }
  test "$(jq -r --arg l "$lane" '.lanes[$l].manifest_lane' "$MAP")" = "$lane" || { echo "lane $lane manifest_lane mismatch"; exit 1; }
  pp="$(jq -r --arg l "$lane" '.lanes[$l].permitted_paths | length' "$MAP")"
  test "${pp:-0}" -ge 1 || { echo "lane $lane has no permitted_paths"; exit 1; }
  bp="$(jq -r --arg l "$lane" '.lanes[$l].branch_prefix' "$MAP")"
  test -n "$bp" && test "$bp" != "null" || { echo "lane $lane has no branch_prefix"; exit 1; }
done
# Every mapping lane is a real manifest lane (no phantom authority).
while IFS= read -r l; do
  test "$(jq -r --arg l "$l" '.lanes | has($l)' "$MANIFEST")" = "true" || { echo "mapped lane $l is not in the suite manifest"; exit 1; }
done < <(jq -r '.lanes | keys[]' "$MAP")
# The single Codex lane is read-only until an explicit exact-SHA START_AUTHORIZATION.
test "$(jq -r '.lanes["CODEX-D1"].requires_start_authorization' "$MAP")" = "true"
test "$(jq -r '[.lanes | to_entries[] | select(.value.branch_prefix | startswith("worker/codex")) ] | length' "$MAP")" = "1"

# --- Deterministic lane-requirement simulation (all registered lanes) ---
valid_lanes="$(printf '%s' "$ALL_LANES" | tr ' ' ',')"
lane_ok() { # lane_ok <lane> -> OK|NOT_CONFIGURED
  local lane="$1"
  [ -n "$lane" ] || { echo NOT_CONFIGURED; return; }
  case ",$valid_lanes," in *",$lane,"*) echo OK ;; *) echo NOT_CONFIGURED ;; esac
}
test "$(lane_ok '')" = NOT_CONFIGURED           # missing lane blocks
test "$(lane_ok 'UNKNOWN')" = NOT_CONFIGURED    # unknown lane blocks
test "$(lane_ok 'CHATGPT-C2')" = OK             # recognized lane proceeds
test "$(lane_ok 'CODEX-D1')" = OK               # newly-registered lane proceeds
test "$(lane_ok 'OPERATIONS')" = OK             # newly-registered lane proceeds

echo "trusted-harness-and-lane simulation passed"
