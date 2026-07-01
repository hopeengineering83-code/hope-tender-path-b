#!/usr/bin/env python3
"""Three-pass investigation of current PR #931 head."""
import subprocess
from pathlib import Path
import re

ROOT = Path("/home/z/my-project")
def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

run("git checkout hotfix/release-safety-consolidation")
print(f"HEAD: {run('git log --oneline -1').strip()}")

# ═══════════════════════════════════════════════════════════════════════════
# PASS 1: Inspect every BuildPlan hash function and every caller
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 1: Hash functions and callers")
print("=" * 80)

# build-plan-hash.ts
h = (ROOT / "lib/engine/build-plan-hash.ts").read_text()
print("\n--- build-plan-hash.ts ---")
print(f"  BuildPlanHashItem type defined: {'BuildPlanHashItem' in h}")
print(f"  Items used in computeBuildPlanHash: {'itemHashes' in h}")
# Check what fields are in the hash
for field in ['exactFileName', 'exactOrder', 'documentType', 'required', 'format', 'envelope', 'sourceRequirementIds', 'pageLimit', 'templateRequired', 'templateSourceFileId', 'brandingAllowed', 'signatureAllowed', 'stampAllowed', 'grouping', 'notes']:
    print(f"  Hash includes item.{field}: {f'item.{field}' in h or f':{field}' in h}")

# Check requirement fields in hash
print(f"\n  Requirement fields in BuildPlanHashRequirement:")
for field in ['id', 'title', 'description', 'requirementType', 'priority', 'exactFileName', 'exactOrder', 'sourceTenderFileId', 'sourcePageNumber', 'sourceExactQuote']:
    print(f"    {field}: {field in h}")

# Check file fields
print(f"\n  File fields in BuildPlanHashFile:")
for field in ['id', 'fileName', 'extractedText', 'deletionStatus']:
    print(f"    {field}: {field in h}")

# Check if critical metadata evidence is in hash
print(f"\n  Critical metadata evidence in hash:")
print(f"    clientNameSourceFileId: {'clientNameSourceFileId' in h}")
print(f"    clientNameSourcePage: {'clientNameSourcePage' in h}")
print(f"    clientNameSourceQuote: {'clientNameSourceQuote' in h}")
print(f"    deadline evidence: {'deadline' in h}")
print(f"    submissionEmailSubject: {'submissionEmailSubject' in h}")

# build-plan.ts
bp = (ROOT / "lib/engine/build-plan.ts").read_text()
print("\n--- build-plan.ts ---")
print(f"  Uses computeBuildPlanHash: {'computeBuildPlanHash' in bp}")
print(f"  Uses buildPlanHashInputFromTender: {'buildPlanHashInputFromTender' in bp}")
print(f"  Passes items to hash: {'hashInput.items' in bp}")
print(f"  hashBuildPlanState still exported: {'export function hashBuildPlanState' in bp}")

# generation-readiness-gate.ts
gate = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()
print("\n--- generation-readiness-gate.ts ---")
print(f"  Uses computeBuildPlanHash: {'computeBuildPlanHash' in gate}")
print(f"  Uses buildPlanHashInputFromTender: {'buildPlanHashInputFromTender' in gate}")
print(f"  Passes items to hash: {'items' in gate[gate.find('buildPlanHashInputFromTender'):gate.find('buildPlanHashInputFromTender')+500] if 'buildPlanHashInputFromTender' in gate else False}")
print(f"  hasValidVirtualSubmissionPlan used: {'hasValidVirtualSubmissionPlan' in gate}")
print(f"  Loads persisted confirmed itemsJson: {'itemsJson' in gate}")

# ═══════════════════════════════════════════════════════════════════════════
# PASS 2: Trace full BuildPlan lifecycle
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 2: BuildPlan lifecycle trace")
print("=" * 80)

# Draft: build-plan route
bp_route = (ROOT / "app/api/tenders/[id]/build-plan/route.ts").read_text()
print("\n--- POST /build-plan ---")
print(f"  Role: {'ADMIN' in bp_route and 'PROPOSAL_MANAGER' in bp_route and 'REVIEWER' not in bp_route}")
print(f"  Calls buildDraftBuildPlan: {'buildDraftBuildPlan' in bp_route}")
print(f"  Uses typed result: {'draftResult' in bp_route}")

# Draft: submission-plan/build route
sp = (ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts").read_text()
print("\n--- POST /submission-plan/build ---")
print(f"  Role REVIEWER removed: {'REVIEWER' not in sp}")
print(f"  Calls buildDraftBuildPlan: {'buildDraftBuildPlan' in sp}")
print(f"  Has legacy extraction/analysis logic before canonical service: {bool(re.search(r'(isExtractionAcceptable|assessTenderAnalysisQuality|detectAnalysisSource)', sp[:sp.find('buildDraftBuildPlan')])) if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  Writes legacy fieldsList/plannedDocuments after canonical service: {'filesList' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")

# Confirm route
confirm = (ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").read_text()
print("\n--- POST /build-plan/confirm ---")
print(f"  Serializable: {'Serializable' in confirm}")
print(f"  P2034 retry: {'P2034' in confirm}")
print(f"  updateMany with revision+hash WHERE: {'revision: draft.revision' in confirm and 'contentHash: draft.contentHash' in confirm}")
print(f"  Captures original identity: {'originalRevision' in confirm or 'draft.revision' in confirm}")

# ═══════════════════════════════════════════════════════════════════════════
# PASS 3: Route tests, PostgreSQL behavior, migrations, role checks, CI
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 3: Tests, DB behavior, migrations, CI")
print("=" * 80)

# Check route integration test
rt = (ROOT / "tests/build-plan-route-integration.test.ts").read_text()
print("\n--- build-plan-route-integration.test.ts ---")
print(f"  RUN_DB_INTEGRATION mandatory: {'process.exit(1)' in rt and 'RUN_DB_INTEGRATION' in rt}")
print(f"  Tests REVIEWER 403 via route: {'403' in rt and 'REVIEWER' in rt}")
print(f"  Tests actual confirmation route: {'/build-plan/confirm' in rt or 'confirm' in rt.lower()}")
print(f"  Tests concurrency: {'concurrent' in rt.lower() or '409' in rt}")
print(f"  Tests stale detection: {'stale' in rt.lower() or 'STALE' in rt}")
print(f"  Uses direct service calls instead of route: {'buildDraftBuildPlan' in rt}")

# Check GATE_INTERNAL_ERROR exposure
print(f"\n--- GATE_INTERNAL_ERROR text exposure ---")
gate_error = gate[gate.find('GATE_INTERNAL_ERROR'):gate.find('GATE_INTERNAL_ERROR')+200] if 'GATE_INTERNAL_ERROR' in gate else ''
print(f"  Exposes raw error: {'detail' in gate_error and 'err' in gate_error}")

print("\n=== INVESTIGATION COMPLETE ===")
