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
        if j.get("status") == "FAILED":
            print("    error={0}".format(j.get("error") or j.get("result") or "(no failure detail returned)"))
