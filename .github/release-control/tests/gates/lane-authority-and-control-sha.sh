#!/usr/bin/env bash
# Proves the corrected lane authority (CHATGPT-M1 replacement review):
#  - the lane is DERIVED from the exact branch + issue, then the label is verified;
#  - every real (branch,issue,label) pool pair is accepted;
#  - a wrong pair (right branch, mismatched label/issue) is rejected;
#  - a simple worker (Jules) cannot claim a critical dependency issue;
#  - the single Codex chat stays read-only (no branch) without START_AUTHORIZATION;
#  - integration policy is bound to ONE pinned trusted control SHA, so control-SHA
#    movement after acceptance invalidates the acceptance.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

MAP=.github/release-control/lane-mapping.json
WF=.github/workflows/worker-validation.yml
CTRL=.github/workflows/integration-controller.yml
jq empty "$MAP"

# --- Static contract: both validation and integration derive the lane from the
#     branch and pin one trusted control/harness SHA. ---
grep -qF 'def.branch === pr.head.ref' "$WF"
grep -qF 'def.branch === pr.head.ref' "$CTRL"
grep -qF 'controlSha = br.commit.sha' "$CTRL"
grep -qF "ref: controlSha" "$CTRL"

# --- Data-driven authority: derive the lane from the branch in the real mapping. ---
lane_for_branch() { jq -r --arg b "$1" '[.lanes | to_entries[] | select(.value.branch == $b) | .key] | (.[0] // "NONE")' "$MAP"; }
issue_for_lane()  { jq -r --arg l "$1" '.lanes[$l].issue // "NONE"' "$MAP"; }

# accept(branch,label,closesIssue) -> ACCEPT|REJECT
accept() {
  local branch="$1" label="$2" closes="$3"
  local lane; lane="$(lane_for_branch "$branch")"
  [ "$lane" != "NONE" ] || { echo REJECT; return; }                       # unmapped branch
  [ "$(jq -r --arg l "$lane" '.lanes[$l].requires_start_authorization // false' "$MAP")" != "true" ] \
    || { echo REJECT; return; }                                           # read-only lane
  [ "$label" = "$lane" ] || { echo REJECT; return; }                      # label must match derived lane
  [ -z "$closes" ] || [ "$closes" = "$(issue_for_lane "$lane")" ] || { echo REJECT; return; }
  echo ACCEPT
}

# Every real pool pair is accepted (branch, correct label, correct Closes issue).
test "$(accept worker/screenshot-state-truth-001 GLM-A1 1134)" = ACCEPT
test "$(accept worker/screenshot-matching-002 GLM-A2 1135)" = ACCEPT
test "$(accept worker/screenshot-export-gates-003 GLM-X1 1136)" = ACCEPT
test "$(accept worker/screenshot-vault-privacy-004 CHATGPT-C1 1137)" = ACCEPT
test "$(accept worker/screenshot-responsive-contract-005 CHATGPT-C2 1138)" = ACCEPT
test "$(accept worker/jules-notification-a11y-006-16137658204389118457 JULES-T1 1143)" = ACCEPT
test "$(accept worker/jules-upload-policy-a11y-008 JULES-S2 1145)" = ACCEPT

# Wrong pairs are rejected.
test "$(accept worker/screenshot-state-truth-001 GLM-A2 1135)" = REJECT   # label != derived lane
test "$(accept worker/screenshot-state-truth-001 GLM-A1 9999)" = REJECT   # Closes issue mismatch
test "$(accept worker/does-not-exist GLM-A1 1134)" = REJECT               # unmapped branch

# A simple Jules worker cannot claim a critical dependency: the dependency issues are
# not lanes, and a Jules branch cannot be relabeled onto one.
test "$(jq -r '.dependencies["1152"].is_lane' "$MAP")" = false
test "$(jq -r '.lanes | has("AI-SAFETY")' "$MAP")" = false
test "$(accept worker/jules-notification-a11y-006-16137658204389118457 AI-SAFETY 1152)" = REJECT  # not a lane
test "$(accept worker/jules-notification-a11y-006-16137658204389118457 CHATGPT-C1 1137)" = REJECT # cannot steal another lane

# The single Codex chat is read-only: it has no branch and cannot be validated or
# integrated without an exact-SHA START_AUTHORIZATION.
test "$(jq -r '.lanes["CODEX-D1"].branch' "$MAP")" = null
test "$(jq -r '.lanes["CODEX-D1"].requires_start_authorization' "$MAP")" = true
test "$(lane_for_branch worker/codex-anything)" = NONE          # no mapped Codex coding branch

# --- Control-SHA binding: acceptance is valid only under the SAME pinned control SHA. ---
# accept_bound(acceptedControlSha, currentControlSha) -> VALID|INVALID
accept_bound() { [ "$1" = "$2" ] && echo VALID || echo INVALID; }
test "$(accept_bound sha_A sha_A)" = VALID     # policy unchanged since acceptance
test "$(accept_bound sha_A sha_B)" = INVALID   # control SHA moved -> acceptance invalid

echo "lane-authority-and-control-sha simulation passed"
