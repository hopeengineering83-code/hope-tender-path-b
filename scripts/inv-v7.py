#!/usr/bin/env python3
"""Five-pass investigation at PR head f0d4eec4."""
import subprocess
from pathlib import Path

ROOT = Path("/home/z/my-project")
def run(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    return r.stdout + r.stderr

run("git checkout hotfix/release-safety-consolidation")

# ═══════════════════════════════════════════════════════════════════════════
# PASS 1: Hash callers
# ═══════════════════════════════════════════════════════════════════════════
print("=" * 80)
print("PASS 1: Hash callers")
print("=" * 80)

gate = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()
bp = (ROOT / "lib/engine/build-plan.ts").read_text()
hash_mod = (ROOT / "lib/engine/build-plan-hash.ts").read_text()

# Does the gate manually construct hash input?
print("  Gate manually calls computeBuildPlanHash:", "computeBuildPlanHash(" in gate)
print("  Gate manually calls buildCanonicalBuildPlanHashInput:", "buildCanonicalBuildPlanHashInput(" in gate)
print("  Gate calls computeTenderBuildPlanHash:", "computeTenderBuildPlanHash(" in gate)

# Does the gate's requirement select include description?
gate_req_section = gate[gate.find("requirements:"):gate.find("requirements:")+300]
print("  Gate requirements select has description:", "description: true" in gate_req_section)
print("  Gate requirements select has sourceTenderFileId:", "sourceTenderFileId: true" in gate_req_section)

# Does build-plan-hash.ts include title?
print("  Hash includes title:", "title" in hash_mod and "title:" in hash_mod[hash_mod.find("BuildPlanHashInput"):])
# Check metadata evidence fields
print("  Hash includes titleSourceFileId:", "titleSourceFileId" in hash_mod)
print("  Hash includes deadlineSourceFileId:", "deadlineSourceFileId" in hash_mod)
print("  Hash includes submissionEmailSourceQuote:", "submissionEmailSourceQuote" in hash_mod)

# ═══════════════════════════════════════════════════════════════════════════
# PASS 2: Metadata policy/evidence mapping
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 2: Metadata policy/evidence mapping")
print("=" * 80)

# Check validateCriticalMetadataEvidenceForBuildPlan
bp_validator = bp[bp.find("validateCriticalMetadataEvidenceForBuildPlan"):bp.find("export async function assertTenderReadyToDraftBuildPlan")]
print("  Validator hardcodes 4 fields:", "checkField(\"clientName\"" in bp_validator and "checkField(\"submissionMethod\"" in bp_validator)
print("  Validator requires both address and email:", "checkField(\"submissionAddress\"" in bp_validator and "checkField(\"submissionEmails\"" in bp_validator)
print("  Validator checks submission method policy:", "submissionMethod" in bp_validator and "email" in bp_validator.lower())
print("  Validator uses policy registry:", "tender-policy-registry" in bp_validator or "isCriticalField" in bp_validator)

# ═══════════════════════════════════════════════════════════════════════════
# PASS 3: Draft/rebuild lifecycle
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 3: Draft/rebuild lifecycle")
print("=" * 80)

sp = (ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts").read_text()
print("  submission-plan/build returns virtualOnly:", "virtualOnly" in sp)
print("  submission-plan/build has DERIVED:", "DERIVED" in sp)
print("  build-plan.ts buildDraftBuildPlan uses $transaction:", "$transaction" in bp[bp.find("buildDraftBuildPlan"):])
print("  build-plan.ts buildDraftBuildPlan uses Serializable:", "Serializable" in bp[bp.find("buildDraftBuildPlan"):])

# ═══════════════════════════════════════════════════════════════════════════
# PASS 4: Confirmation concurrency
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 4: Confirmation concurrency")
print("=" * 80)

confirm = (ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").read_text()
print("  Captures candidate before loop:", confirm.find("candidateId") < confirm.find("for (let attempt"))
print("  Validation-failure updateMany count checked:", "updateResult.count" in confirm[confirm.find("validation.blockers"):] or "updateMany" in confirm and "count" in confirm)
# Check if validation failure branch checks count
val_branch = confirm[confirm.find("staleBlockers.length > 0"):confirm.find("CONFIRM")]
print("  Validation-failure branch checks count:", "count" in val_branch and "0" in val_branch)
print("  Final P2034 returns 409:", 'BUILD_PLAN_CONFLICT' in confirm[confirm.rfind('P2034'):])

# ═══════════════════════════════════════════════════════════════════════════
# PASS 5: Real route tests
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 80)
print("PASS 5: Real route tests")
print("=" * 80)

rt = (ROOT / "tests/build-plan-route-integration.test.ts").read_text()
print("  Calls buildDraftBuildPlan directly:", "buildDraftBuildPlan" in rt)
print("  Calls actual POST route handler:", "POST" in rt and "handler" in rt.lower())
print("  Manually reproduces $transaction:", "$transaction" in rt)
print("  Tests actual confirm endpoint:", "/build-plan/confirm" in rt or "confirm" in rt.lower())

print("\n=== INVESTIGATION COMPLETE ===")
