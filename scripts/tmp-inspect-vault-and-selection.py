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


# ─────────────────────────────────────────────────────────────────────────────
# BLOCKER FORENSICS — Company Profile BID_TEAM_TO_CONFIRM and FILE_ORDER
#
# Read-only. Runs no generation and spends no provider quota, which is why the
# evidence for both blockers is gathered here rather than by re-running the
# hosted acceptance.
# ─────────────────────────────────────────────────────────────────────────────
print("\n########## BLOCKER FORENSICS ##########")

import re as _re

# The exact patterns the gate uses. Kept in sync deliberately by eye — this is
# throwaway acceptance tooling, and duplicating them here lets the report show
# WHICH pattern fires on WHICH text without another deploy.
_PLACEHOLDER_RX = [
    (r"\bbid[\s-]?team\s+to\s+confirm\b", "bid-team-to-confirm"),
    (r"\bto\s+be\s+(?:confirmed|determined|provided|completed|inserted)\b", "to-be-X"),
    (r"\b(?:tbd|tbc|tba)\b", "tbd/tbc/tba"),
    (r"\b(?:not\s+provided|not\s+available|not\s+specified|unknown|pending)\b", "not-provided/unknown/pending"),
    (r"\bn\/?a\b", "n/a"),
    (r"\bplaceholder\b", "placeholder"),
    (r"\b(?:insert|add|fill)\b.{0,40}\b(?:here|later|manually)\b", "insert-here"),
    (r"\b\[?fill[\s_-]?in\]?", "fill-in"),
    (r"\bexact\s+site\s+to\s+be\s+determined\b", "exact-site-tbd"),
    (r"\bwith\s+consultant'?s\s+assistance\b", "consultant-assistance"),
]

def _scan(label, text):
    """Report every placeholder pattern that fires, with surrounding context."""
    if not text:
        print(f"  {label}: (no text)")
        return 0
    total = 0
    for src, name in _PLACEHOLDER_RX:
        for m in _re.finditer(src, text, _re.I):
            total += 1
            a, b = max(0, m.start() - 90), min(len(text), m.end() + 90)
            ctx = _re.sub(r"\s+", " ", text[a:b])
            print(f"  {label}: [{name}] matched {m.group(0)!r}")
            print(f"      …{ctx}…")
            if total >= 25:
                print(f"  {label}: (truncated at 25 matches)")
                return total
    if total == 0:
        print(f"  {label}: no placeholder pattern fires")
    return total

# ── 1. Requirements, verbatim. narrativeDraftContent() echoes requirement
#       title + description straight into the client-facing planned-row DOCX,
#       so a requirement carrying "TBD"/"to be confirmed"/"N/A" becomes a
#       placeholder hit inside a shipped document.
print("\n--- TENDER REQUIREMENTS (echoed verbatim into planned-row documents) ---")
_reqs = get(f"/api/tenders/{TENDER}/requirements")
_rows = _reqs.get("requirements") if isinstance(_reqs, dict) else (_reqs if isinstance(_reqs, list) else None)
if not _rows:
    print(f"  !! could not read requirements; payload={str(_reqs)[:400]}")
else:
    print(f"  {len(_rows)} requirement(s)")
    _flagged = 0
    for _r in _rows:
        _t = f"{_r.get('title') or ''} — {_r.get('description') or ''}"
        _hits = _scan(f"REQ {str(_r.get('id'))[:8]}", _t)
        if _hits:
            _flagged += 1
    print(f"  => {_flagged} requirement(s) carry placeholder wording that would be copied into a shipped document")

# ── 2. Every generated document's quality verdict, with the gate's own
#       (now phrase-naming) message.
print("\n--- GENERATED DOCUMENT QUALITY (the gate's own message) ---")
_audit = get("/api/admin/generated-proposals/audit")
_docs = None
if isinstance(_audit, dict):
    for _k in ("documents", "rows", "results", "items"):
        if isinstance(_audit.get(_k), list):
            _docs = _audit[_k]
            break
if _docs is None:
    print(f"  !! unexpected audit shape; keys={list(_audit)[:15] if isinstance(_audit, dict) else type(_audit).__name__}")
    print(f"  raw: {json.dumps(_audit)[:2500]}")
