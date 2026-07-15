#!/usr/bin/env bash
# Proves the worker validation seeds authenticated E2E users deterministically
# with CI-only credentials (derived from the run id) and references no production
# secrets, so the authenticated Playwright projects can actually run.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WF=.github/workflows/worker-validation.yml
test -f "$WF"

# Authenticated E2E is enabled and seeded.
grep -qF 'E2E_FULL_AUTH: "true"' "$WF"
grep -qF 'E2E_SEED_ALLOWED: "true"' "$WF"
grep -qF 'E2E_TEST_PASSWORD:' "$WF"
grep -qF 'E2E_SECOND_PASSWORD:' "$WF"
grep -qF 'E2E_TEST_EMAIL:' "$WF"
grep -qF 'E2E_SECOND_EMAIL:' "$WF"
grep -qF 'scripts/seed-e2e-user.mjs' "$WF"

# Credentials must be CI-only, derived from the run id — not static/production.
grep -qE 'E2E_TEST_PASSWORD:.*github\.run_id' "$WF"
grep -qE 'E2E_SECOND_PASSWORD:.*github\.run_id' "$WF"

# No production secret is referenced anywhere in the workflow.
if grep -qE 'secrets\.[A-Z_]*(DATABASE|POSTGRES|NEON|PASSWORD|E2E)' "$WF"; then
  echo 'worker validation must not reference a production/secret credential'
  exit 1
fi

# The seed script the workflow depends on exists in the repository.
test -f scripts/seed-e2e-user.mjs

echo "e2e-seed-fail-closed simulation passed"
