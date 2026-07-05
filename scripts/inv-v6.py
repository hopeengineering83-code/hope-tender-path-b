#!/usr/bin/env python3
"""Deep investigation of PR #931 at head b149d6dc."""
import subprocess
from pathlib import Path

ROOT = Path("/home/z/my-project")
def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

run("git checkout hotfix/release-safety-consolidation")

# ═══════════════════════════════════════════════════════════════════════════
# PRIORITY 1: Readiness-gate description selection + single hash input
# ═══════════════════════════════════════════════════════════════════════════
print("=" * 80)
print("PRIORITY 1: Gate description selection + single hash input")
print("=" * 80)

gate = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()
bp = (ROOT / "lib/engine/build-plan.ts").read_text()
hash_mod = (ROOT / "lib/engine/build-plan-hash.ts").read_text()

# Check gate's tender select — does it include description and evidence fields?
print("\n--- Gate tender select ---")
# Find the tender select in assertTenderReadyForGenerationAndExport
gate_select = gate[gate.find("prisma.tender.findFirst"):gate.find("});", gate.find("prisma.tender.findFirst"))]
print(f"  Gate selects description: {'description: true' in gate_select}")
print(f"  Gate selects sourceTenderFileId: {'sourceTenderFileId: true' in gate_select}")
print(f"  Gate selects sourcePageNumber: {'sourcePageNumber: true' in gate_select}")
print(f"  Gate selects sourceExactQuote: {'sourceExactQuote: true' in gate_select}")
print(f"  Gate selects clientNameSourceFileId: {'clientNameSourceFileId' in gate_select}")
print(f"  Gate selects submissionMethodSourceFileId: {'submissionMethodSourceFileId' in gate_select}")

# Check if gate uses buildCanonicalBuildPlanHashInput
print(f"\n  Gate uses buildCanonicalBuildPlanHashInput: {'buildCanonicalBuildPlanHashInput' in gate}")
print(f"  Gate manually appends items: {'gateHashInput.items' in gate}")
print(f"  Gate manually appends metadataEvidence: {'gateHashInput.metadataEvidence' in gate}")

# Check build-plan.ts uses buildCanonicalBuildPlanHashInput
print(f"\n  build-plan.ts uses buildCanonicalBuildPlanHashInput: {'buildCanonicalBuildPlanHashInput' in bp}")
print(f"  build-plan.ts manually appends items: {'hashInput.items' in bp and 'hashInput.items =' in bp}")
print(f"  build-plan.ts manually appends metadataEvidence: {'hashInput.metadataEvidence' in bp}")

# Check if the gate's mappedRequirements includes description
print(f"\n  Gate mappedRequirements includes description: {'description: r.description' in gate}")

# ═══════════════════════════════════════════════════════════════════════════
# PRIORITY 2: Confirmation candidate identity outside retry loop
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PRIORITY 2: Confirmation candidate identity")
print("=" * 80)

confirm = (ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").read_text()
print(f"  Captures candidate BEFORE retry loop: {bool(confirm.find('candidateId') < confirm.find('for (let attempt'))}")
print(f"  Uses findFirst with orderBy on retry: {'orderBy: { updatedAt: \"desc\" }' in confirm}")
print(f"  Rereads latest DRAFT inside retry: {'findFirst' in confirm[confirm.find('for (let attempt'):]}")
print(f"  Conditional updateMany with revision+hash: {'revision: candidateRevision' in confirm and 'contentHash: candidateHash' in confirm}")

# ═══════════════════════════════════════════════════════════════════════════
# PRIORITY 3: Strict metadata validation
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PRIORITY 3: Strict metadata validation")
print("=" * 80)

preflight = bp[bp.find("assertTenderReadyToDraftBuildPlan"):bp.find("export async function buildDraftBuildPlan")]
print(f"  Has validateCriticalMetadataEvidenceForBuildPlan: {'validateCriticalMetadataEvidence' in preflight}")
print(f"  Passes activeTenderFileIds to resolveCanonicalFieldState: {'activeTenderFileIds' in preflight}")
print(f"  Checks metadata quote containment independently: {preflight.count('fileText.includes(normalizedQuote)')}")
print(f"  Uses resolveCanonicalFieldState: {'resolveCanonicalFieldState' in preflight}")

# Check if the gate has strict metadata validation
print(f"\n  Gate has strict metadata validation: {'validateCriticalMetadataEvidence' in gate}")

# ═══════════════════════════════════════════════════════════════════════════
# PRIORITY 4: Real authenticated route tests
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PRIORITY 4: Real authenticated route tests")
print("=" * 80)

rt = (ROOT / "tests/build-plan-route-integration.test.ts").read_text()
print(f"  Calls buildDraftBuildPlan directly: {'buildDraftBuildPlan' in rt}")
print(f"  Calls actual POST handler: {'POST' in rt and 'route' in rt.lower()}")
print(f"  Manually reproduces tx logic: {'$transaction' in rt}")
print(f"  Tests REVIEWER 403 via route handler: {bool('requireRole' in rt or '403' in rt)}")
print(f"  Tests actual confirm route: {'/build-plan/confirm' in rt}")

# ═══════════════════════════════════════════════════════════════════════════
# ADDITIONAL GAPS
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("ADDITIONAL GAPS")
print("=" * 80)

# Check if gate's _RequirementRow type has description
print(f"\n  _RequirementRow has description: {'description' in gate[gate.find('_RequirementRow'):gate.find('};', gate.find('_RequirementRow'))]}")

# Check if gate's tender select includes metadata source fields
gate_tender_select = gate[gate.find("select: {"):gate.find("},", gate.find("select: {"))]
print(f"  Gate tender select includes clientNameSourceFileId: {'clientNameSourceFileId' in gate_tender_select}")
print(f"  Gate tender select includes submissionMethodSourceFileId: {'submissionMethodSourceFileId' in gate_tender_select}")

# Check if buildCanonicalBuildPlanHashInput exists
print(f"\n  buildCanonicalBuildPlanHashInput exists: {'export function buildCanonicalBuildPlanHashInput' in hash_mod}")

# Check confirmation route — does it reread inside the loop?
print(f"\n  Confirmation reads draft INSIDE transaction (not before loop): {bool(confirm.find('findFirst') > confirm.find('prisma.$transaction'))}")

# Check if submission-plan/build still writes legacy fields
sp = (ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts").read_text()
print(f"\n  submission-plan/build writes filesList: {'filesList' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  submission-plan/build writes planType: {'planType' in sp[sp.find('buildDraftBuildPlan'):] if 'buildDraftBuildPlan' in sp else 'N/A'}")
print(f"  submission-plan/build returns virtualOnly: {'virtualOnly' in sp}")

print("\n=== INVESTIGATION COMPLETE ===")
