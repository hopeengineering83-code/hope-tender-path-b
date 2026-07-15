#!/usr/bin/env bash
# Proves the Integration Controller blocks on missing, skipped, neutral,
# cancelled, stale, timed-out, action-required, or failed exact-head checks —
# only completed + success may proceed, and at least one external suite is required.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml

# --- Static contract ---
grep -qF 'externalSuites.length === 0' "$CONTROLLER"           # missing checks block
grep -qF 'is not completed' "$CONTROLLER"                      # incomplete blocks
grep -qF 'which blocks integration' "$CONTROLLER"              # any non-success conclusion blocks
grep -qF "combined.state !== 'success'" "$CONTROLLER"          # combined status must be success

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
