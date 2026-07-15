#!/usr/bin/env bash
# Runs every REQUIRED suite from the manifest and classifies each result. A
# required suite that is not EXECUTED_PASS fails closed (exit 1). Classifications:
#   EXECUTED_PASS   — the suite ran, produced results, zero skips, exit 0.
#   EXECUTED_FAIL   — the suite ran but exited non-zero.
#   NOT_CONFIGURED  — tooling/manifest missing, or the suite produced no result.
#   SKIPPED_BLOCKER — the suite skipped one or more required tests.
#
# Usage: run-required-suites.sh [manifest] [logdir] [lane]
# Deliberately does NOT use `set -e`: every suite exit status is inspected
# explicitly so one suite's failure cannot short-circuit the classification pass.
set -uo pipefail

MANIFEST="${1:-.github/release-control/required-suites.json}"
LOGDIR="${2:-worker-validation-results}"
LANE="${3:-}"
mkdir -p "$LOGDIR"

if ! command -v jq >/dev/null 2>&1; then
  echo "NOT_CONFIGURED: jq is required to read the required-suite manifest."
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "NOT_CONFIGURED: required-suite manifest not found: $MANIFEST"
  exit 1
fi

# Build the effective required-suite list: defaults plus any lane extras.
suites_json="$(jq -c '.default_required_suites' "$MANIFEST")"
if [ -n "$LANE" ]; then
  extra="$(jq -c --arg lane "$LANE" '.lanes[$lane].extra_required_suites // []' "$MANIFEST")"
  suites_json="$(jq -c -n --argjson a "$suites_json" --argjson b "$extra" '$a + $b')"
fi

count="$(printf '%s' "$suites_json" | jq 'length')"
if [ "${count:-0}" -lt 1 ]; then
  echo "NOT_CONFIGURED: no required suites are declared for lane '${LANE:-default}'."
  exit 1
fi

overall=0
classify_node_test() { # classify_node_test <rc> <log> -> classification
  local rc="$1" log="$2" sk tot
  tot="$(grep -E '^# tests [0-9]+' "$log" | tail -1 | grep -oE '[0-9]+' | tail -1 || true)"
  sk="$(grep -E '^# skipped [0-9]+' "$log" | tail -1 | grep -oE '[0-9]+' | tail -1 || true)"
  if [ -z "$tot" ] || [ -z "$sk" ] || [ "$tot" = "0" ]; then echo "NOT_CONFIGURED"; return; fi
  if [ "$sk" != "0" ]; then echo "SKIPPED_BLOCKER"; return; fi
  if [ "$rc" -ne 0 ]; then echo "EXECUTED_FAIL"; return; fi
  echo "EXECUTED_PASS"
}
classify_playwright() { # classify_playwright <rc> <log> -> classification
  local rc="$1" log="$2"
  if grep -qiE 'No tests found|command not found|Missing script|is not configured' "$log"; then echo "NOT_CONFIGURED"; return; fi
  if grep -qiE '([0-9]+) skipped' "$log"; then
    local sk; sk="$(grep -oiE '([0-9]+) skipped' "$log" | grep -oE '[0-9]+' | head -1)"
    if [ "${sk:-0}" -gt 0 ]; then echo "SKIPPED_BLOCKER"; return; fi
  fi
  if [ "$rc" -ne 0 ]; then echo "EXECUTED_FAIL"; return; fi
  if ! grep -qiE '([0-9]+) passed' "$log"; then echo "NOT_CONFIGURED"; return; fi
  echo "EXECUTED_PASS"
}

for i in $(seq 0 $((count - 1))); do
  id="$(printf '%s' "$suites_json" | jq -r ".[$i].id")"
  cmd="$(printf '%s' "$suites_json" | jq -r ".[$i].command")"
  kind="$(printf '%s' "$suites_json" | jq -r ".[$i].kind")"
  required="$(printf '%s' "$suites_json" | jq -r ".[$i].required")"
  log="$LOGDIR/${id}.log"

  echo "=== required suite: ${id} [${kind}] -> ${cmd} ==="
  bash -c "$cmd" >"$log" 2>&1
  rc=$?

  case "$kind" in
    node-test) classification="$(classify_node_test "$rc" "$log")" ;;
    playwright) classification="$(classify_playwright "$rc" "$log")" ;;
    *) if [ "$rc" -eq 0 ]; then classification="EXECUTED_PASS"; else classification="EXECUTED_FAIL"; fi ;;
  esac

  echo "SUITE ${id} => ${classification} (rc=${rc})"
  if [ "$required" = "true" ] && [ "$classification" != "EXECUTED_PASS" ]; then
    echo "BLOCK: required suite ${id} is ${classification} — worker validation cannot pass."
    overall=1
  fi
done

if [ "$overall" -ne 0 ]; then
  echo "Required-suite validation FAILED CLOSED."
else
  echo "All required suites EXECUTED_PASS."
fi
exit "$overall"
