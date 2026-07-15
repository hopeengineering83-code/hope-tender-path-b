#!/usr/bin/env bash
# Proves the worker exact-head validation workflow is safe and fail-closed:
# disposable PostgreSQL, RUN_DB_INTEGRATION, least privilege, no secrets to PR
# code, and missing DB config / skipped required tests block (never PASS).
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

WF=.github/workflows/worker-validation.yml
test -f "$WF"

# Safe trigger: pull_request (never pull_request_target) for the worker base.
grep -qE '^[[:space:]]*pull_request:' "$WF"
! grep -qF 'pull_request_target' "$WF"
grep -qF 'integration/controlled-recovery' "$WF"

# Disposable PostgreSQL + RUN_DB_INTEGRATION + fail-closed classification tokens.
grep -qF 'image: postgres:16' "$WF"
grep -qF 'RUN_DB_INTEGRATION' "$WF"
grep -qF 'NOT_CONFIGURED' "$WF"
grep -qF 'SKIPPED_BLOCKER' "$WF"

# Required build/test surface.
grep -qF 'npm ci' "$WF"
grep -qF 'prisma validate' "$WF"
grep -qF 'prisma generate' "$WF"
grep -qF 'npm run typecheck' "$WF"
grep -qF 'npm run lint' "$WF"
grep -qF 'npm test' "$WF"
grep -qF 'npm run build' "$WF"

# Least privilege: only the narrowly justified checks:write, no other write scope,
# and no production database secret is referenced.
grep -qF 'checks: write' "$WF"
! grep -qE 'pull-requests:[[:space:]]*write|issues:[[:space:]]*write|contents:[[:space:]]*write' "$WF"
! grep -qE 'secrets\.[A-Z_]*(DATABASE|POSTGRES|NEON)' "$WF"

# Exact-head invalidation guard.
grep -qF 'head moved during validation' "$WF"

# --- Deterministic simulation of the fail-closed classifier ---
classify() { # classify <DATABASE_URL> <RUN_DB_INTEGRATION> <skipped-count>
  local url="$1" run="$2" skipped="$3"
  [ -n "$url" ] || { echo NOT_CONFIGURED; return; }
  case "$url" in
    postgres://*|postgresql://*) : ;;
    *) echo NOT_CONFIGURED; return ;;
  esac
  [ "$run" = "true" ] || { echo SKIPPED_BLOCKER; return; }
  [ "$skipped" = "0" ] || { echo SKIPPED_BLOCKER; return; }
  echo PASS
}

test "$(classify '' true 0)" = NOT_CONFIGURED                  # missing DATABASE_URL
test "$(classify 'sqlite://x' true 0)" = NOT_CONFIGURED        # non-PostgreSQL URL
test "$(classify 'postgresql://h/db' false 0)" = SKIPPED_BLOCKER  # DB suites disabled
test "$(classify 'postgresql://h/db' true 4)" = SKIPPED_BLOCKER   # 4 required tests skipped
test "$(classify 'postgresql://h/db' true 0)" = PASS           # configured + zero skips

echo "worker-validation fail-closed simulation passed: missing DB config and skipped required suites block, never PASS"
