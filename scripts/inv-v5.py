#!/usr/bin/env python3
"""Investigate all 8 verified defects at PR head cf6fd158."""
import subprocess
from pathlib import Path

ROOT = Path("/home/z/my-project")
def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

run("git checkout hotfix/release-safety-consolidation")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 1: Hash divergence — computeTenderBuildPlanHash vs gate
# ═══════════════════════════════════════════════════════════════════════════
print("=== DEFECT 1: Hash divergence ===")
bp = (ROOT / "lib/engine/build-plan.ts").read_text()
gate = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()

# Check if computeTenderBuildPlanHash maps requirements WITH evidence fields
print("  build-plan.ts requirement mapping:")
ct_hash_section = bp[bp.find("computeTenderBuildPlanHash"):bp.find("return computeBuildPlanHash")]
print(f"    has description: {'description' in ct_hash_section}")
print(f"    has sourceTenderFileId: {'sourceTenderFileId' in ct_hash_section}")
print(f"    has sourcePageNumber: {'sourcePageNumber' in ct_hash_section}")
print(f"    has sourceExactQuote: {'sourceExactQuote' in ct_hash_section}")

# Check if computeTenderBuildPlanHash passes metadataEvidence
print(f"  build-plan.ts passes metadataEvidence: {'metadataEvidence' in ct_hash_section}")

# Check if gate manually appends items + metadata
gate_hash_section = gate[gate.find("buildPlanHashInputFromTender"):gate.find("currentPlanHash")]
print(f"  gate manually appends items: {'gateHashInput.items' in gate_hash_section}")
print(f"  gate manually appends metadataEvidence: {'gateHashInput.metadataEvidence' in gate_hash_section}")

# Check if build-plan.ts passes items
print(f"  build-plan.ts passes items: {'hashInput.items' in ct_hash_section}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 2: Metadata evidence not strict
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 2: Metadata evidence not strict ===")
preflight = bp[bp.find("assertTenderReadyToDraftBuildPlan"):bp.find("export async function buildDraftBuildPlan")]
print(f"  Passes activeTenderFileIds to resolveCanonicalFieldState: {'activeTenderFileIds' in preflight}")
print(f"  Has validateCriticalMetadataEvidenceForBuildPlan: {'validateCriticalMetadataEvidence' in preflight}")
print(f"  Checks metadata quote containment: {'fileText.includes(normalizedQuote)' in preflight}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 3: Legacy authority in compatibility endpoint
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 3: Legacy authority ===")
sp = (ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts").read_text()
print(f"  Writes filesList after canonical: {'filesList' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  Writes plannedDocuments after canonical: {'plannedDocuments' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  Writes planType after canonical: {'planType' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  Writes createdBy after canonical: {'createdBy' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  Returns virtualOnly: {'virtualOnly' in sp}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 4: Rebuild not serializable
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 4: Rebuild not serializable ===")
print(f"  buildDraftBuildPlan uses $transaction: {'$transaction' in bp[bp.find('export async function buildDraftBuildPlan'):]}")
print(f"  buildDraftBuildPlan uses Serializable: {'Serializable' in bp[bp.find('export async function buildDraftBuildPlan'):]}")
print(f"  buildDraftBuildPlan has P2034 retry: {'P2034' in bp[bp.find('export async function buildDraftBuildPlan'):]}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 5: Confirmation unsafe retry
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 5: Confirmation unsafe retry ===")
confirm = (ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").read_text()
print(f"  Rereads latest DRAFT on retry: {'findFirst' in confirm and 'orderBy' in confirm}")
print(f"  Captures original candidate identity: {'originalRevision' in confirm or 'draft.revision' in confirm}")
print(f"  Updates validationJson by ID only: {bool(confirm.count('where: { id: draft.id }') > 0)}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 6: Virtual plan authority
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 6: Virtual plan authority ===")
print(f"  hasValidVirtualSubmissionPlan in gate input type: {'hasValidVirtualSubmissionPlan' in gate}")
print(f"  hasValidVirtualSubmissionPlan checked in evaluate: {'hasValidVirtualSubmissionPlan' in gate[gate.find('evaluateGenerationReadiness'):]}")
print(f"  hasValidVirtualSubmissionPlan in DB assembly: {'hasValidVirtualSubmissionPlan' in gate[gate.find('assertTenderReadyForGenerationAndExport'):]}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 7: Gate internal errors expose text
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 7: Gate internal errors ===")
gate_error = gate[gate.find('GATE_INTERNAL_ERROR'):gate.find('GATE_INTERNAL_ERROR')+300] if 'GATE_INTERNAL_ERROR' in gate else ''
print(f"  Includes err.message: {'err.message' in gate_error or 'detail' in gate_error}")
print(f"  Includes slice(0, 200): {'slice(0, 200)' in gate_error or 'slice' in gate_error}")

# ═══════════════════════════════════════════════════════════════════════════
# DEFECT 8: Tests not real route tests
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== DEFECT 8: Tests not real route tests ===")
rt = (ROOT / "tests/build-plan-route-integration.test.ts").read_text()
print(f"  Calls buildDraftBuildPlan directly: {'buildDraftBuildPlan' in rt}")
print(f"  Calls confirmation route handler: {'POST' in rt and 'confirm' in rt.lower()}")
print(f"  Manually reproduces tx logic: {'$transaction' in rt}")
