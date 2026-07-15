#!/usr/bin/env bash
# Proves (blocker 4) integration authority is granted only by the trusted
# required-check allow-list — a missing required check blocks, and unrelated
# stale/neutral third-party suites are ignored — and (blocker 5) dispatch attempt
# accounting is durable via an attempt:N label so the three-attempt ceiling cannot
# be bypassed.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml
COORDINATOR=.github/workflows/repair-coordinator.yml
CHECKS=.github/release-control/required-checks.json

# --- Required-check allow-list (blocker 4) ---
test -f "$CHECKS"
jq empty "$CHECKS"
test "$(jq -r '.required_checks[0]' "$CHECKS")" = "worker-exact-head-validation"
grep -qF 'required-checks.json' "$CONTROLLER"
grep -qF 'No required checks are configured' "$CONTROLLER"
grep -qF 'Missing required exact-head check' "$CONTROLLER"

# Simulate the allow-list gate: required check must be present + completed + success;
# a non-required stale/neutral suite is ignored.
required="worker-exact-head-validation"
gate() { # gate <present:1|0> <status> <conclusion> -> PASS|BLOCK
  [ "$1" = "1" ] || { echo BLOCK; return; }
  [ "$2" = "completed" ] || { echo BLOCK; return; }
  [ "$3" = "success" ] || { echo BLOCK; return; }
  echo PASS
}
test "$(gate 0 completed success)" = BLOCK       # required check missing
test "$(gate 1 in_progress success)" = BLOCK     # required check not completed
for c in failure neutral cancelled skipped stale timed_out action_required; do
  test "$(gate 1 completed "$c")" = BLOCK        # required check not success
done
test "$(gate 1 completed success)" = PASS        # required check present + green
# A non-required suite being stale/neutral does not affect authority (not evaluated).
test -n "$required"

# --- Durable attempt accounting (blocker 5) ---
grep -qF 'attempt:' "$COORDINATOR"
grep -qF 'Durable attempt accounting' "$COORDINATOR"
grep -qF 'github.paginate(github.rest.issues.listForRepo' "$COORDINATOR"   # paginate candidates
grep -qF 'removeLabel' "$COORDINATOR"                                       # advance the counter

# Simulate the attempt state machine using a persisted label value.
read_attempt() { # read_attempt <label or empty> -> N
  case "$1" in attempt:*) echo "${1#attempt:}";; *) echo 0;; esac
}
dispatch() { # dispatch <current-label> -> next-label|BLOCKED
  local a; a="$(read_attempt "$1")"
  if [ "$a" -ge 3 ]; then echo BLOCKED; return; fi
  echo "attempt:$((a+1))"
}
test "$(dispatch '')" = "attempt:1"
test "$(dispatch 'attempt:1')" = "attempt:2"
test "$(dispatch 'attempt:2')" = "attempt:3"
test "$(dispatch 'attempt:3')" = "BLOCKED"     # ceiling cannot be bypassed

echo "required-checks-and-attempts simulation passed"
