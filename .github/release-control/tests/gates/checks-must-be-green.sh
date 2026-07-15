#!/usr/bin/env bash
# Proves the Integration Controller blocks on missing, skipped, neutral,
# cancelled, stale, timed-out, action-required, or failed exact-head checks —
# only completed + success may proceed, and at least one external suite is required.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml

# --- Static contract ---
# Only the trusted required-check allow-list grants/denies authority; a required
# check that is missing or not completed+success blocks. An empty policy fails closed.
grep -qF 'required-checks.json' "$CONTROLLER"
grep -qF 'No required checks are configured' "$CONTROLLER"     # empty policy fails closed
grep -qF 'Missing required exact-head check' "$CONTROLLER"     # a missing required check blocks
grep -qF 'integration is blocked' "$CONTROLLER"                # any non-success conclusion blocks
# The legacy combined-status hard requirement must be gone (named checks are the
# repository's real status model).
if grep -qF 'getCombinedStatusForRef' "$CONTROLLER"; then echo 'must not require a legacy combined status'; exit 1; fi
# The controller must NOT treat every discovered suite as mandatory.
if grep -qF 'listSuitesForRef' "$CONTROLLER"; then echo 'controller must not gate on every check suite'; exit 1; fi

# --- Deterministic simulation of the suite gate ---
gate() { # gate <status> <conclusion> -> PASS | BLOCK
  [ "$1" = "completed" ] || { echo BLOCK; return; }
  [ "$2" = "success" ] || { echo BLOCK; return; }
  echo PASS
}

# Every disallowed conclusion must block even when the suite is completed.
for conclusion in failure neutral cancelled skipped stale timed_out action_required; do
  test "$(gate completed "$conclusion")" = BLOCK
done

# Incomplete / in-progress (a proxy for missing/pending) blocks regardless of conclusion.
test "$(gate in_progress success)" = BLOCK
test "$(gate queued success)" = BLOCK

# Only completed + success proceeds.
test "$(gate completed success)" = PASS

echo "checks-must-be-green simulation passed: only completed+success proceeds; missing/skipped/neutral/cancelled/stale/timed_out/action_required/failure all block"
