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

# --- Trusted harness (blocker 1) ---
# A dedicated checkout of the default-branch ref provides the harness under _trusted.
grep -qF 'ref: ${{ github.event.repository.default_branch }}' "$WF"
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

# --- CHATGPT-C2 extra suite is a distinct focused matrix, not a duplicate ---
jq empty "$MANIFEST"
c2cmd="$(jq -r '.lanes["CHATGPT-C2"].extra_required_suites[0].command' "$MANIFEST")"
test -n "$c2cmd"
# It must NOT be the bare default e2e command (a duplicate).
test "$c2cmd" != "npm run test:e2e"
# It must express a focused responsive matrix.
printf '%s' "$c2cmd" | grep -qE '390|1024|1440|responsive'

# --- Deterministic lane-requirement simulation ---
valid_lanes="GLM-A1,GLM-A2,GLM-X1,CHATGPT-C1,CHATGPT-C2"
lane_ok() { # lane_ok <lane> -> OK|NOT_CONFIGURED
  local lane="$1"
  [ -n "$lane" ] || { echo NOT_CONFIGURED; return; }
  case ",$valid_lanes," in *",$lane,"*) echo OK ;; *) echo NOT_CONFIGURED ;; esac
}
test "$(lane_ok '')" = NOT_CONFIGURED           # missing lane blocks
test "$(lane_ok 'UNKNOWN')" = NOT_CONFIGURED    # unknown lane blocks
test "$(lane_ok 'CHATGPT-C2')" = OK             # recognized lane proceeds

echo "trusted-harness-and-lane simulation passed"
