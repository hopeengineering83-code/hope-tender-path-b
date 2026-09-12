#!/usr/bin/env bash
# TEMPORARY — owner-authorized helper for the temporary-preview-hosted-acceptance
# job in .github/workflows/lockfile-refresh-artifact.yml. Delete alongside that
# job once the hosted acceptance is complete. See PR #1175.
#
# Waits for a tender's durable AiJob chain to settle.
#
# WHY THIS IS NOT A run-next DRAIN LOOP
# ------------------------------------
# The obvious loop — POST /api/ai-jobs/run-next until it answers QUEUE_EMPTY —
# reports success the moment nothing is *claimable*, which is not the same as
# nothing being *in flight*. Both manual gates schedule a request-scoped wake
# (lib/ai-jobs/request-scoped-engine-worker-wake.ts): the route returns 202 and
# a background dispatcher immediately claims the job it just enqueued. An
# external drain arriving a second later finds the row already RUNNING, gets
# QUEUE_EMPTY, and concludes the pipeline finished — while ENGINE_RUN is only
# just starting. That is exactly how the previous acceptance attempt walked past
# a live Engine run and then reported the tender as not exportable.
#
# So poll the job rows themselves. GET /api/ai-jobs?tenderId=... is
# owner-scoped and returns each job's real status, which distinguishes RUNNING
# from absent. run-next is still called on every tick, but only as a safety net
# for a job no wake ever claimed — never as the completion signal.
set -euo pipefail

MAX_TICKS="${1:-60}"
SLEEP_SECONDS="${2:-10}"
: "${BASE_URL:?BASE_URL is required}"
: "${TENDER_ID:?TENDER_ID is required}"
: "${SESSION_COOKIE:?SESSION_COOKIE is required}"
: "${WORKER_SECRET:?WORKER_SECRET is required}"

SUMMARIZE="$(dirname "$0")/tmp-summarize-tender-jobs.py"
idle_ticks=0

fetch_jobs() {
  curl -sS --connect-timeout 15 --max-time 45 \
    -H "Cookie: hope_session=$SESSION_COOKIE" \
    "$BASE_URL/api/ai-jobs?tenderId=$TENDER_ID&take=25" || echo ''
}

for tick in $(seq 1 "$MAX_TICKS"); do
  summary=$(fetch_jobs | python3 "$SUMMARIZE" tick)
  active_count="${summary##* }"
  states="${summary% *}"
  echo "tick $tick: active=$active_count | $states"

  if [ "$active_count" = "0" ]; then
    idle_ticks=$((idle_ticks + 1))
    # Two consecutive idle ticks, because a continuation job is enqueued a
    # moment after its predecessor completes and a single sample can land in
    # that gap.
    if [ "$idle_ticks" -ge 2 ]; then
      echo "No QUEUED or RUNNING job for this tender across two ticks; the chain has settled."
      break
    fi
  else
    idle_ticks=0
  fi

  # Safety net only: claims a job that no request-scoped wake picked up. The
  # atomic claim in lib/job-claim-policy.ts means a duplicate call cannot run
  # the same job twice.
  out=$(curl -sS --connect-timeout 15 --max-time 120 -X POST \
    -H "X-Worker-Secret: $WORKER_SECRET" -H "Content-Type: application/json" \
    "$BASE_URL/api/ai-jobs/run-next" || echo '{"resultCode":"REQUEST_FAILED"}')
  if ! printf '%s' "$out" | grep -q '"resultCode":"QUEUE_EMPTY"'; then
    echo "  run-next: $out"
  fi

  sleep "$SLEEP_SECONDS"
done

echo "Final job states for tender $TENDER_ID:"
fetch_jobs | python3 "$SUMMARIZE" final
