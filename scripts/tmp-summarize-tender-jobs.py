# TEMPORARY — owner-authorized helper for scripts/tmp-await-tender-jobs.sh and
# the temporary-preview-hosted-acceptance job in
# .github/workflows/lockfile-refresh-artifact.yml. Delete alongside them once
# the hosted acceptance is complete. See PR #1175.
#
# Reads a GET /api/ai-jobs?tenderId=... response on stdin.
#
#   mode "tick"  -> one line: "<jobType:status ...> <active-count>"
#   mode "final" -> one indented line per job
import json
import sys

mode = sys.argv[1] if len(sys.argv) > 1 else "tick"
raw = sys.stdin.read().strip()

try:
    jobs = json.loads(raw).get("jobs", [])
except Exception:
    print("UNPARSEABLE 0" if mode == "tick" else "  (unparseable response)")
    sys.exit(0)

if mode == "tick":
    active = [j for j in jobs if j.get("status") in ("QUEUED", "RUNNING")]
    parts = ["{0}:{1}".format(j.get("jobType"), j.get("status")) for j in jobs[:8]]
    print("{0} {1}".format(" ".join(parts) if parts else "(no-jobs)", len(active)))
else:
    if not jobs:
        print("  (no jobs for this tender)")
    for j in jobs[:15]:
        print("  {0} {1} id={2} created={3} finished={4}".format(
            j.get("jobType"), j.get("status"), j.get("id"),
            j.get("createdAt"), j.get("finishedAt"),
        ))
        if j.get("status") in ("FAILED", "CANCELED"):
            # GET /api/ai-jobs serialises the durable cause as `errorMessage` --
            # listUserJobs in lib/ai-jobs.ts selects exactly that column and the
            # route returns the rows unchanged. This read asked for `error` and
            # `result`, neither of which that payload has ever carried, so every
            # failed job printed "(no failure detail returned)" regardless of
            # what the worker actually recorded.
            #
            # That is not a cosmetic loss. The provider-exhaustion text -- which
            # names each provider contacted and why it failed, and which the
            # whole AI-routing investigation turns on -- is written to exactly
            # this field, and the acceptance run reported it as absent every
            # time. A diagnostic that silently answers "nothing to report" is
            # worse than one that is missing, because it ends the enquiry.
            #
            # The previous keys stay as alternates rather than being swapped for
            # one new guess, so a payload shaped either way still reads.
            detail = j.get("errorMessage") or j.get("error") or j.get("result")
            print("    error={0}".format(detail or "(job recorded no failure detail)"))