else:
    for _d in _docs:
        if str(_d.get("tenderId") or "") not in ("", TENDER):
            continue
        _nm = _d.get("exactFileName") or _d.get("name")
        print(f"\n  * {_nm}")
        print(f"      type={_d.get('documentType')} format={_d.get('format')}")
        print(f"      qualityScore={_d.get('qualityScore')} recommended={_d.get('qualityRecommendedStatus')}")
        print(f"      generationStatus={_d.get('generationStatus')} validationStatus={_d.get('validationStatus')}")
        print(f"      readyForExport={_d.get('readyForExport')} zipEligible={_d.get('zipEligible')}")
        print(f"      exactOrder={_d.get('exactOrder')}  bidTeamToConfirmIssue={_d.get('bidTeamToConfirmIssue')}")
        for _i in (_d.get("qualityIssues") or _d.get("issues") or []):
            print(f"      ISSUE {_i.get('code')} [{_i.get('severity')}] {str(_i.get('message'))[:600]}")
        _vt = _d.get("visibleText") or _d.get("textExcerpt") or _d.get("excerpt")
        if _vt:
            _scan(f"      TEXT[{_nm}]", _vt)
        else:
            print("      (audit response carries no text excerpt for this document)")

# ── 3. FILE_ORDER — the confirmed plan's order vs what was generated.
print("\n--- FILE_ORDER: PLAN ORDER vs GENERATED ORDER vs MANIFEST ---")
_plan = get(f"/api/tenders/{TENDER}/submission-plan")
_items = None
if isinstance(_plan, dict):
    for _k in ("items", "files", "plan", "rows", "planItems"):
        _v = _plan.get(_k)
        if isinstance(_v, list):
            _items = _v
            break
        if isinstance(_v, dict) and isinstance(_v.get("items"), list):
            _items = _v["items"]
            break
if _items is None:
    print(f"  !! unexpected plan shape; keys={list(_plan)[:15] if isinstance(_plan, dict) else type(_plan).__name__}")
    print(f"  raw: {json.dumps(_plan)[:2500]}")
else:
    print(f"  CONFIRMED PLAN ORDER ({len(_items)} row(s)):")
    for _n, _it in enumerate(_items, 1):
        print(f"    {_n:>2}. {_it.get('fileName') or _it.get('exactFileName') or _it.get('name')!r}"
              f"  order={_it.get('order') or _it.get('sortOrder') or _it.get('position')}"
              f"  format={_it.get('format')}  status={_it.get('status')}"
              f"  superseded={_it.get('supersededAt') or _it.get('superseded')}")

if _docs:
    print(f"\n  GENERATED DOCUMENT ORDER:")
    for _n, _d in enumerate(
        sorted([d for d in _docs if str(d.get('tenderId') or '') in ('', TENDER)],
               key=lambda d: (d.get('exactOrder') if d.get('exactOrder') is not None else 9999,
                              str(d.get('exactFileName') or d.get('name') or ''))), 1):
        print(f"    {_n:>2}. {(_d.get('exactFileName') or _d.get('name'))!r}"
              f"  exactOrder={_d.get('exactOrder')}"
              f"  generationStatus={_d.get('generationStatus')}"
              f"  finalExportCandidate={_d.get('finalExportCandidate')}"
              f"  zipEligible={_d.get('zipEligible')}")

print("\n--- EXPORT-READINESS BLOCKERS, FULL DETAIL ---")
_er = get(f"/api/tenders/{TENDER}/export-readiness")
print(json.dumps(_er, indent=2)[:9000])

print("\n--- FINAL PACKAGE READINESS, FULL DETAIL ---")
print(json.dumps(get(f"/api/tenders/{TENDER}/final-package-readiness"), indent=2)[:9000])

# ── 4. Brand assets — letterheadAppliedCount=0 question.
print("\n--- BRAND ASSETS (letterhead vs signature/stamp are separate rules) ---")
_ba = get("/api/company/assets")
_alist = _ba.get("assets") if isinstance(_ba, dict) else (_ba if isinstance(_ba, list) else None)
if _alist is None:
    print(f"  !! unexpected assets shape: {str(_ba)[:400]}")
else:
    for _a in _alist:
        print(f"  {_a.get('assetType') or _a.get('type')}: {_a.get('fileName') or _a.get('name')}"
              f"  active={_a.get('isActive')}  status={_a.get('status')}"
              f"  bytes={_a.get('fileContentLength') or _a.get('size')}"
              f"  storagePath={'yes' if _a.get('storagePath') else 'no'}")


