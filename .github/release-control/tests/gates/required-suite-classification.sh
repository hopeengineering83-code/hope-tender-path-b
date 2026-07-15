#!/usr/bin/env bash
# Proves the required-suite runner classifies each suite and fails closed:
# EXECUTED_PASS only when a suite ran with results and zero skips; SKIPPED_BLOCKER
# on any skip; EXECUTED_FAIL on non-zero; NOT_CONFIGURED when no result is produced.
# A required suite that is not EXECUTED_PASS blocks (non-zero exit).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

RUNNER=.github/release-control/run-required-suites.sh
MANIFEST=.github/release-control/required-suites.json
test -f "$RUNNER"
test -f "$MANIFEST"
jq empty "$MANIFEST"

command -v jq >/dev/null 2>&1 || { echo "jq required for this simulation"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Helper: write a manifest with a single node-test suite whose command emits a
# canned node:test TAP summary, then assert the runner's overall pass/block.
run_case() { # run_case <expect: PASS|BLOCK> <script-body>
  local expect="$1" body="$2"
  cat > "$TMP/suite.sh" <<EOF
#!/usr/bin/env bash
${body}
EOF
  chmod +x "$TMP/suite.sh"
  cat > "$TMP/manifest.json" <<EOF
{ "default_required_suites": [ { "id": "sim", "kind": "node-test", "command": "bash $TMP/suite.sh", "required": true } ] }
EOF
  if bash "$RUNNER" "$TMP/manifest.json" "$TMP/logs" "" >"$TMP/out.log" 2>&1; then
    got=PASS
  else
    got=BLOCK
  fi
  if [ "$got" != "$expect" ]; then
    echo "expected $expect but got $got for case"; cat "$TMP/out.log"; exit 1
  fi
}

# EXECUTED_PASS: tests ran, zero skips, exit 0.
run_case PASS 'printf "# tests 5\n# pass 5\n# fail 0\n# skipped 0\n"; exit 0'
# SKIPPED_BLOCKER: a required test was skipped.
run_case BLOCK 'printf "# tests 5\n# pass 4\n# fail 0\n# skipped 1\n"; exit 0'
# EXECUTED_FAIL: non-zero exit even with a summary.
run_case BLOCK 'printf "# tests 5\n# pass 4\n# fail 1\n# skipped 0\n"; exit 1'
# NOT_CONFIGURED: no summary produced at all (e.g., tooling missing).
run_case BLOCK 'echo "command not found: tsx"; exit 127'
# NOT_CONFIGURED: zero tests executed.
run_case BLOCK 'printf "# tests 0\n# pass 0\n# fail 0\n# skipped 0\n"; exit 0'

# A manifest that declares no required suites must fail closed (NOT_CONFIGURED).
echo '{ "default_required_suites": [] }' > "$TMP/empty.json"
if bash "$RUNNER" "$TMP/empty.json" "$TMP/logs2" "" >/dev/null 2>&1; then
  echo "empty manifest must block"; exit 1
fi

# A missing manifest must fail closed.
if bash "$RUNNER" "$TMP/does-not-exist.json" "$TMP/logs3" "" >/dev/null 2>&1; then
  echo "missing manifest must block"; exit 1
fi

# The real manifest requires the browser e2e suite (not just npm test).
grep -q '"browser-e2e"' "$MANIFEST"

echo "required-suite-classification simulation passed"
