#!/usr/bin/env bash
# Proves no workflow contains a merge, production-deployment, or production-migration
# path. `prisma migrate deploy` is only ever run against a disposable localhost
# database; no workflow merges a PR, deploys to production, or migrates a
# secret/production database.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# The active control-tower CI declares the merge/approval/production-deploy guard.
grep -qF 'Reject merge, approval, and production deployment paths' .github/workflows/control-tower-ci.yml

fail=0

# 1) No production migration path: every `prisma migrate deploy` must run against a
#    disposable localhost service and must not reference a production DB secret.
while IFS= read -r wf; do
  if grep -qE 'prisma migrate deploy' "$wf"; then
    if grep -qE 'secrets\.[A-Z_]*(DATABASE|POSTGRES|NEON|PROD)' "$wf"; then
      echo "Production migration path (migrate deploy near a production DB secret) in $wf"
      fail=1
    fi
    # Any DATABASE_URL *assignment* in a migrate-deploy workflow must be a
    # localhost/disposable service (not a production endpoint).
    if grep -nE 'DATABASE_URL:[[:space:]]*"(postgres|postgresql)://' "$wf" | grep -vqE '127\.0\.0\.1|localhost'; then
      echo "migrate deploy in $wf uses a non-localhost DATABASE_URL assignment"
      fail=1
    fi
  fi
done < <(find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

# 2) No actual auto-merge / production-deploy COMMAND exists outside the guard
#    definitions. control-tower-ci.yml and release-gate.yml only contain the guard
#    patterns as grep arguments, so they are excluded from the command scan.
while IFS= read -r wf; do
  case "$wf" in
    .github/workflows/control-tower-ci.yml|.github/workflows/release-gate.yml) continue ;;
  esac
  if grep -nE 'gh pr merge|enablePullRequestAutoMerge|vercel[^A-Za-z]*(deploy[^A-Za-z]*)?--prod' "$wf"; then
    echo "Forbidden merge or production-deploy command in $wf"
    fail=1
  fi
done < <(find .github/workflows -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) | sort)

test "$fail" -eq 0
echo "no-merge/deploy/production-migration simulation passed"
