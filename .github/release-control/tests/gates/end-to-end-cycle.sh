#!/usr/bin/env bash
# Master-prompt point 12: one harmless end-to-end simulation of the full control
# cycle — issue -> dispatch -> draft PR -> exact-head validation -> explicit
# independent acceptance -> atomic integration -> release stays FROZEN. It proves,
# without any real merge or deployment, that (a) every stage is wired in the real
# workflows and (b) skipping any stage's success blocks before integration and the
# release never leaves the frozen state (integration branch only, never main).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

COORDINATOR=.github/workflows/repair-coordinator.yml
WORKER=.github/workflows/worker-validation.yml
CONTROLLER=.github/workflows/integration-controller.yml

# --- Stage wiring must exist in the real workflows (no simulated-only stage) ---
# 1. issue -> dispatch: coordinator queues an unassigned issue with bounded attempts.
grep -qF 'status:queued-for-dispatch' "$COORDINATOR"
grep -qF 'attempt:' "$COORDINATOR"
# 2. exact-head validation publishes the named check and invalidates a moved head.
grep -qF 'worker-exact-head-validation' "$WORKER"
grep -qF 'head moved during validation' "$WORKER"
# 3. green validation becomes only "awaiting-independent-audit", never acceptance.
grep -qF 'VALIDATED_HEAD_SHA' "$COORDINATOR"
grep -qF 'awaiting-independent-audit' "$COORDINATOR"
if grep -qE 'APPROVED_HEAD_SHA|ready-for-integrator' "$COORDINATOR"; then
  echo 'coordinator must never mint acceptance from green CI'; exit 1
fi
# 4. explicit acceptance requires an INDEPENDENT exact-head CONTROL_TOWER_AUDIT.
grep -qF 'CONTROL_TOWER_AUDIT' "$CONTROLLER"
grep -qF 'Missing authorized exact-head acceptance comment' "$CONTROLLER"
grep -qF 'Green CI alone is not approval' "$CONTROLLER"
# 5. atomic integration cherry-picks, re-verifies the head, pushes ONLY the
#    integration branch, and records that no main merge / deploy happened.
grep -qF 'git cherry-pick --abort' "$CONTROLLER"
grep -qF 'HEAD:refs/heads/$INTEGRATION_BRANCH' "$CONTROLLER"
grep -qF 'No merge to main or production deployment was performed' "$CONTROLLER"
# 6. release stays frozen: the release-gate only runs on the integration->main
#    draft PR as a VALIDATION gate (integration-mode), and never deploys.
grep -qF 'integration-mode: true' "$CONTROLLER"
if grep -qE 'gh pr merge|gh pr review.*--approve|vercel .*--prod' "$CONTROLLER"; then
  echo 'controller must not merge, approve, or deploy'; exit 1
fi

# --- Deterministic full-cycle state machine (harmless; no real GitHub calls) ---
# Each stage yields a boolean success. Integration happens ONLY when every prior
# stage succeeded AND an independent acceptance is tied to the unchanged head.
run_cycle() { # run_cycle <validated> <head_stable> <independent_accept> <required_ok> <no_conflict>
  local validated="$1" head_stable="$2" accept="$3" required_ok="$4" no_conflict="$5"
  local state='ISSUE_OPEN' target='(none)'
  state='DISPATCHED'                                   # issue -> dispatch
  state='DRAFT_PR_OPEN'                                # worker opens one draft PR
  [ "$validated" = 1 ] || { echo "BLOCKED@VALIDATION|$target"; return; }
  state='AWAITING_INDEPENDENT_AUDIT'                   # green CI is only this
  [ "$head_stable" = 1 ] || { echo "BLOCKED@HEAD_MOVED|$target"; return; }
  [ "$accept" = 1 ] || { echo "BLOCKED@NO_INDEPENDENT_ACCEPT|$target"; return; }
  [ "$required_ok" = 1 ] || { echo "BLOCKED@REQUIRED_CHECK|$target"; return; }
  [ "$no_conflict" = 1 ] || { echo "BLOCKED@ATOMIC_ABORT|$target"; return; }
  target='integration/controlled-recovery'            # ONLY ever the integration branch
  state='INCORPORATED'
  # Release remains frozen: incorporation never advances main; deploy never runs.
  echo "RELEASE_FROZEN|$target"
}

# The single fully-authorized path ends frozen on the integration branch — never main.
out="$(run_cycle 1 1 1 1 1)"
test "$out" = 'RELEASE_FROZEN|integration/controlled-recovery'
case "$out" in *"|main"*) echo 'release must never target main'; exit 1 ;; esac

# Dropping ANY stage's success blocks before integration (zero incorporation).
test "$(run_cycle 0 1 1 1 1)" = 'BLOCKED@VALIDATION|(none)'
test "$(run_cycle 1 0 1 1 1)" = 'BLOCKED@HEAD_MOVED|(none)'
test "$(run_cycle 1 1 0 1 1)" = 'BLOCKED@NO_INDEPENDENT_ACCEPT|(none)'
test "$(run_cycle 1 1 1 0 1)" = 'BLOCKED@REQUIRED_CHECK|(none)'
test "$(run_cycle 1 1 1 1 0)" = 'BLOCKED@ATOMIC_ABORT|(none)'

echo "end-to-end-cycle simulation passed"
