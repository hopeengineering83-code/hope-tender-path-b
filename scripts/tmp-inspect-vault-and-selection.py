import json, os, subprocess, sys, urllib.parse

BASE = os.environ["BASE_URL"]
COOKIE = os.environ["SESSION_COOKIE"]
TENDER = (os.environ.get("TENDER_ID") or "").strip()

def get(path):
    out = subprocess.run(
        ["curl", "-sS", "--connect-timeout", "15", "--max-time", "120",
         "-H", f"Cookie: hope_session={COOKIE}", f"{BASE}{path}"],
        capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except Exception:
        return {"_unparsed": out.stdout[:400], "_stderr": out.stderr[:200]}

def show(label, path, limit=6000):
    print(f"\n----- {label}  [{path}] -----")
    print(json.dumps(get(path), indent=2)[:limit])


# The tender ID is not knowable ahead of time on a freshly rebuilt database:
# the owner uploads through the real UI, so the ID is whatever that upload
# created. Discover it rather than carrying a stale default from the previous
# database, which would silently inspect nothing.
def discover_tenders():
    data = get("/api/tenders?limit=50")
    rows = None
    if isinstance(data, dict):
        for key in ("tenders", "items", "data", "results"):
            if isinstance(data.get(key), list):
                rows = data[key]
                break
    elif isinstance(data, list):
        rows = data
    if rows is None:
        print(f"  !! could not read /api/tenders; payload keys={list(data)[:10] if isinstance(data, dict) else type(data)}")
        return []
    return rows


HEALTH_RX = ("hospital", "health", "medical", "clinic", "healthcare", "specialty",
             "specialised", "specialized", "maternity", "pharma", "laboratory",
             "diagnostic", "mch", "icu", "surgical")

def healthy(text):
    t = (text or "").lower()
    return [w for w in HEALTH_RX if w in t]

def page_all(path):
    """Page through a cursor-paginated vault collection."""
    items, cursor, guard = [], None, 0
    while guard < 60:
        guard += 1
        sep = "&" if "?" in path else "?"
        url = f"{path}{sep}limit=100" + (f"&cursor={urllib.parse.quote(cursor)}" if cursor else "")
        data = get(url)
        if not isinstance(data, dict):
            print(f"  !! unexpected payload for {url}: {str(data)[:200]}")
            break
        batch = None
        for key in ("projects", "experts", "items", "data", "results"):
            if isinstance(data.get(key), list):
                batch = data[key]
                break
        if batch is None:
            print(f"  !! no list field in {url}; keys={list(data.keys())[:10]}")
            break
        items.extend(batch)
        cursor = data.get("nextCursor") or data.get("cursor")
        if not cursor or not batch:
            break
    return items

def tally(items, label, name_keys):
    print(f"\n===== {label}: {len(items)} total =====")
    by_trust = {}
    for it in items:
        by_trust.setdefault(it.get("trustLevel") or "(none)", []).append(it)
    for lvl in sorted(by_trust):
        print(f"  trustLevel {lvl}: {len(by_trust[lvl])}")
    rel = []
    for it in items:
        blob = " ".join(str(it.get(k) or "") for k in name_keys)
        hits = healthy(blob)
        if hits:
            rel.append((it, hits))
    print(f"  healthcare-relevant by text: {len(rel)}")
    for it, hits in rel[:40]:
        nm = it.get("name") or it.get("fullName")
        print(f"    - [{it.get('trustLevel')}] {nm} | sector={it.get('sector')} "
              f"| client={it.get('clientName')} | hits={','.join(hits)}")
    return by_trust, rel

print("########## TENDERS ON THIS DATABASE ##########")
_tenders = discover_tenders()
print(f"tenders: {len(_tenders)}")
for _t in _tenders:
    print(f"  id={_t.get('id')} | status={_t.get('status')} | stage={_t.get('stage') or _t.get('lifecycleStage')} "
          f"| title={_t.get('title')} | client={_t.get('clientName')} | created={_t.get('createdAt')}")
if not TENDER:
    if not _tenders:
        print("!! No tender on this database and no TENDER_ID supplied — nothing to trace.")
        sys.exit(1)
    TENDER = _tenders[0].get("id")
    print(f"\nUsing most recent tender: {TENDER}")
else:
    print(f"\nUsing supplied TENDER_ID: {TENDER}")

print("\n########## LIVE VAULT TRUTH ##########")
projects = page_all("/api/company/projects")
tally(projects, "PROJECTS", ["name", "clientName", "sector", "serviceAreas", "country"])

experts = page_all("/api/company/experts")
tally(experts, "EXPERTS", ["fullName", "title", "disciplines", "sectors"])

print("\n########## TENDER MATCHES ##########")
m = get(f"/api/tenders/{TENDER}/matches")
pm = m.get("projectMatches", []) if isinstance(m, dict) else []
em = m.get("expertMatches", []) if isinstance(m, dict) else []
print(f"projectMatches rows: {len(pm)}  (selected {sum(1 for x in pm if x.get('isSelected'))})")
for x in pm:
    p = x.get("project", {}) or {}
    print(f"  selected={str(x.get('isSelected')):5} score={x.get('score')} "
          f"trust={p.get('trustLevel')} | {p.get('name')} | sector={p.get('sector')}")
    if x.get("rationale"):
        print(f"      rationale: {str(x['rationale'])[:300]}")
print(f"\nexpertMatches rows: {len(em)}  (selected {sum(1 for x in em if x.get('isSelected'))})")
for x in em:
    e = x.get("expert", {}) or {}
    print(f"  selected={str(x.get('isSelected')):5} score={x.get('score')} "
          f"trust={e.get('trustLevel')} | {e.get('fullName')} | sectors={e.get('sectors')}")

# A compact, always-first selection table. The full-record dump below is
# valuable but long enough that it pushed this table off the retrievable end of
# the job log last time, which is how "which two projects were selected?" went
# unanswered while every other number was in hand.
print("\n########## SELECTION TABLE (compact) ##########")
_ranked = sorted(pm, key=lambda x: -(x.get("score") or 0))
print(f"selected projects: {[ (x.get('project') or {}).get('name') for x in pm if x.get('isSelected') ]}")
for x in [y for y in pm if y.get("isSelected")] + _ranked[:15]:
    p_ = x.get("project", {}) or {}
    print(f"  sel={str(x.get('isSelected')):5} score={x.get('score'):.4f} | {p_.get('name')}")
print(f"selected experts: {[ (x.get('expert') or {}).get('fullName') for x in em if x.get('isSelected') ]}")

print("\n########## FULL RECORDS + RATIONALES FOR THE CONTESTED PROJECTS ##########")
# The three healthcare records and every project match that scored above 0.4,
# with NOTHING truncated. The previous pass cut rationales at 300 characters,
# which hid the capability-family list that decides the strict-family gate.
contested = [x for x in pm if (x.get("score") or 0) > 0.4]
for x in contested:
    p_ = x.get("project", {}) or {}
    print(f"\n--- {p_.get('name')} ---")
    print(f"  id={p_.get('id')} selected={x.get('isSelected')} score={x.get('score')}")
    print(f"  FULL RATIONALE: {x.get('rationale')}")
    detail = get(f"/api/company/projects/{p_.get('id')}")
    d = detail.get("project", detail) if isinstance(detail, dict) else {}
    for k in ("name", "clientName", "country", "sector", "serviceAreas", "summary",
              "contractValue", "currency", "startDate", "endDate", "trustLevel",
              "sourceDocumentId", "reviewedBy", "reviewedAt"):
        v = d.get(k) if isinstance(d, dict) else None
        if k == "summary" and isinstance(v, str):
            print(f"  {k}: len={len(v)} :: {v[:600]}")
        else:
            print(f"  {k}: {v}")

print("\n########## MATCHING QUALITY ##########")
print(json.dumps(get(f"/api/tenders/{TENDER}/matching-quality"), indent=2)[:4000])

print("\n########## PROVIDER DIAGNOSTICS (durable snapshot, no quota) ##########")
print(json.dumps(get("/api/ai-providers/diagnostics"), indent=2)[:6000])

# ONE live generation capability probe.
#
# The note that used to stand here declined the live probe because provider
# configuration had not changed. It has: Cerebras credit is now available on
# the same account and API key already configured in this environment, and the
# last real workload observation for Cerebras was HTTP 402 payment_required —
# a durable snapshot can only keep reporting that stale refusal.
#
# Capability is what matters, not key presence: connectivity proves the route,
# not that the provider can return usable structured generation. This asks the
# generation capability specifically, in a single request across the chain, so
# it is one probe rather than a per-provider poll.
print("\n########## PROVIDER CAPABILITY — LIVE GENERATION PROBE (one pass) ##########")
# Connectivity, not generation, for THIS pass. availableModels comes from
# listAccountModels and is returned whatever capability is tested, but a
# generation test costs a real completion per provider and the 60s route
# deadline stopped the last run after four of ten — leaving Cerebras, the one
# provider this run exists to inspect, untested. Connectivity reaches all ten.
live = get("/api/ai-providers/diagnostics?live=1&capability=connectivity")
print(json.dumps(live, indent=2)[:9000])

print("\n########## BRAND ASSETS — STORAGE vs APPLICATION ##########")
# ACTIVE metadata is not proof the bytes reached the artifact. This reports
# what the asset store holds; whether those bytes are embedded in the delivered
# DOCX/PDF is checked separately against the artifact itself.
_assets = get("/api/company/assets")
if isinstance(_assets, dict):
    _rows = None
    for key in ("assets", "items", "data", "results"):
        if isinstance(_assets.get(key), list):
            _rows = _assets[key]
            break
    if _rows is None:
        print(f"  !! unexpected payload; keys={list(_assets.keys())[:10]}")
    else:
        print(f"assets: {len(_rows)}")
        for a in _rows:
            # storagePath vs inline bytes matters: the signature/stamp applier
            # skips storage-backed rows, so an ACTIVE asset held only in
            # storage never reaches the document.
            print(f"  type={a.get('assetType')} active={a.get('isActive')} "
                  f"name={a.get('originalFileName')} mime={a.get('mimeType')} "
                  f"size={a.get('size')} inlineBytes={a.get('fileContentLength')} "
                  f"storagePath={'yes' if a.get('storagePath') else 'no'} "
                  f"integrity={a.get('integrityStatus')} id={a.get('id')}")
else:
    print(f"  !! {str(_assets)[:200]}")

print("\n########## PIPELINE STATE AFTER AI ANALYZE + RUN ENGINE ##########")
show("TENDER RECORD", f"/api/tenders/{TENDER}", 8000)
show("WORKFLOW STATUS", f"/api/tenders/{TENDER}/workflow-status", 8000)
show("AI JOBS", f"/api/ai-jobs?tenderId={urllib.parse.quote(TENDER)}&take=50", 12000)
show("EXTRACTION QUALITY", f"/api/tenders/{TENDER}/extraction-quality", 8000)
show("ANALYSIS QUALITY", f"/api/tenders/{TENDER}/analysis-quality", 6000)
show("ENGINE READINESS", f"/api/tenders/{TENDER}/engine-readiness", 6000)
show("SUBMISSION PLAN", f"/api/tenders/{TENDER}/submission-plan", 8000)
show("GENERATION READINESS", f"/api/tenders/{TENDER}/generation-readiness", 6000)
show("PROPOSAL EVIDENCE READINESS", f"/api/tenders/{TENDER}/proposal-evidence-readiness", 6000)
show("EXPORT READINESS", f"/api/tenders/{TENDER}/export-readiness", 8000)
show("FINAL PACKAGE READINESS", f"/api/tenders/{TENDER}/final-package-readiness", 8000)
show("READINESS SCORE", f"/api/tenders/{TENDER}/readiness-score", 4000)

print("\n########## CAPABILITY VERDICTS (printed last — this is the answer) ##########")
# Field names come from ProviderCapabilityReport / CapabilityTestResult in
# lib/ai-provider-capability-test.ts: results (not "tests"), diagnosticState,
# availableModels. An earlier version of this block guessed "tests" and printed
# nothing, which is worse than printing the wrong thing because it reads as a
# clean result.
rows = live.get("perProvider") if isinstance(live, dict) else None
if not rows:
    print("  NO perProvider ROWS. Raw response keys:",
          list(live.keys()) if isinstance(live, dict) else type(live).__name__)
    print("  Raw (first 1500):", json.dumps(live)[:1500])
else:
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("provider")
        print(f"\n  == {name} ==")
        print(f"     diagnosticState = {row.get('diagnosticState')}")
        print(f"     eligible={row.get('eligible')} keyPresent={row.get('keyPresent')}"
              f" usableForGeneration={row.get('usableForGeneration')}"
              f" usableForAiAnalyze={row.get('usableForAiAnalyze')}")
        print(f"     resolvedModels  = {row.get('resolvedModels')}")
        print(f"     modelVisible={row.get('modelVisible')}")
        avail = row.get("availableModels")
        if avail is None:
            print("     availableModels = None (provider did not return a model list)")
        else:
            print(f"     availableModels ({len(avail)}): {avail}")
        for r in (row.get("results") or []):
            if isinstance(r, dict):
                print(f"     [{r.get('capability')}] status={r.get('status')}"
                      f" model={r.get('model')}"
                      f" confirmedByProvider={r.get('modelConfirmedByProvider')}"
                      f" category={r.get('category')}"
                      f" msg={str(r.get('safeMessage'))[:220]}")
