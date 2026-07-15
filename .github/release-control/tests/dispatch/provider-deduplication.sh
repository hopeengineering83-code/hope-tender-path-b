#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

REGISTRY=.github/agents/providers.json
DISPATCHER=.github/workflows/agent-dispatcher.yml
COORDINATOR=.github/workflows/repair-coordinator.yml

test "$(jq -r '.default_provider' "$REGISTRY")" = "glm"
test "$(jq -r '.providers["chatgpt-code"].capacity' "$REGISTRY")" = "2"
test "$(jq -r '.rules.one_provider_per_finding' "$REGISTRY")" = "true"
test "$(jq -r '.rules.same_pr_for_revisions' "$REGISTRY")" = "true"

grep -q "chatgpt-code" "$DISPATCHER"
grep -q "WAITING_FOR_CHATGPT_CODE_CHAT" "$DISPATCHER"
grep -q "WAITING_FOR_GLM_CHAT" "$DISPATCHER"
! grep -q "APPROVED_HEAD_SHA" "$COORDINATOR"
grep -q "VALIDATED_HEAD_SHA" "$COORDINATOR"

STATE=$(mktemp)
trap 'rm -f "$STATE"' EXIT

record_dispatch() {
  local issue=$1
  local provider=$2
  local marker="control-tower-dispatch:${issue}:${provider}"
  if grep -Fqx "$marker" "$STATE"; then
    return 2
  fi
  printf '%s\n' "$marker" >> "$STATE"
}

record_dispatch 1134 glm
if record_dispatch 1134 glm; then
  echo "duplicate dispatch was not rejected"
  exit 1
else
  test "$?" = "2"
fi
record_dispatch 1137 chatgpt-code

test "$(grep -c '^control-tower-dispatch:1134:glm$' "$STATE")" = "1"
test "$(grep -c '^control-tower-dispatch:1137:chatgpt-code$' "$STATE")" = "1"

echo "dispatch simulation passed: provider registry valid and duplicate dispatch rejected"
