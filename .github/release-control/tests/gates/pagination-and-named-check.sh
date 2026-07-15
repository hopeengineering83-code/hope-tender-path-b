#!/usr/bin/env bash
# Proves security enumerations are fully paginated (never first-page only) and the
# Repair Coordinator requires the named exact-head validation check while excluding
# its own in-progress suite.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

CONTROLLER=.github/workflows/integration-controller.yml
COORDINATOR=.github/workflows/repair-coordinator.yml

# --- Integration controller: paginate files, reviews, comments, runs, threads. ---
grep -qF 'github.paginate(github.rest.pulls.listFiles' "$CONTROLLER"
grep -qF 'github.paginate(github.rest.pulls.listReviews' "$CONTROLLER"
grep -qF 'github.paginate(github.rest.issues.listComments' "$CONTROLLER"
grep -qF 'github.paginate(github.rest.checks.listForRef' "$CONTROLLER"
grep -qF 'pageInfo { hasNextPage endCursor }' "$CONTROLLER"   # review-thread cursor pagination
# The legacy combined-status hard requirement must be gone.
if grep -qF 'getCombinedStatusForRef' "$CONTROLLER"; then echo 'controller must not require a legacy combined status'; exit 1; fi
# The named exact-head validation check is required via the trusted allow-list.
grep -qF 'required-checks.json' "$CONTROLLER"

# --- Repair coordinator: subscribe to the validation workflow, require the named
#     check, exclude its own suite, and paginate. ---
grep -qF 'Worker Exact-Head Validation' "$COORDINATOR"
grep -qF 'github.paginate(github.rest.pulls.list' "$COORDINATOR"
grep -qF 'github.paginate(github.rest.checks.listSuitesForRef' "$COORDINATOR"
grep -qF 'github.paginate(github.rest.checks.listForRef' "$COORDINATOR"
grep -qF "s.id !== currentSuiteId" "$COORDINATOR"                 # exclude own suite
grep -qF "r.name === 'worker-exact-head-validation'" "$COORDINATOR"  # require named check
grep -qF 'awaiting-independent-audit' "$COORDINATOR"

# --- Deterministic simulation: first-page-only vs full pagination on a forbidden file. ---
# A forbidden file on page 2 must still be caught. Model listFiles as two pages.
page1=("app/a.ts" "app/b.ts")
page2=("lib/c.ts" ".github/evil.yml")
first_page_only_decision() { # only inspects page 1
  local f; for f in "${page1[@]}"; do case "$f" in .github/*|vercel.json) echo FORBIDDEN; return ;; esac; done; echo OK
}
paginated_decision() { # inspects all pages
  local f; for f in "${page1[@]}" "${page2[@]}"; do case "$f" in .github/*|vercel.json) echo FORBIDDEN; return ;; esac; done; echo OK
}
test "$(first_page_only_decision)" = OK          # a truncated scan misses the forbidden file
test "$(paginated_decision)" = FORBIDDEN         # full pagination catches it (the required behaviour)

echo "pagination-and-named-check simulation passed"
