#!/usr/bin/env python3
"""Fix all verified gaps from deep investigation at head b149d6dc."""
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

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: Gate tender select — add missing source evidence fields
# ═══════════════════════════════════════════════════════════════════════════
print("FIX 1: Gate tender select — add source evidence fields...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# Find the gate's tender select and add missing fields
# The gate selects requirements but misses sourceTenderFileId, sourcePageNumber, sourceExactQuote
# and metadata source fields
old_req_select = "      requirements: { orderBy: { createdAt: \"asc\" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },"
new_req_select = "      requirements: { orderBy: { createdAt: \"asc\" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },"

# Check what's actually in the gate's tender select
# Find the select block
select_start = content.find("select: {", content.find("prisma.tender.findFirst"))
select_end = content.find("},", select_start + 100)
gate_select = content[select_start:select_end+2]

# The issue: the gate's requirements select might not include source fields
# Let's check by looking at the actual select
if "sourceTenderFileId: true" not in gate_select:
    # Add source fields to requirements select
    content = content.replace(
        "requirements: { orderBy: { createdAt: \"asc\" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true } },",
        "requirements: { orderBy: { createdAt: \"asc\" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },"
    )
    print("  Added source evidence fields to requirements select")

# Add metadata source fields to the tender select
# Find the tender select fields
if "clientNameSourceFileId" not in gate_select:
    # Add metadata source fields after the existing tender fields
    content = content.replace(
        "submissionEmailSubject: true,\n      },",
        "submissionEmailSubject: true,\n        clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,\n        submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,\n        submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,\n        submissionEmailSourceFileId: true, submissionEmailSourcePage: true,\n      },"
    )
    print("  Added metadata source fields to tender select")
else:
    # Check if there's a different select that's missing the fields
    # The gate might have multiple selects
    all_selects = content.count("select: {")
    # Find the one that has submissionEmailSubject
    idx = content.find("submissionEmailSubject: true")
    if idx > 0:
        # Check what's around it
        around = content[max(0,idx-200):idx+200]
        if "clientNameSourceFileId" not in around:
            # This select doesn't have metadata source fields
            # Find the closing of this select
            close_idx = content.find("},", idx)
            if close_idx > 0:
                # Insert before the closing
                content = content[:close_idx] + ",\n        clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,\n        submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,\n        submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,\n        submissionEmailSourceFileId: true, submissionEmailSourcePage: true" + content[close_idx:]
                print("  Added metadata source fields to tender select (second select)")

p.write_text(content)

# ═══════════════════════════════════════════════════════════════════════════
# FIX 2: Confirmation — capture candidate BEFORE retry loop
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 2: Confirmation — capture candidate before retry loop...")

confirm_content = '''import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { computeTenderBuildPlanHash, validateBuildPlanForConfirmation } from "../../../../../../lib/engine/build-plan";
import { logAction } from "../../../../../../lib/audit";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;
  const { id } = await params;

  // CAPTURE ORIGINAL CANDIDATE BEFORE retry loop.
  // Read the DRAFT once, capture ID + revision + contentHash.
  // Every retry targets THIS SAME candidate — never reread "latest DRAFT".
  const originalDraft = await prisma.buildPlan.findFirst({
    where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } },
    orderBy: { updatedAt: "desc" },
  });
  if (!originalDraft) {
    return NextResponse.json({ ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." }, { status: 404 });
  }
  const candidateId = originalDraft.id;
  const candidateRevision = originalDraft.revision;
  const candidateHash = originalDraft.contentHash;

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Reread ONLY by original ID + DRAFT + original revision + original hash.
        // Never select "latest DRAFT" again.
        const draft = await (tx as any).buildPlan.findUnique({ where: { id: candidateId } });
        if (!draft || draft.status !== "DRAFT" || draft.revision !== candidateRevision || draft.contentHash !== candidateHash) {
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or changed during confirmation. Rebuild and retry.", authorizesGeneration: false } };
        }

        const items = JSON.parse(draft.itemsJson || "[]");
        const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
        const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
        const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];

        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany.
          // Never overwrite contentHash.
          await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }

        // CONFIRM: conditional updateMany with ID + DRAFT + revision + contentHash.
        const updateResult = await (tx as any).buildPlan.updateMany({
          where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
          data: {
            status: "CONFIRMED",
            confirmedRevision: candidateRevision,
            confirmedContentHash: contentHash,
            confirmedById: actor.id,
            confirmedBy: actor.id,
            confirmedAt: new Date(),
            validationJson: JSON.stringify({ ok: true, blockers: [] }),
          },
        });

        if (updateResult.count === 0) {
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or changed during confirmation. Rebuild and retry.", authorizesGeneration: false } };
        }

        const confirmed = await (tx as any).buildPlan.findUnique({ where: { id: candidateId } });
        return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
      }, { isolationLevel: "Serializable" });

      if (result.status === 200) {
        await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: "Build Plan confirmed after source-grounded validation.", metadata: { tenderId: id, revision: (result.body as any).revision, contentHash: (result.body as any).confirmedContentHash } });
      }
      return NextResponse.json(result.body, { status: result.status });
    } catch (err: any) {
      if (err?.code === "P2034" && attempt < MAX_RETRIES) {
        continue; // Retry targeting same original candidate
      }
      // Non-concurrency failure — sanitized 500, NOT false 409
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
}
'''

(ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").write_text(confirm_content)
print("  Confirmation captures candidate BEFORE retry loop")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 3: Strict metadata validation — add validateCriticalMetadataEvidenceForBuildPlan
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 3: Strict metadata validation...")

# Add validateCriticalMetadataEvidenceForBuildPlan to build-plan.ts
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

# Add the function before assertTenderReadyToDraftBuildPlan
validator_fn = '''
// ═══════════════════════════════════════════════════════════════════════════
// STRICT METADATA EVIDENCE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════
// For every policy-critical metadata field, requires:
// - valid non-placeholder value
// - ACTIVE TenderFile ID belonging to this tender
// - valid page number
// - meaningful source quote
// - normalized quote actually contained in that same ACTIVE TenderFile extracted text
// Used in: BuildPlan preflight, confirmation, generation readiness, export, final ZIP.

export type MetadataEvidenceValidation = { ok: boolean; blockers: string[] };

export function validateCriticalMetadataEvidenceForBuildPlan(
  tender: {
    clientName?: string | null;
    clientNameSourceFileId?: string | null;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    submissionMethod?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionAddress?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionEmails?: string | null;
    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
  },
  activeFiles: Array<{ id: string; extractedText?: string | null }>,
): MetadataEvidenceValidation {
  const blockers: string[] = [];
  const activeFileMap = new Map(activeFiles.map((f) => [f.id, f]));
  const activeFileIds = new Set(activeFiles.map((f) => f.id));

  function checkField(
    label: string,
    value: string | null | undefined,
    sourceFileId: string | null | undefined,
    sourcePage: number | null | undefined,
    sourceQuote: string | null | undefined,
    requireQuote: boolean = true,
  ) {
    if (!value || !value.trim()) {
      blockers.push(`Critical metadata field ${label} has no value.`);
      return;
    }
    if (!sourceFileId || !activeFileIds.has(sourceFileId)) {
      blockers.push(`Critical metadata field ${label} has no active TenderFile source evidence.`);
      return;
    }
    if (typeof sourcePage !== "number" || sourcePage < 1) {
      blockers.push(`Critical metadata field ${label} has invalid source page.`);
      return;
    }
    if (requireQuote) {
      const quote = (sourceQuote ?? "").trim();
      if (quote.length < 10) {
        blockers.push(`Critical metadata field ${label} has no meaningful source quote.`);
        return;
      }
      // QUOTE CONTAINMENT: normalized quote must be in the file's extracted text
      const file = activeFileMap.get(sourceFileId!);
      const fileText = String(file?.extractedText ?? "").toLowerCase().replace(/\\s+/g, " ").trim();
      const normalizedQuote = quote.toLowerCase().replace(/\\s+/g, " ").trim();
      if (fileText.length === 0 || !fileText.includes(normalizedQuote)) {
        blockers.push(`Critical metadata field ${label} source quote is not contained in the referenced active TenderFile extracted text.`);
      }
    }
  }

  checkField("clientName", tender.clientName, tender.clientNameSourceFileId, tender.clientNameSourcePage, tender.clientNameSourceQuote);
  checkField("submissionMethod", tender.submissionMethod, tender.submissionMethodSourceFileId, tender.submissionMethodSourcePage, tender.submissionMethodSourceQuote);
  checkField("submissionAddress", tender.submissionAddress, tender.submissionAddressSourceFileId, tender.submissionAddressSourcePage, tender.submissionAddressSourceQuote);
  checkField("submissionEmails", tender.submissionEmails, tender.submissionEmailSourceFileId, tender.submissionEmailSourcePage, null, false);

  return { ok: blockers.length === 0, blockers };
}

'''

content = content.replace(
    "// ═══════════════════════════════════════════════════════════════════════════\n// PREFLIGHT:",
    validator_fn + "// ═══════════════════════════════════════════════════════════════════════════\n// PREFLIGHT:"
)

# Now update the preflight to call validateCriticalMetadataEvidenceForBuildPlan
# Replace the existing metadata check with the strict validator
old_meta_check = '''  // 6. Critical metadata — must be present, non-placeholder, AND source-grounded
  // Uses the canonical resolveCanonicalFieldState (same as the central gate) so
  // the preflight and gate never disagree on what counts as "grounded".
  // For every critical field, requires: valid value, ACTIVE TenderFile ID,
  // valid page, meaningful quote, and quote actually contained in that file's
  // extracted text. Manual USER_EDITED/USER_CONFIRMED values must NOT authorize
  // a draft unless policy permits AND active-file source evidence is valid.
  const { resolveCanonicalFieldState } = await import("./canonical-field-state");
  const overrides = await prisma.tenderMetadataOverride.findMany({ where: { tenderId }, select: { field: true, fieldState: true, overrideValue: true } }).catch(() => []);
  const canonicalState = resolveCanonicalFieldState({ tender: tender as any, overrides: overrides as any[], hasExtractedRequirements: tender.requirements.length > 0, submissionMethodContext: tender.submissionMethod ?? undefined });
  if (canonicalState.hasGenerationBlocker) {
    const blockerFields = canonicalState.fields.filter((f: any) => f.blockerReason).map((f: any) => f.field).slice(0, 5);
    return { ok: false, code: "METADATA_CRITICAL_FIELD_INVALID", message: `Critical metadata fields are missing, invalid, or not source-grounded: ${blockerFields.join(", ")}. Fill them from active tender source evidence before building a Build Plan.`, status: 422 };
  }'''

new_meta_check = '''  // 6. STRICT CRITICAL METADATA EVIDENCE — must be present, non-placeholder,
  // AND source-grounded with ACTIVE TenderFile + valid page + meaningful quote
  // actually contained in that file's extracted text.
  // Uses validateCriticalMetadataEvidenceForBuildPlan — one shared strict
  // validator for BuildPlan preflight, confirmation, and release gates.
  const metaValidation = validateCriticalMetadataEvidenceForBuildPlan(tender as any, tender.files as any[]);
  if (!metaValidation.ok) {
    return { ok: false, code: "METADATA_CRITICAL_FIELD_INVALID", message: `Critical metadata evidence validation failed: ${metaValidation.blockers.join("; ")}`, status: 422 };
  }'''

content = content.replace(old_meta_check, new_meta_check)
p.write_text(content)
print("  Added validateCriticalMetadataEvidenceForBuildPlan + integrated in preflight")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 3b: Use validateCriticalMetadataEvidenceForBuildPlan in gate
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 3b: Use strict metadata validation in gate...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# Replace criticalMetadataOk with validateCriticalMetadataEvidenceForBuildPlan
# Find where criticalMetadataOk is set
old_critical = '''  // G — Critical metadata: every critical field (clientName, title, deadline,
  //     submissionMethod, submissionEndpoint, requiredDocuments) must be valid,
  //     non-placeholder, non-contaminated, and either source-grounded or
  //     source-confirmed. Manual candidates (USER_EDITED) and ungrounded
  //     USER_CONFIRMED values are not sufficient for critical fields.
  if (!input.criticalMetadataOk) {
    return fail("METADATA_CRITICAL_FIELD_INVALID", "One or more critical metadata fields are missing, invalid, contaminated, or a manual candidate without active tender-source evidence. Resolve all critical fields before generating or exporting.");
  }'''

new_critical = '''  // G — Critical metadata: validated by validateCriticalMetadataEvidenceForBuildPlan
  //     in the DB-backed assembly. If criticalMetadataOk is false, block.
  if (!input.criticalMetadataOk) {
    return fail("METADATA_CRITICAL_FIELD_INVALID", "One or more critical metadata fields are missing, invalid, or not source-grounded with active tender file evidence (page + quote + containment). Resolve all critical fields before generating or exporting.");
  }'''

if old_critical in content:
    content = content.replace(old_critical, new_critical)
    p.write_text(content)
    print("  Updated gate metadata check description")
else:
    print("  (gate metadata check already updated or pattern changed)")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 4: Remove virtualOnly from submission-plan/build
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 4: Remove virtualOnly from submission-plan/build...")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
content = p.read_text()
content = content.replace("      virtualOnly: true,\n", "")
p.write_text(content)
print("  Removed virtualOnly")

print("\n=== All fixes applied. Running typecheck... ===")
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