# ─────────────────────────────────────────────────────────────────────────────
# FILE-FORMAT AUTHORITY — does the tender name a format per file, or envelope-wide?
#
# The remaining blocker is FILE_FORMAT VIOLATED: "The tender requires PDF for
# the technical envelope, but 1 current document(s) are not PDF: Company
# Profile.docx (DOCX)."
#
# Two opposite fixes depend on ONE fact:
#   * if exactFileNaming itself names "Company Profile.docx", the tender wants
#     that file as DOCX and the envelope-wide reading of the format clause is
#     what is wrong;
#   * if it does not, the package really should have produced a PDF.
#
# Converting a file the tender asked for as DOCX would ship the wrong format
# to the procuring entity, so this is not a guess worth making.
# ─────────────────────────────────────────────────────────────────────────────
print("\n########## FILE-FORMAT AUTHORITY ##########")
_t = get(f"/api/tenders/{TENDER}")
_rec = _t.get("tender") if isinstance(_t, dict) and isinstance(_t.get("tender"), dict) else _t
if not isinstance(_rec, dict):
    print(f"  !! unexpected tender shape: {str(_t)[:300]}")
else:
    for _k in ("exactFileNaming", "exactFileOrder"):
        print(f"  {_k} = {json.dumps(_rec.get(_k))[:900]}")

print("\n--- the FILE_FORMAT requirement's own source text ---")
_rq = get(f"/api/tenders/{TENDER}/requirements")
_rows = _rq.get("requirements") if isinstance(_rq, dict) else (_rq if isinstance(_rq, list) else [])
for _r in (_rows or []):
    _title = (_r.get("title") or "")
    if not _re.search(r"technical proposal document|format|pdf", f"{_title} {_r.get('description') or ''}", _re.I):
        continue
    print(f"  * {_title}")
    print(f"      priority={_r.get('priority')} type={_r.get('requirementType')}")
    print(f"      description={str(_r.get('description'))[:700]}")
    print(f"      sourceExactQuote={str(_r.get('sourceExactQuote'))[:700]}")


# ─────────────────────────────────────────────────────────────────────────────
# LETTERHEAD FORENSICS — why letterheadAppliedCount is 0
#
# applyActiveUploadedLetterheadToTenderDocuments() returns 0 through SIX
# indistinguishable early exits. "0" therefore carries no diagnosis, and
# guessing which one fired would be inventing a cause. Each guard is evaluated
# here from live data instead, so the answer names the guard.
#
# Signature/stamp rules are deliberately NOT merged into this: a tender that
# demands a signed and stamped form is a different instruction from one that
# permits company branding, and an asset existing is not an instruction to
# apply it.
# ─────────────────────────────────────────────────────────────────────────────
print("\n########## LETTERHEAD FORENSICS — which guard returns 0 ##########")

# guard 1: forbidsBranding(tender.requirements) — lib/engine/scope-policy.ts:103
_BRANDING_PROHIBITION = _re.compile(
    r"no\s+(company\s+)?(logo|letterhead|branding|stamp|seal)"
    r"|without\s+(company\s+)?(logo|letterhead|branding|stamp|seal)"
    r"|plain\s+template"
    r"|do\s+not\s+(use|include)\s+(company\s+)?(logo|letterhead|branding|stamp|seal)",
    _re.I)

_rq = get(f"/api/tenders/{TENDER}/requirements")
_rrows = _rq.get("requirements") if isinstance(_rq, dict) else (_rq if isinstance(_rq, list) else [])
_alltext = " ".join(
    " ".join(str(r.get(f) or "") for f in
             ("title", "description", "restrictions", "sourceExactQuote", "category", "requirementType"))
    for r in (_rrows or []))
_hit = _BRANDING_PROHIBITION.search(_alltext)
print(f"  guard 1 forbidsBranding      = {bool(_hit)}"
      + (f"   matched {_hit.group(0)!r}" if _hit else "   (no prohibition in tender text)"))

# guard 1b: the separate signature/stamp instruction — reported, never acted on
_SIG = _re.compile(r"signature|signed|stamp|seal|company seal", _re.I)
_sig = _SIG.search(_alltext)
print(f"  (separate) requiresSignatureOrStamp = {bool(_sig)}"
      + (f"   matched {_sig.group(0)!r}" if _sig else ""))

# guard 2: AppSettings.allowBrandingDefault === false
_st = get("/api/settings")
_stv = _st.get("settings") if isinstance(_st, dict) and isinstance(_st.get("settings"), dict) else _st
_allow = _stv.get("allowBrandingDefault") if isinstance(_stv, dict) else "?"
print(f"  guard 2 allowBrandingDefault = {json.dumps(_allow)}   (false blocks; absent/true allows)")
if isinstance(_stv, dict):
    for _k in ("allowSignatureDefault", "allowStampDefault"):
        print(f"          {_k} = {json.dumps(_stv.get(_k))}")

