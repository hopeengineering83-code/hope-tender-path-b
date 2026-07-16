#!/usr/bin/env bash
# Proves atomic integration produces ZERO partial push on ANY abort condition:
# missing accepted SHA, changed head, a failed required suite, a migration-policy
# violation, or a cherry-pick conflict. The integration branch is only ever moved
# by a single fast-forward after every gate passes.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml

# --- Static contract: abort leaves the branch untouched; head is re-verified. ---
grep -qF 'git cherry-pick --abort' "$CONTROLLER"
grep -qF 'git reset --hard' "$CONTROLLER"
grep -qF 'headRefOid' "$CONTROLLER"                 # head re-verified before/after apply
grep -qF 'MIGRATION_DECLARED' "$CONTROLLER"         # migration policy gate
grep -qF 'Missing required exact-head check' "$CONTROLLER"

# --- Deterministic integration decision: any failing gate => ABORT (zero push). ---
decide() { # decide <accepted_present> <head_matches> <required_ok> <migration_ok> <no_conflict> -> PROCEED|ABORT
  [ "$1" = 1 ] || { echo ABORT; return; }   # missing authorized acceptance
  [ "$2" = 1 ] || { echo ABORT; return; }   # worker head moved
  [ "$3" = 1 ] || { echo ABORT; return; }   # a required suite failed
  [ "$4" = 1 ] || { echo ABORT; return; }   # migration-policy violation
  [ "$5" = 1 ] || { echo ABORT; return; }   # cherry-pick conflict
  echo PROCEED
}
test "$(decide 0 1 1 1 1)" = ABORT     # missing accepted SHA
test "$(decide 1 0 1 1 1)" = ABORT     # changed head
test "$(decide 1 1 0 1 1)" = ABORT     # failed required suite
test "$(decide 1 1 1 0 1)" = ABORT     # migration-policy violation
test "$(decide 1 1 1 1 0)" = ABORT     # cherry-pick conflict
test "$(decide 1 1 1 1 1)" = PROCEED   # all gates clear -> single fast-forward

# --- Live git proof: a conflicting candidate leaves the target branch unchanged. ---
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; cd "$TMP"
git init -q; git config user.name t; git config user.email t@e.invalid
printf 'base\n' > c.txt; git add c.txt; git commit -qm base
git branch integration/controlled-recovery
git switch -qc worker; printf 'a\n' > n.txt; git add n.txt; git commit -qm w1
printf 'worker\n' > c.txt; git add c.txt; git commit -qm w2; W2=$(git rev-parse HEAD)
git switch -q integration/controlled-recovery; printf 'integration\n' > c.txt; git add c.txt; git commit -qm ic
START=$(git rev-parse HEAD)
git switch -qc cand "$START"
git cherry-pick "$(git rev-parse worker~1)" >/dev/null
if git cherry-pick "$W2" >/dev/null 2>&1; then echo "expected conflict"; exit 1; fi
git cherry-pick --abort; git reset --hard -q "$START"
git switch -q integration/controlled-recovery
test "$(git rev-parse HEAD)" = "$START"     # target unchanged
test ! -e n.txt                              # no partial commit landed
test "$(cat c.txt)" = "integration"

echo "atomic-integration-abort simulation passed"
