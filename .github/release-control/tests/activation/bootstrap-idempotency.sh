#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

BOOTSTRAP=.github/workflows/control-plane-bootstrap.yml
README=.github/release-control/README.md

test -f "$BOOTSTRAP"
test -f "$README"
grep -q "automation/control-plane" "$BOOTSTRAP"
grep -q "integration/controlled-recovery" "$BOOTSTRAP"
grep -q "draft: true" "$BOOTSTRAP"
grep -q "not an active autonomous control plane" "$README"

if grep -Eq 'gh pr merge|enablePullRequestAutoMerge|vercel( deploy)? .*--prod' "$BOOTSTRAP"; then
  echo "bootstrap workflow contains a forbidden release action"
  exit 1
fi

STATE=$(mktemp -d)
trap 'rm -rf "$STATE"' EXIT

ensure_branch() {
  local branch=$1
  local path="$STATE/branches/${branch//\//__}"
  mkdir -p "$STATE/branches"
  test -e "$path" || printf '%s\n' main-sha > "$path"
}

ensure_draft_integration_pr() {
  mkdir -p "$STATE/prs"
  local path="$STATE/prs/integration-controlled-recovery-to-main"
  if test -e "$path"; then
    grep -qx 'draft=true' "$path"
    return
  fi
  printf '%s\n' 'draft=true' > "$path"
}

for _ in 1 2 3; do
  ensure_branch automation/control-plane
  ensure_branch integration/controlled-recovery
  ensure_draft_integration_pr
done

test "$(find "$STATE/branches" -type f | wc -l | tr -d ' ')" = "2"
test "$(find "$STATE/prs" -type f | wc -l | tr -d ' ')" = "1"
grep -qx 'draft=true' "$STATE/prs/integration-controlled-recovery-to-main"

echo "activation simulation passed: two controlled branches, one draft PR, zero release action"
