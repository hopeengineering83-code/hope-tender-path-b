#!/usr/bin/env bash
# Proves the independent-auditor identity is defined and fails closed: an empty
# allow-list authorizes no one; the PR author and same-account markers are never
# independent; only an allow-listed distinct human collaborator or an allow-listed
# trusted GitHub App can be accepted.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONFIG=.github/release-control/independent-auditors.json
CONTROLLER=.github/workflows/integration-controller.yml

test -f "$CONFIG"
jq empty "$CONFIG"
# The shipped list is intentionally empty so the gate fails closed until a real
# independent identity is provisioned.
test "$(jq '.independent_auditor_logins | length' "$CONFIG")" = "0"
test "$(jq '.independent_auditor_app_slugs | length' "$CONFIG")" = "0"
test "$(jq -r '.rules.same_account_marker_is_not_independent' "$CONFIG")" = "true"

# Controller loads the allow-list and rejects same-account / non-allow-listed authors.
grep -qF 'independent-auditors.json' "$CONTROLLER"
grep -qF 'independent_auditor_logins' "$CONTROLLER"
grep -qF 'independent_auditor_app_slugs' "$CONTROLLER"
grep -qF 'author self-audit is never independent' "$CONTROLLER"
grep -qF 'human auditor must be allow-listed' "$CONTROLLER"

# --- Deterministic simulation of the identity rule ---
AUTHOR="worker-account"
accept() { # accept <commenter-login> <type: User|Bot> <allowed-logins csv> <allowed-apps csv>
  local who="$1" typ="$2" logins="$3" apps="$4"
  # a same-account/author marker is never independent
  [ "$who" != "$AUTHOR" ] || { echo REJECT; return; }
  if [ "$typ" = "Bot" ]; then
    local slug="${who%\[bot\]}"
    case ",$apps," in *",$slug,"*) echo ACCEPT; return ;; esac
    echo REJECT; return
  fi
  case ",$logins," in *",$who,"*) echo ACCEPT; return ;; esac
  echo REJECT
}

# Empty allow-list => nobody is authorized (fail closed).
test "$(accept independent-maintainer User "" "")" = REJECT
test "$(accept some-app[bot] Bot "" "")" = REJECT
# Author self-audit is never independent, even if somehow listed.
test "$(accept "$AUTHOR" User "$AUTHOR" "")" = REJECT
# A distinct allow-listed human collaborator is accepted.
test "$(accept independent-maintainer User "independent-maintainer" "")" = ACCEPT
# A non-listed human is rejected.
test "$(accept random-user User "independent-maintainer" "")" = REJECT
# An allow-listed trusted GitHub App is accepted; a non-listed app is rejected.
test "$(accept trusted-auditor[bot] Bot "" "trusted-auditor")" = ACCEPT
test "$(accept rogue-app[bot] Bot "" "trusted-auditor")" = REJECT

echo "independent-identity simulation passed"
