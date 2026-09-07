import json, os, subprocess, sys, urllib.parse

BASE = os.environ["BASE_URL"]
COOKIE = os.environ["SESSION_COOKIE"]
TENDER = os.environ["TENDER_ID"]

def get(path):
    out = subprocess.run(
        ["curl", "-sS", "--connect-timeout", "15", "--max-time", "120",
         "-H", f"Cookie: hope_session={COOKIE}", f"{BASE}{path}"],
        capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except Exception:
        return {"_unparsed": out.stdout[:400], "_stderr": out.stderr[:200]}

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

print("########## LIVE VAULT TRUTH ##########")
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

# ONE live capability pass, explicitly authorized. This runs the real
# structured-extraction test through the same adapter and model the workload
# uses, inside runAsDiagnostic() so it imposes no cooldown on real work. It is
# the only way to classify a provider as AVAILABLE rather than merely
# configured — the durable snapshot above reports configuration, not capability.
print("\n########## PROVIDER CAPABILITY — ONE LIVE PASS ##########")
print(json.dumps(get("/api/ai-providers/diagnostics?live=1"), indent=2)[:14000])
