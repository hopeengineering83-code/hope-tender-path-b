#!/usr/bin/env bash
# Proves green CI is not approval: integration requires an authorized, independent
# CONTROL_TOWER_AUDIT tied to the EXACT head. A stale-SHA audit, a missing audit,
# an author self-audit, a non-independent role, or a head move all fail closed.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml
COORDINATOR=.github/workflows/repair-coordinator.yml

# --- Static contract: the controller enforces an independent, exact-head audit ---
grep -qF 'CONTROL_TOWER_AUDIT' "$CONTROLLER"
grep -qF "fieldOf(lines, 'Decision') !== 'ACCEPT'" "$CONTROLLER"
grep -qF 'Reviewer-Role' "$CONTROLLER"
grep -qF 'Reviewed-Head-SHA' "$CONTROLLER"
grep -qF 'author self-audit is never independent' "$CONTROLLER"   # independent of the author
grep -qF 'PR head moved during preflight' "$CONTROLLER"          # head move invalidates
grep -qF 'worker-exact-head-validation' "$CONTROLLER"            # exact-head evidence required
grep -qF 'Green CI alone is not approval' "$CONTROLLER"

# Green CI alone must not approve: the coordinator only marks awaiting-independent-audit
# and never mints approval or integration authority. Use explicit `if` blocks so the
# negative assertions actually fail closed under `set -e` (a bare `! grep` would not).
grep -qF 'awaiting-independent-audit' "$COORDINATOR"
if grep -qF 'APPROVED_HEAD_SHA' "$COORDINATOR"; then echo 'coordinator must not mint APPROVED_HEAD_SHA'; exit 1; fi
if grep -qF 'ready-for-integrator' "$COORDINATOR"; then echo 'coordinator must not mint ready-for-integrator'; exit 1; fi

# --- Deterministic simulation of the audit-acceptance rule ---
HEAD="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
OLD="0000000000000000000000000000000000000000"
AUTHOR="worker-bot"
REVIEWER="independent-maintainer"

field() { # field <key> <text>
  printf '%s\n' "$2" | awk -F': *' -v k="$1" 'tolower($1)==tolower(k){print $2; exit}'
}

accept() { # accept <text> <commenter> -> ACCEPT | REJECT (uses global $HEAD, $AUTHOR)
  local text="$1" who="$2"
  printf '%s\n' "$text" | grep -qx 'CONTROL_TOWER_AUDIT' || { echo REJECT; return; }
  [ "$(field Decision "$text")" = "ACCEPT" ] || { echo REJECT; return; }
  [ "$(field Reviewer-Role "$text" | tr '[:upper:]' '[:lower:]')" = "independent" ] || { echo REJECT; return; }
  [ "$(field Reviewed-Head-SHA "$text")" = "$HEAD" ] || { echo REJECT; return; }
  [ "$who" != "$AUTHOR" ] || { echo REJECT; return; }
  echo ACCEPT
}

VALID="CONTROL_TOWER_AUDIT
Decision: ACCEPT
Reviewed-Head-SHA: ${HEAD}
Reviewer-Role: independent"

STALE="CONTROL_TOWER_AUDIT
Decision: ACCEPT
Reviewed-Head-SHA: ${OLD}
Reviewer-Role: independent"

NO_AUDIT="Looks good, all checks are green, ship it."

NON_INDEPENDENT="CONTROL_TOWER_AUDIT
Decision: ACCEPT
Reviewed-Head-SHA: ${HEAD}
Reviewer-Role: worker"

test "$(accept "$VALID" "$REVIEWER")" = ACCEPT             # valid independent exact-head audit
test "$(accept "$STALE" "$REVIEWER")" = REJECT             # audit for an old SHA cannot integrate
test "$(accept "$NO_AUDIT" "$REVIEWER")" = REJECT          # green checks without audit cannot integrate
test "$(accept "$VALID" "$AUTHOR")" = REJECT               # author self-audit is not independent
test "$(accept "$NON_INDEPENDENT" "$REVIEWER")" = REJECT   # non-independent reviewer role rejected

# Head movement invalidates a previously valid audit — Reviewed-Head-SHA no longer matches.
HEAD="feedfacefeedfacefeedfacefeedfacefeedface"
test "$(accept "$VALID" "$REVIEWER")" = REJECT

echo "independent-audit gate simulation passed: green CI is not approval; stale/missing/self/non-independent/moved-head audits all fail closed"