# guards 3-5: the active LETTERHEAD asset itself
_ba = get("/api/company/assets")
_alist = _ba.get("assets") if isinstance(_ba, dict) else (_ba if isinstance(_ba, list) else [])
_lh = [a for a in (_alist or []) if (a.get("assetType") or a.get("type")) == "LETTERHEAD" and a.get("isActive")]
if not _lh:
    print("  guard 3 active LETTERHEAD    = NONE  -> returns 0 here")
else:
    for _a in _lh:
        _mime = str(_a.get("mimeType") or "")
        _inline = _a.get("fileContentLength") or _a.get("fileContent") or 0
        _mime_ok = bool(_re.search(r"wordprocessingml\.document|msword|octet-stream", _mime, _re.I))
        print(f"  guard 3 inline fileContent   = {_inline!r}"
              f"   storagePath={'yes' if _a.get('storagePath') else 'no'}"
              "   (storage-only bytes read as absent -> returns 0)")
        print(f"  guard 4 mimeType accepted    = {_mime_ok}   mimeType={_mime!r}")
        print(f"          originalFileName     = {_a.get('originalFileName') or _a.get('fileName')!r}")
        print("  guard 5 looksLikeDocx(PK..)  = not observable from the API; "
              "a non-DOCX letterhead (PDF/PNG/JPG) fails here even when guard 4 passes")

# guard 6: per-document storagePath skip
_au = get(f"/api/admin/generated-proposals/audit?tenderId={urllib.parse.quote(TENDER)}")
_arows = _au.get("rows") if isinstance(_au, dict) else None
if not isinstance(_arows, list):
    print(f"  guard 6 audit rows unreadable: {str(_au)[:300]}")
else:
    _live = [r for r in _arows if r.get("generationStatus") != "SUPERSEDED"]
    _skipped = [r for r in _live if r.get("hasStoragePath")]
    print(f"  guard 6 storage-backed docs  = {len(_skipped)}/{len(_live)} live documents"
          "   (each one is skipped by design: branding storage-backed bytes could"
          " replace authoritative content)")
    for _r in _live:
        print(f"          {_r.get('exactFileName') or _r.get('documentName')}"
              f"  format={_r.get('format')}  storagePath={_r.get('hasStoragePath')}"
              f"  inline={_r.get('hasFileContent')}")
    print("          note: only DOCX bytes are letterheadable; a PDF-only package"
          " reaches guard 5 per document and is skipped there.")


# ─────────────────────────────────────────────────────────────────────────────
# PHARO RE-VERIFICATION — did the FILE_FORMAT fix actually land in production?
#
# The previous attempt (01015c69) shipped INERT: the scope resolver was fixed
# but two callers never passed sourceExactQuote, so it read no file names. The
# full readiness dump above is truncated at 9000 chars and the verdict can hide
# inside it, so pull every package-rule verdict out by name. A fix is not
# verified until the live verdict says so.
# ─────────────────────────────────────────────────────────────────────────────
print("\n########## PACKAGE-RULE VERDICTS (verbatim, untruncated) ##########")
_fpr = get(f"/api/tenders/{TENDER}/final-package-readiness")

def _walk_rules(node, out):
    if isinstance(node, dict):
        if "family" in node and "status" in node:
            out.append(node)
        for v in node.values():
            _walk_rules(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_rules(v, out)

_rules = []
_walk_rules(_fpr, _rules)
if not _rules:
    print(f"  !! no package-rule verdicts found; payload keys="
          f"{list(_fpr)[:12] if isinstance(_fpr, dict) else type(_fpr)}")
for _r in _rules:
    print(f"  {_r.get('family')}: {_r.get('status')}")
    print(f"      reason: {_r.get('reason')}")
    if _r.get("scope") or _r.get("scopeLabel"):
        print(f"      scope: {_r.get('scopeLabel') or _r.get('scope')}")

print("\n--- tender-level blockers + export readiness flags ---")
for _k in ("tenderLevelBlockers", "blockers", "failures", "finalExportReady", "ok",
           "readinessScore", "exportReadyDocuments", "requiredDocuments"):
    if isinstance(_fpr, dict) and _k in _fpr:
        print(f"  {_k} = {json.dumps(_fpr[_k])[:1500]}")
