#!/usr/bin/env python3
"""Fix canonical metadata evidence consistency across all 4 allowed files."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")

def run(cmd, check=True, env=None):
    import os
    e = env or {**os.environ}
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True, env=e)
    if check and r.returncode != 0:
        print(f"FAILED: {cmd[:80]}")
        print(r.stderr[-500:] if r.stderr else r.stdout[-500:])
    return r

run("git checkout hotfix/release-safety-consolidation")
print(f"HEAD: {run('git log --oneline -1').stdout.strip()}")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: build-plan.ts — Use submission-method-policy helpers, add strict
# evidence to validateBuildPlanForConfirmation and getCurrentConfirmedBuildPlan,
# fix computeTenderBuildPlanHash select
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 1: build-plan.ts — policy helpers + strict evidence everywhere...")

bp_content = (ROOT / "lib/engine/build-plan.ts").read_text()

# 1a. Add import for submission-method-policy
bp_content = bp_content.replace(
    'import { buildSubmissionPlan, plannedSubmissionTargetFiles, type SubmissionPlanFile } from "./submission-plan";',
    'import { buildSubmissionPlan, plannedSubmissionTargetFiles, type SubmissionPlanFile } from "./submission-plan";\nimport { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";'
)

# 1b. Replace substring heuristics with policy helpers in validator
bp_content = bp_content.replace(
    '''  // SUBMISSION-METHOD-DRIVEN: only check the applicable endpoint.
  const method = (tender.submissionMethod ?? "").toLowerCase();
  if (method.includes("email")) {
    checkField("submissionEmails", tender.submissionEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote);
  } else if (method.includes("physical") || method.includes("hard") || method.includes("address") || method.includes("mail")) {
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  } else if (method.includes("portal") || method.includes("online")) {
    if (!tender.submissionAddress && !tender.submissionEmails) {
      blockers.push("Portal submission requires at least one submission endpoint (address or email).");
    }
  } else {
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  }''',
    '''  // SUBMISSION-METHOD-DRIVEN: use policy helpers, not substring heuristics.
  const method = tender.submissionMethod;
  if (isEmailSubmissionMethod(method)) {
    checkField("submissionEmails", tender.submissionEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote);
  } else if (isPhysicalSubmissionMethod(method)) {
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  } else if (isPortalSubmissionMethod(method)) {
    // Portal: require one fully grounded declared endpoint
    const hasEmail = tender.submissionEmails && tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage;
    const hasAddress = tender.submissionAddress && tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage;
    if (!hasEmail && !hasAddress) {
      blockers.push("Portal submission requires at least one fully grounded endpoint (email or address with source file + page).");
    } else if (hasEmail) {
      checkField("submissionEmails", tender.submissionEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, tender.submissionEmailSourceQuote);
    } else {
      checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
    }
  } else {
    // Unknown method: default to address (safest)
    checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  }'''
)

# 1c. Fix computeTenderBuildPlanHash select — add missing fields
bp_content = bp_content.replace(
    '''      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true, deadline: true,
      clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,
      submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,
      submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,
      submissionEmailSourceFileId: true, submissionEmailSourcePage: true,''',
    '''      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true, deadline: true,
      procuringEntityName: true,
      clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,
      submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,
      submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,
      submissionEmailSourceFileId: true, submissionEmailSourcePage: true, submissionEmailSourceQuote: true,
      titleSourceFileId: true, titleSourcePage: true, titleSourceQuote: true,
      deadlineSourceFileId: true, deadlineSourcePage: true, deadlineSourceQuote: true,'''
)

# 1d. Add strict evidence validation to validateBuildPlanForConfirmation
# Insert after the requirement grounding checks, before the return
bp_content = bp_content.replace(
    '''  for (const authoritative of authoritativeItems) {
    if (!items.some((item) => planItemKey(item) === planItemKey(authoritative))) blockers.push(`${authoritative.exactFileName} is missing from the Build Plan.`);
  }
  return { ok: blockers.length === 0, blockers };''',
    '''  for (const authoritative of authoritativeItems) {
    if (!items.some((item) => planItemKey(item) === planItemKey(authoritative))) blockers.push(`${authoritative.exactFileName} is missing from the Build Plan.`);
  }
  // STRICT CRITICAL METADATA EVIDENCE: run the same shared validator.
  const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(tender as any, tender.files.filter((f: any) => f.deletionStatus === "ACTIVE"));
  if (!metaValidation.ok) {
    blockers.push(...metaValidation.blockers);
  }
  return { ok: blockers.length === 0, blockers };'''
)

# 1e. Add strict evidence validation to getCurrentConfirmedBuildPlan
bp_content = bp_content.replace(
    '''  const ok = plan.confirmedRevision === plan.revision && plan.confirmedContentHash === plan.contentHash && currentHash === plan.confirmedContentHash;
  return ok ? { ok: true as const, plan, currentHash } : { ok: false as const, blocker: "Confirmed Build Plan is stale or hash/revision mismatched." };''',
    '''  const hashOk = plan.confirmedRevision === plan.revision && plan.confirmedContentHash === plan.contentHash && currentHash === plan.confirmedContentHash;
  if (!hashOk) return { ok: false as const, blocker: "Confirmed Build Plan is stale or hash/revision mismatched." };
  // STRICT CRITICAL METADATA EVIDENCE: even if hash matches, reject if
  // metadata evidence is no longer valid (e.g., source file was deleted).
  const fullTender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { files: { where: { deletionStatus: "ACTIVE" } } },
  });
  if (fullTender) {
    const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(fullTender as any, fullTender.files as any[]);
    if (!metaValidation.ok) {
      return { ok: false as const, blocker: `Confirmed Build Plan metadata evidence is no longer valid: ${metaValidation.blockers.join("; ")}` };
    }
  }
  return { ok: true as const, plan, currentHash };'''
)

(ROOT / "lib/engine/build-plan.ts").write_text(bp_content)
print("  build-plan.ts: policy helpers + strict evidence in confirmation + getCurrentConfirmed + select fields")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 2: build-plan-hash.ts — Make metadata evidence policy-applicable
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 2: build-plan-hash.ts — policy-applicable metadata evidence...")

hash_content = (ROOT / "lib/engine/build-plan-hash.ts").read_text()

# Add import for submission-method-policy
hash_content = hash_content.replace(
    'import crypto from "crypto";',
    'import crypto from "crypto";\nimport { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";'
)

# Replace the hardcoded 6-field metadata evidence with policy-applicable logic
# that only includes applicable endpoint fields
hash_content = hash_content.replace(
    '''  // Derive metadata evidence from ALL policy-critical source fields.
  // Evidence state is based on actual validation (file ID + page + quote),
  // not merely sourceFileId existence.
  input.metadataEvidence = [
    { fieldKey: "title", effectiveValue: tender.title ?? null, sourceTenderFileId: (tender as any).titleSourceFileId ?? null, sourcePage: (tender as any).titleSourcePage ?? null, sourceQuote: (tender as any).titleSourceQuote ?? null, evidenceState: ((tender as any).titleSourceFileId && (tender as any).titleSourcePage && (tender as any).titleSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: (tender.clientNameSourceFileId && tender.clientNameSourcePage && tender.clientNameSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "deadline", effectiveValue: tender.deadline ? new Date(tender.deadline).toISOString() : null, sourceTenderFileId: (tender as any).deadlineSourceFileId ?? null, sourcePage: (tender as any).deadlineSourcePage ?? null, sourceQuote: (tender as any).deadlineSourceQuote ?? null, evidenceState: ((tender as any).deadlineSourceFileId && (tender as any).deadlineSourcePage && (tender as any).deadlineSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: (tender.submissionMethodSourceFileId && tender.submissionMethodSourcePage && tender.submissionMethodSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
  ];''',
    '''  // Derive metadata evidence from ALL policy-critical source fields.
  // Only include APPLICABLE endpoint fields based on submission method policy.
  // Evidence state is GROUNDED only when file ID + page + quote all exist.
  const method = tender.submissionMethod;
  const evidence: BuildPlanHashMetadataEvidence[] = [
    { fieldKey: "title", effectiveValue: tender.title ?? null, sourceTenderFileId: (tender as any).titleSourceFileId ?? null, sourcePage: (tender as any).titleSourcePage ?? null, sourceQuote: (tender as any).titleSourceQuote ?? null, evidenceState: ((tender as any).titleSourceFileId && (tender as any).titleSourcePage && (tender as any).titleSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: (tender.clientNameSourceFileId && tender.clientNameSourcePage && tender.clientNameSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "deadline", effectiveValue: tender.deadline ? new Date(tender.deadline).toISOString() : null, sourceTenderFileId: (tender as any).deadlineSourceFileId ?? null, sourcePage: (tender as any).deadlineSourcePage ?? null, sourceQuote: (tender as any).deadlineSourceQuote ?? null, evidenceState: ((tender as any).deadlineSourceFileId && (tender as any).deadlineSourcePage && (tender as any).deadlineSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: (tender.submissionMethodSourceFileId && tender.submissionMethodSourcePage && tender.submissionMethodSourceQuote) ? "GROUNDED" : "UNGROUNDED" },
  ];
  // Only include APPLICABLE endpoint fields — changing a non-applicable
  // endpoint must NOT stale the plan.
  if (isEmailSubmissionMethod(method)) {
    evidence.push({ fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
  } else if (isPhysicalSubmissionMethod(method)) {
    evidence.push({ fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
  } else if (isPortalSubmissionMethod(method)) {
    // Portal: include whichever endpoint exists
    if (tender.submissionEmails) {
      evidence.push({ fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: (tender as any).submissionEmailSourceQuote ?? null, evidenceState: (tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage && (tender as any).submissionEmailSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
    }
    if (tender.submissionAddress) {
      evidence.push({ fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
    }
  } else {
    // Unknown: default to address
    evidence.push({ fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: (tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage && tender.submissionAddressSourceQuote) ? "GROUNDED" : "UNGROUNDED" });
  }
  input.metadataEvidence = evidence;'''
)

(ROOT / "lib/engine/build-plan-hash.ts").write_text(hash_content)
print("  build-plan-hash.ts: policy-applicable metadata evidence (only applicable endpoint hashed)")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 3: generation-readiness-gate.ts — Use shared strict validator
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 3: generation-readiness-gate.ts — use shared strict validator...")

gate_content = (ROOT / "lib/engine/generation-readiness-gate.ts").read_text()

# Replace the criticalMetadataOk computation to use validateCriticalMetadataEvidenceForBuildPlan
gate_content = gate_content.replace(
    '''      criticalMetadataOk: !fieldStates.hasGenerationBlocker,''',
    '''      criticalMetadataOk: !fieldStates.hasGenerationBlocker && (await (async () => {
        try {
          const { validateCriticalMetadataEvidenceForBuildPlan } = await import("./build-plan");
          const fullTender = await prisma.tender.findFirst({
            where: { id: tenderId, userId },
            include: {
              files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, originalFileName: true, deletionStatus: true, totalPages: true } },
            },
          });
          if (!fullTender) return false;
          const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(fullTender as any, fullTender.files as any[]);
          return metaValidation.ok;
        } catch { return false; }
      })()),'''
)

(ROOT / "lib/engine/generation-readiness-gate.ts").write_text(gate_content)
print("  gate: criticalMetadataOk now uses shared strict validator")

print("\n=== All fixes applied. Running typecheck... ===")
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma generate", check=False)
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx tsc --noEmit", check=False)
if result.returncode != 0:
    print("TYPECHECK FAILED:")
    print(result.stdout[-2000:])
    print(result.stderr[-2000:])
    sys.exit(1)
print("  Typecheck passed.")

print("\n=== Running lint... ===")
result = run("npx eslint . --ext .ts,.tsx --max-warnings 50", check=False)
if result.returncode != 0:
    print("LINT FAILED:")
    print(result.stdout[-500:])
    sys.exit(1)
print("  Lint passed.")

print("\n=== Fresh DB + migrations ===")
run("""DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)
run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma migrate deploy", check=False)
run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma generate")

print("\n=== Running full test suite... ===")
import os
test_env = {**os.environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public", "RUN_DB_INTEGRATION": "true"}
result = run("node scripts/run-tests.mjs", check=False, env=test_env)
for line in result.stdout.split('\n'):
    if line.startswith('ℹ tests') or line.startswith('ℹ pass') or line.startswith('ℹ fail'):
        print(f"  {line}")
if 'ℹ fail 0' not in result.stdout:
    print("TESTS FAILED!")
    for line in result.stdout.split('\n'):
        if line.startswith('✖'):
            print(f"  {line}")
    sys.exit(1)

print("\n✓ All checks passed!")
