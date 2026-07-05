#!/usr/bin/env python3
"""Three-pass investigation of current #931 code."""
import subprocess
from pathlib import Path

ROOT = Path("/home/z/my-project")

def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

run("git checkout hotfix/release-safety-consolidation")

print("=" * 80)
print("PASS 1: Current #931 code, schema, migrations, routes, tests, CI")
print("=" * 80)

# 1a. submission-plan/build role check
print("\n--- 1a. submission-plan/build role check ---")
sp = (ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts").read_text()
import re
role_match = re.search(r'requireRole\(([^)]+)\)', sp)
print(f"  Current requireRole: {role_match.group(0) if role_match else 'NOT FOUND'}")
print(f"  REVIEWER allowed: {'REVIEWER' in (role_match.group(0) if role_match else '')}")

# 1b. buildDraftBuildPlan return type
print("\n--- 1b. buildDraftBuildPlan return type ---")
bp = (ROOT / "lib/engine/build-plan.ts").read_text()
# Find the function signature
sig = re.search(r'export async function buildDraftBuildPlan[^{]*', bp)
print(f"  Signature: {sig.group(0).strip() if sig else 'NOT FOUND'}")
# Check if it returns null or a typed result
print(f"  Returns null on failure: {'return null' in bp}")
print(f"  Has BuildPlanDraftResult type: {'BuildPlanDraftResult' in bp}")

# 1c. build-plan route false 404
print("\n--- 1c. build-plan route false 404 ---")
bp_route = (ROOT / "app/api/tenders/[id]/build-plan/route.ts").read_text()
print(f"  Returns 404 TENDER_NOT_FOUND when buildDraftBuildPlan fails: {'TENDER_NOT_FOUND' in bp_route and '404' in bp_route}")

# 1d. Preflight metadata check
print("\n--- 1d. Preflight metadata check ---")
preflight_section = bp[bp.find('assertTenderReadyToDraftBuildPlan'):bp.find('export async function buildDraftBuildPlan')]
print(f"  Uses resolveCanonicalFieldState: {'resolveCanonicalFieldState' in preflight_section}")
print(f"  Uses assessTenderMetadataCompleteness: {'assessTenderMetadataCompleteness' in preflight_section}")
print(f"  Checks quote containment for metadata: {'fileText.includes(normalizedQuote)' in preflight_section}")

# 1e. Hash fields
print("\n--- 1e. Hash fields ---")
hash_mod = (ROOT / "lib/engine/build-plan-hash.ts").read_text()
print(f"  Has deadline: {'deadline' in hash_mod}")
print(f"  Has submissionEmailSubject: {'submissionEmailSubject' in hash_mod}")
# Check if BuildPlan items are in the hash
print(f"  Hash includes BuildPlan items: {'items' in hash_mod.lower() and 'canonicalId' in hash_mod}")

# 1f. Confirmation concurrency
print("\n--- 1f. Confirmation concurrency ---")
confirm = (ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").read_text()
print(f"  Serializable: {'Serializable' in confirm}")
print(f"  P2034 retry: {'P2034' in confirm}")
print(f"  updateMany with WHERE: {'updateMany' in confirm and 'revision: draft.revision' in confirm}")

# 1g. pglite test
print("\n--- 1g. pglite test ---")
pglite_test = (ROOT / "tests/tender-delete-pglite-integration.test.ts").read_text()
print(f"  Imports @electric-sql/pglite: {'@electric-sql/pglite' in pglite_test}")
print(f"  Has dbDescribe skip: {'dbDescribe' in pglite_test}")

# 1h. DB integration test
print("\n--- 1h. DB integration test ---")
db_test = (ROOT / "tests/build-plan-db-integration.test.ts").read_text()
print(f"  Has manual deleteMany of confirmed: {'deleteMany' in db_test and 'CONFIRMED' in db_test}")
print(f"  Calls confirmation route: {'/build-plan/confirm' in db_test or 'confirm' in db_test.lower()}")
print(f"  Tests REVIEWER 403: {'REVIEWER' in db_test and '403' in db_test}")

print("\n" + "=" * 80)
print("PASS 2: Full BuildPlan lifecycle trace")
print("=" * 80)

# Trace each step
print("\n--- Draft: POST /build-plan ---")
print(f"  Calls preflight: {'assertTenderReadyToDraftBuildPlan' in bp_route}")
print(f"  Calls buildDraftBuildPlan: {'buildDraftBuildPlan' in bp_route}")

print("\n--- Draft: POST /submission-plan/build ---")
print(f"  Role: {role_match.group(0) if role_match else 'NOT FOUND'}")
print(f"  Calls buildDraftBuildPlan: {'buildDraftBuildPlan' in sp}")

print("\n--- Rebuild: buildDraftBuildPlan ---")
print(f"  Uses upsert: {'upsert' in bp}")
print(f"  Clears confirmed fields: {'confirmedRevision: null' in bp}")

print("\n--- Confirm: POST /build-plan/confirm ---")
print(f"  Uses serializable tx: {'Serializable' in confirm}")
print(f"  Optimistic updateMany: {'updateMany' in confirm}")

print("\n--- Generate: POST /generate ---")
gen = (ROOT / "app/api/tenders/[id]/generate/route.ts").read_text()
print(f"  Calls central gate: {'assertTenderReadyForGenerationAndExport' in gen}")
print(f"  planOnly calls buildDraftBuildPlan: {'buildDraftBuildPlan' in gen}")

print("\n--- Export/Download/Auto-finalize ---")
for route_name, route_path in [
    ("export", "app/api/tenders/[id]/export/route.ts"),
    ("download", "app/api/tenders/[id]/download/route.ts"),
    ("auto-finalize", "app/api/tenders/[id]/auto-finalize/route.ts"),
]:
    r = (ROOT / route_path).read_text()
    print(f"  {route_name}: central gate = {'assertTenderReadyForGenerationAndExport' in r}")

print("\n" + "=" * 80)
print("PASS 3: Real database behavior")
print("=" * 80)

print("\n--- Ownership ---")
print(f"  buildDraftBuildPlan checks userId: {'userId' in bp and 'findFirst' in bp}")
print(f"  confirm checks tender.userId: {'userId: actor.id' in confirm}")

print("\n--- Role security ---")
print(f"  build-plan route: ADMIN/PROPOSAL_MANAGER: {'ADMIN' in bp_route and 'PROPOSAL_MANAGER' in bp_route}")
print(f"  submission-plan/build route: {'ADMIN' in sp and 'PROPOSAL_MANAGER' in sp}")
print(f"  REVIEWER allowed in submission-plan/build: {'REVIEWER' in sp}")

print("\n--- Stale plan detection ---")
print(f"  Gate computes currentPlanHash: {'computeBuildPlanHash' in (ROOT / 'lib/engine/generation-readiness-gate.ts').read_text()}")
print(f"  recordedBuildPlanState STALE: {'STALE' in (ROOT / 'lib/engine/generation-readiness-gate.ts').read_text()}")

print("\n--- Evidence grounding ---")
gate = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()
print(f"  Gate checks quote containment: {'fileText.includes(normalizedQuote)' in gate}")
print(f"  Preflight checks quote containment: {'fileText.includes(normalizedQuote)' in preflight_section}")

print("\n--- Concurrent requests ---")
print(f"  Confirm uses serializable: {'Serializable' in confirm}")
print(f"  Confirm has P2034 retry: {'P2034' in confirm}")
