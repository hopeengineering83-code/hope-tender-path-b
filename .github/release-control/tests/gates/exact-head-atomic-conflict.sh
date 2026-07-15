#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml
COORDINATOR=.github/workflows/repair-coordinator.yml
RELEASE_GATE=.github/workflows/release-gate.yml

grep -q "CONTROL_TOWER_AUDIT" "$CONTROLLER"
grep -q "Missing authorized exact-head acceptance comment" "$CONTROLLER"
grep -q "currentSuiteId" "$CONTROLLER"
grep -q "VALIDATED_HEAD_SHA" "$COORDINATOR"
! grep -q "APPROVED_HEAD_SHA" "$COORDINATOR"
! grep -q "release-control/findings" "$RELEASE_GATE"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

git init -q
git config user.name test
git config user.email test@example.invalid
printf 'base\n' > config.txt
git add config.txt
git commit -qm base
BASE_SHA=$(git rev-parse HEAD)

git branch integration/controlled-recovery

git switch -qc worker "$BASE_SHA"
printf 'first worker commit\n' > first.txt
git add first.txt
git commit -qm worker-one
WORKER_ONE=$(git rev-parse HEAD)
printf 'worker value\n' > config.txt
git add config.txt
git commit -qm worker-two
WORKER_TWO=$(git rev-parse HEAD)

git switch -q integration/controlled-recovery
printf 'integration value\n' > config.txt
git add config.txt
git commit -qm integration-change
START_SHA=$(git rev-parse HEAD)

git switch -qc candidate "$START_SHA"
git cherry-pick "$WORKER_ONE" >/dev/null
if git cherry-pick "$WORKER_TWO" >/dev/null 2>&1; then
  echo "expected cherry-pick conflict did not occur"
  exit 1
fi
git cherry-pick --abort
git reset --hard -q "$START_SHA"

git switch -q integration/controlled-recovery
test "$(git rev-parse HEAD)" = "$START_SHA"
test ! -e first.txt
test "$(cat config.txt)" = "integration value"

echo "gate simulation passed: conflict left integration unchanged and no partial commit was pushed"
