# Is the owner's upload finished enough to spend a generation run on?
#
# The owner re-uploads the Company Vault, Brand Assets and tender files by hand
# after a database swap. Firing the acceptance run part-way through that would
# spend provider quota on an incomplete vault and produce a benchmark that
# measures the upload rather than the app.
#
# This answers "is it safe to start yet" and nothing else. It is read-only and
# it ALWAYS exits 0 — a not-ready answer is a valid answer, not a failure, and
# a failing check on the PR every time someone polls is noise that trains
# people to ignore the red X.
import json, os, subprocess, sys

BASE = os.environ["BASE_URL"]
COOKIE = os.environ["SESSION_COOKIE"]

def get(path, max_time="60"):
    out = subprocess.run(
        ["curl", "-sS", "--connect-timeout", "15", "--max-time", max_time,
         "-H", f"Cookie: hope_session={COOKIE}", f"{BASE}{path}"],
        capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except Exception:
        return {"_unparsed": out.stdout[:300]}

def rows(data, *keys):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in keys:
            if isinstance(data.get(k), list):
                return data[k]
    return []

print("=" * 78)
print("UPLOAD READINESS — is there enough on this database to run the pipeline?")
print("=" * 78)

tenders = rows(get("/api/tenders?limit=50"), "tenders", "items", "data", "results")
docs    = rows(get("/api/company/documents?limit=200"), "documents", "items", "data", "results")
assets  = rows(get("/api/company/assets?limit=100"), "assets", "items", "data", "results")
projects= rows(get("/api/company/projects?limit=200"), "projects", "items", "data", "results")
experts = rows(get("/api/company/experts?limit=200"), "experts", "items", "data", "results")

print(f"  tenders            = {len(tenders)}")
print(f"  vault documents    = {len(docs)}")
print(f"  brand assets       = {len(assets)}")
print(f"  projects           = {len(projects)}")
print(f"  experts            = {len(experts)}")

if assets:
    print("\n  brand assets present:")
    for a in assets[:12]:
        # contentByteLength / size are what /api/company/assets actually selects.
        # An earlier version asked for fileContentLength and sizeBytes, neither
        # of which the route returns, and printed bytes=None for a perfectly
        # good 126KB asset.
        print(f"    - {a.get('assetType')}  {a.get('originalFileName')}  "
              f"bytes={a.get('contentByteLength') or a.get('size')}  "
              f"active={a.get('isActive')}  integrity={a.get('integrityStatus')}  "
              f"inline={a.get('hasInlineFileContent')}  storage={a.get('hasPrivateStorage')}")

# Extraction is the part that takes time after the bytes land. A vault document
# whose text has not been extracted yet cannot be matched as evidence, so a run
# started now would under-evidence every requirement through no fault of the app.
#
# Read the field the route actually returns. /api/company/documents deliberately
# does NOT send extractedText — it would be megabytes — and has no
# "extractionStatus" at all; it sends extractedTextLength and
# aiExtractionStatus instead. The first version of this check asked for the two
# absent fields, so every document looked pending no matter what was true, and
# it would have blocked the run for ever on a vault that was completely ready.
# Absent field read as evidence of absence: the same mistake, again.
pending = [d for d in docs if not (d.get("extractedTextLength") or 0) > 0]
print(f"\n  vault documents with extracted text = {len(docs) - len(pending)} of {len(docs)}")
for d in docs:
    print(f"    - {d.get('originalFileName')}  chars={d.get('extractedTextLength')}  "
          f"ai={d.get('aiExtractionStatus')}  inline={d.get('hasInlineFileContent')}")

tender_files_pending = []
print("\n  --- tenders ---")
for t in tenders:
    tid = t.get("id")
    print(f"    id={tid}")
    print(f"      title={t.get('title')}")
    print(f"      stage={t.get('stage') or t.get('lifecycleStage')}  status={t.get('status')}  created={t.get('createdAt')}")
    detail = get(f"/api/tenders/{tid}")
    files = rows(detail.get("tender", detail) if isinstance(detail, dict) else {}, "files") \
            or (detail.get("files") if isinstance(detail, dict) else []) or []
    print(f"      tender files = {len(files)}")
    for f in files[:12]:
        # extractedTextLength / isScannedPlaceholder / hasInlineFileContent are
        # added by withDashboardFileMetrics; the page counts are only populated
        # once extraction has run, so None there means "not yet", not "broken".
        print(f"        - {f.get('originalFileName')}  chars={f.get('extractedTextLength')}  "
              f"scanned-placeholder={f.get('isScannedPlaceholder')}  "
              f"inline={f.get('hasInlineFileContent')}")
        print(f"          pages={f.get('totalPages')} extracted={f.get('extractedPages')} "
              f"score={f.get('extractionScore')} method={f.get('extractionMethod')}")
        if not (f.get("extractedTextLength") or 0) > 0:
            tender_files_pending.append(f.get("originalFileName"))

print("\n" + "=" * 78)
print("VERDICT")
print("=" * 78)
reasons = []
if not tenders:            reasons.append("no tender uploaded yet")
if not docs:               reasons.append("no Company Vault documents yet")
if not assets:             reasons.append("no Brand Assets yet")
if pending:                reasons.append(f"{len(pending)} vault document(s) have no extracted text yet")
if tender_files_pending:   reasons.append(f"tender file(s) with no extracted text yet: {', '.join(str(x) for x in tender_files_pending)}")
if tenders and not projects and not experts:
    reasons.append("vault has no projects or experts — evidence matching would find nothing")

if reasons:
    print("  NOT READY:")
    for r in reasons:
        print(f"    - {r}")
    print("\n  Do not start a generation run yet. Re-check later.")
else:
    print("  READY. Vault, brand assets and tender are all present and extracted.")
    print(f"  Tender to run: {tenders[0].get('id')}")
print("\n  (read-only; this script never writes and never fails the job)")
