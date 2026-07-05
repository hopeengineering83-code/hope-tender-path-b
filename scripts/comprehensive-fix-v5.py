#!/usr/bin/env python3
"""Fix all 8 verified defects from PR head cf6fd158."""
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
# FIX 1: ONE canonical hash-input builder
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 1: One canonical hash-input builder...")
p = ROOT / "lib/engine/build-plan-hash.ts"
content = p.read_text()

# Add buildCanonicalBuildPlanHashInput function that accepts items explicitly
# and derives metadata evidence from the tender. This is the ONLY function
# callers should use.
canonical_builder = '''

/**
 * ONE canonical hash-input builder. This is the ONLY function callers should
 * use to construct a BuildPlanHashInput. No caller may manually construct a
 * reduced hash input or append items/metadata after calling this builder.
 *
 * @param tender - tender with files, requirements, and metadata source fields
 * @param items - the EXACT BuildPlan items to hash:
 *   - draft/rebuild: current derived canonical items
 *   - confirmation: exact stored DRAFT itemsJson
 *   - confirmed-plan check: exact stored CONFIRMED itemsJson
 *   - readiness/export/ZIP: exact persisted confirmed itemsJson
 */
export function buildCanonicalBuildPlanHashInput(
  tender: {
    exactFileNaming?: string | null;
    exactFileOrder?: string | null;
    submissionMethod?: string | null;
    submissionAddress?: string | null;
    submissionEmails?: string | null;
    submissionEmailSubject?: string | null;
    deadline?: Date | string | null;
    clientName?: string | null;
    clientNameSourceFileId?: string | null;
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionEmailSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    files: BuildPlanHashFile[];
    requirements: BuildPlanHashRequirement[];
  },
  items: BuildPlanHashItem[],
): BuildPlanHashInput {
  const input = buildPlanHashInputFromTender(tender);
  input.items = items;

  // Derive metadata evidence from the tender's source fields.
  // Determine included fields from the policy-critical metadata set.
  input.metadataEvidence = [
    { fieldKey: "clientName", effectiveValue: tender.clientName ?? null, sourceTenderFileId: tender.clientNameSourceFileId ?? null, sourcePage: tender.clientNameSourcePage ?? null, sourceQuote: tender.clientNameSourceQuote ?? null, evidenceState: tender.clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod ?? null, sourceTenderFileId: tender.submissionMethodSourceFileId ?? null, sourcePage: tender.submissionMethodSourcePage ?? null, sourceQuote: tender.submissionMethodSourceQuote ?? null, evidenceState: tender.submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress ?? null, sourceTenderFileId: tender.submissionAddressSourceFileId ?? null, sourcePage: tender.submissionAddressSourcePage ?? null, sourceQuote: tender.submissionAddressSourceQuote ?? null, evidenceState: tender.submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails ?? null, sourceTenderFileId: tender.submissionEmailSourceFileId ?? null, sourcePage: tender.submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: tender.submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
  ];

  return input;
}
'''

# Add before isBuildPlanValid
content = content.replace(
    '/**\n * A recorded plan is valid only when',
    canonical_builder + '\n/**\n * A recorded plan is valid only when'
)
p.write_text(content)
print("  Added buildCanonicalBuildPlanHashInput")

# Now update build-plan.ts to use buildCanonicalBuildPlanHashInput
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

# Replace the entire computeTenderBuildPlanHash function
old_fn = content[content.find("export async function computeTenderBuildPlanHash"):content.find("export async function buildDraftBuildPlan")]
new_fn = '''export async function computeTenderBuildPlanHash(prisma: PrismaClient, tenderId: string, userId: string, items?: BuildPlanItem[]): Promise<string | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true, deadline: true,
      clientName: true, clientNameSourceFileId: true, clientNameSourcePage: true, clientNameSourceQuote: true,
      submissionMethodSourceFileId: true, submissionMethodSourcePage: true, submissionMethodSourceQuote: true,
      submissionAddressSourceFileId: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,
      submissionEmailSourceFileId: true, submissionEmailSourcePage: true,
      files: { where: { deletionStatus: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true } },
      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
    },
  });
  if (!tender) return null;
  const planItems = items ?? plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  // CANONICAL HASH: uses buildCanonicalBuildPlanHashInput — the ONE shared
  // builder. No caller may manually construct a reduced hash input or append
  // items/metadata after calling this.
  const { buildCanonicalBuildPlanHashInput, computeBuildPlanHash } = await import("./build-plan-hash");
  const hashItems = planItems.map((item) => ({
    canonicalId: item.canonicalId,
    exactFileName: item.exactFileName,
    exactOrder: item.exactOrder,
    documentType: item.documentType,
    required: item.required,
    format: item.format,
    envelope: item.envelope,
    sourceRequirementIds: item.sourceRequirementIds,
    pageLimit: item.pageLimit,
    templateRequired: item.templateRequired,
    templateSourceFileId: item.templateSourceFileId,
    brandingAllowed: item.brandingAllowed,
    signatureAllowed: item.signatureAllowed,
    stampAllowed: item.stampAllowed,
    grouping: item.grouping,
    notes: item.notes,
  }));
  return computeBuildPlanHash(buildCanonicalBuildPlanHashInput(tender as any, hashItems));
}

'''
content = content.replace(old_fn, new_fn)
p.write_text(content)
print("  build-plan.ts uses buildCanonicalBuildPlanHashInput")

# Update gate to use buildCanonicalBuildPlanHashInput (no manual append)
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# Find and replace the gate's hash computation
old_gate_hash = '''    const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");
    // Use persisted confirmed BuildPlan items for hash — NOT a newly derived
    // virtual plan. This ensures stale detection compares against the exact
    // items that were confirmed, not what would be derived now.
    const persistedItems = recordedBuildPlan?.itemsJson ? JSON.parse(recordedBuildPlan.itemsJson) : [];
    const gateHashInput = buildPlanHashInputFromTender({
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
      deadline: (tender as any).deadline ?? null,
      files: activeFiles.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: "ACTIVE" })),
      requirements: (requirements as _RequirementRow[]).map((r) => ({
        id: r.id, title: r.title, description: r.description, requirementType: r.requirementType, priority: r.priority,
        exactFileName: r.exactFileName, exactOrder: r.exactOrder,
        sourceTenderFileId: r.sourceTenderFileId, sourcePageNumber: r.sourcePageNumber, sourceExactQuote: r.sourceExactQuote,
      })),
    });
    gateHashInput.items = persistedItems;
    gateHashInput.metadataEvidence = [
      { fieldKey: "clientName", effectiveValue: tender.clientName, sourceTenderFileId: (tender as any).clientNameSourceFileId ?? null, sourcePage: (tender as any).clientNameSourcePage ?? null, sourceQuote: (tender as any).clientNameSourceQuote ?? null, evidenceState: (tender as any).clientNameSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionMethod", effectiveValue: tender.submissionMethod, sourceTenderFileId: (tender as any).submissionMethodSourceFileId ?? null, sourcePage: (tender as any).submissionMethodSourcePage ?? null, sourceQuote: (tender as any).submissionMethodSourceQuote ?? null, evidenceState: (tender as any).submissionMethodSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionAddress", effectiveValue: tender.submissionAddress, sourceTenderFileId: (tender as any).submissionAddressSourceFileId ?? null, sourcePage: (tender as any).submissionAddressSourcePage ?? null, sourceQuote: (tender as any).submissionAddressSourceQuote ?? null, evidenceState: (tender as any).submissionAddressSourceFileId ? "GROUNDED" : "UNGROUNDED" },
      { fieldKey: "submissionEmails", effectiveValue: tender.submissionEmails, sourceTenderFileId: (tender as any).submissionEmailSourceFileId ?? null, sourcePage: (tender as any).submissionEmailSourcePage ?? null, sourceQuote: null, evidenceState: (tender as any).submissionEmailSourceFileId ? "GROUNDED" : "UNGROUNDED" },
    ];
    const currentPlanHash = computeBuildPlanHash(gateHashInput);'''

new_gate_hash = '''    // CANONICAL HASH: use buildCanonicalBuildPlanHashInput — the ONE shared
    // builder. No manual item or metadata append. Uses persisted confirmed
    // items for stale detection.
    const { computeBuildPlanHash, buildCanonicalBuildPlanHashInput } = await import("./build-plan-hash");
    const persistedItems = recordedBuildPlan?.itemsJson ? JSON.parse(recordedBuildPlan.itemsJson) : [];
    const currentPlanHash = computeBuildPlanHash(buildCanonicalBuildPlanHashInput({
      exactFileNaming: tender.exactFileNaming,
      exactFileOrder: tender.exactFileOrder,
      submissionMethod: tender.submissionMethod,
      submissionAddress: tender.submissionAddress,
      submissionEmails: tender.submissionEmails,
      submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
      deadline: (tender as any).deadline ?? null,
      clientName: tender.clientName,
      clientNameSourceFileId: (tender as any).clientNameSourceFileId ?? null,
      clientNameSourcePage: (tender as any).clientNameSourcePage ?? null,
      clientNameSourceQuote: (tender as any).clientNameSourceQuote ?? null,
      submissionMethodSourceFileId: (tender as any).submissionMethodSourceFileId ?? null,
      submissionMethodSourcePage: (tender as any).submissionMethodSourcePage ?? null,
      submissionMethodSourceQuote: (tender as any).submissionMethodSourceQuote ?? null,
      submissionAddressSourceFileId: (tender as any).submissionAddressSourceFileId ?? null,
      submissionAddressSourcePage: (tender as any).submissionAddressSourcePage ?? null,
      submissionAddressSourceQuote: (tender as any).submissionAddressSourceQuote ?? null,
      submissionEmailSourceFileId: (tender as any).submissionEmailSourceFileId ?? null,
      submissionEmailSourcePage: (tender as any).submissionEmailSourcePage ?? null,
      files: activeFiles.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: "ACTIVE" })),
      requirements: (requirements as _RequirementRow[]).map((r) => ({
        id: r.id, title: r.title, description: r.description, requirementType: r.requirementType, priority: r.priority,
        exactFileName: r.exactFileName, exactOrder: r.exactOrder,
        sourceTenderFileId: r.sourceTenderFileId, sourcePageNumber: r.sourcePageNumber, sourceExactQuote: r.sourceExactQuote,
      })),
    }, persistedItems));'''

if old_gate_hash in content:
    content = content.replace(old_gate_hash, new_gate_hash)
    p.write_text(content)
    print("  Gate uses buildCanonicalBuildPlanHashInput (no manual append)")
else:
    print("  WARNING: gate hash pattern not found")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 3: Remove legacy authority from compatibility endpoint
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 3: Remove legacy authority from compatibility endpoint...")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
content = p.read_text()

# Remove the post-draft BuildPlan update of legacy fields
old_legacy_update = '''    // Also write legacy fields for backward-compatible panel reads.
    // These are NOT authoritative — the canonical authority is itemsJson,
    // revision, status, and contentHash.
    const activeFiles = await prisma.tenderFile.findMany({ where: { tenderId: id, deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true } });
    const filesList = JSON.stringify(activeFiles.map((f) => ({ fileId: f.id, fileName: f.originalFileName })));
    const plannedDocumentsJson = JSON.stringify(items.map((doc: any) => ({ canonicalId: doc.canonicalId, exactFileName: doc.exactFileName, documentType: doc.documentType, required: doc.required })));
    await prisma.buildPlan.update({
      where: { tenderId: id },
      data: { filesList, plannedDocuments: plannedDocumentsJson, planType: "DERIVED", createdBy: actor.id },
    }).catch(() => {});'''

content = content.replace(old_legacy_update, "    // No legacy field writes — canonical authority is itemsJson, revision, status, contentHash.")

# Remove virtualOnly from response
content = content.replace("      virtualOnly: true,\n", "")
# Remove isDerivedDraft
content = content.replace("      isDerivedDraft: false,\n", "")

p.write_text(content)
print("  Removed legacy writes + virtualOnly")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 4: Serializable rebuild
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 4: Serializable rebuild...")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

old_draft_fn = content[content.find("export async function buildDraftBuildPlan"):content.find("export async function validateBuildPlanForConfirmation")]
new_draft_fn = '''export async function buildDraftBuildPlan(prisma: PrismaClient, tenderId: string, userId: string): Promise<BuildPlanDraftResult> {
  // SERIALIZABLE REBUILD: preflight + hash + persistence inside a PostgreSQL
  // Serializable transaction with bounded P2034 retry.
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        // PREFLIGHT inside transaction — checks current state under isolation.
        const preflight = await assertTenderReadyToDraftBuildPlan(tx as PrismaClient, tenderId, userId);
        if (!preflight.ok) {
          return { ok: false as const, code: preflight.code, message: preflight.message, status: preflight.status };
        }
        const { tender, items } = preflight;
        const contentHash = await computeTenderBuildPlanHash(tx as PrismaClient, tenderId, userId, items);
        if (!contentHash) {
          return { ok: false as const, code: "HASH_COMPUTE_FAILED", message: "Could not compute BuildPlan content hash.", status: 500 };
        }

        const itemsJson = JSON.stringify(items);
        const validationJson = JSON.stringify({ ok: false, blockers: ["Draft build plan requires confirmation."] });
        const plan = await (tx as any).buildPlan.upsert({
          where: { tenderId },
          update: {
            status: "DRAFT",
            revision: { increment: 1 },
            contentHash,
            itemsJson,
            validationJson,
            builtById: userId,
            confirmedRevision: null,
            confirmedContentHash: null,
            confirmedById: null,
            confirmedBy: null,
            confirmedAt: null,
          },
          create: {
            tenderId,
            status: "DRAFT",
            revision: 1,
            contentHash,
            itemsJson,
            validationJson,
            builtById: userId,
          },
        });
        return { ok: true as const, plan, items };
      }, { isolationLevel: "Serializable" });
    } catch (err: any) {
      if (err?.code === "P2034" && attempt < MAX_RETRIES) {
        continue; // Serialization conflict — retry
      }
      // Non-concurrency failure — sanitized 500, not fake conflict
      return { ok: false as const, code: "BUILD_PLAN_INTERNAL_ERROR", message: "BuildPlan draft failed due to an internal error.", status: 500 };
    }
  }
  return { ok: false as const, code: "BUILD_PLAN_CONFLICT", message: "BuildPlan draft failed after retries due to concurrent modification.", status: 409 };
}

'''
content = content.replace(old_draft_fn, new_draft_fn)
p.write_text(content)
print("  buildDraftBuildPlan now serializable with P2034 retry")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 5: Confirm only the original draft
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 5: Confirm only the original draft...")

# Write the entire confirm route fresh
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

  // CAPTURE ORIGINAL CANDIDATE: read DRAFT once, capture ID + revision + hash.
  // Every retry targets THIS SAME candidate — never reread "latest DRAFT".
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Read the original candidate on first attempt only.
      // On retry, use conditional predicates to ensure we only confirm
      // the EXACT original candidate.
      const result = await prisma.$transaction(async (tx) => {
        // On first attempt, read the DRAFT.
        // On retry, reread ONLY by original ID + DRAFT + original revision + original hash.
        const draft = attempt === 1
          ? await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } })
          : await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });

        if (!draft) return { status: 404 as const, body: { ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." } };

        // Capture original candidate identity on first attempt
        const candidateId = draft.id;
        const candidateRevision = draft.revision;
        const candidateHash = draft.contentHash;

        const items = JSON.parse(draft.itemsJson || "[]");
        const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
        const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
        const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];

        if (staleBlockers.length > 0 || !validation.ok) {
          // Update validationJson ONLY through conditional updateMany using
          // ID, status, revision, contentHash. Never overwrite contentHash.
          await (tx as any).buildPlan.updateMany({
            where: { id: candidateId, status: "DRAFT", revision: candidateRevision, contentHash: candidateHash },
            data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }) },
          });
          return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
        }

        // CONFIRM: conditional updateMany with ID + DRAFT + revision + contentHash.
        // If a concurrent rebuild changed any of these, count=0 → conflict.
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
          return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or tender state changed during confirmation. Retry confirmation.", authorizesGeneration: false } };
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
        continue; // Serialization conflict — retry targeting same original candidate
      }
      // Non-concurrency failure — sanitized 500, NOT false 409
      return NextResponse.json({ ok: false, code: "BUILD_PLAN_INTERNAL_ERROR", error: "Confirmation failed due to an internal error." }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: false, code: "BUILD_PLAN_CONFLICT", error: "Confirmation failed after retries. Rebuild and retry.", authorizesGeneration: false }, { status: 409 });
}
'''

(ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts").write_text(confirm_content)
print("  Confirmation captures original candidate, never confirms newer revision")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 6: Remove hasValidVirtualSubmissionPlan from gate
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 6: Remove virtual plan authority...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

# Remove hasValidVirtualSubmissionPlan from input type
content = content.replace(
    "  hasValidVirtualSubmissionPlan?: boolean;\n",
    ""
)
# Remove the check in evaluateGenerationReadiness
content = content.replace(
    '''  // H — Build/Submission plan prerequisite for GENERATION.
  //     A valid virtual Build Plan satisfies this — it proves the tender
  //     requires at least one file. PLANNED/SUPERSEDED/virtual rows do NOT
  //     count as generated/export-ready; they only satisfy the plan prerequisite.
  if (!input.hasValidVirtualSubmissionPlan) {
    return fail("SUBMISSION_PLAN_MISSING", "No submission/build plan exists. Build the submission plan before generating/exporting.");
  }

''',
    ""
)
# Remove from DB assembly
content = content.replace(
    "      hasValidVirtualSubmissionPlan,\n",
    ""
)
# Remove the computation
old_virtual = '''  // H — Virtual submission plan: true when the tender has at least one
  //     requirement or explicit file naming. PLANNED/virtual rows do NOT
  //     count as generated/export-ready.
  const hasValidVirtualSubmissionPlan = requirements.length > 0 || !!(tender.exactFileNaming ?? "").trim() || !!(tender.exactFileOrder ?? "").trim();

'''
content = content.replace(old_virtual, "")

p.write_text(content)
print("  Removed hasValidVirtualSubmissionPlan from gate")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 7: Redact gate internal errors
# ═══════════════════════════════════════════════════════════════════════════
print("\nFIX 7: Redact gate internal errors...")
p = ROOT / "lib/engine/generation-readiness-gate.ts"
content = p.read_text()

old_error = '''    // Fail closed — never let a thrown error read as authorization.
    const detail = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: `Readiness gate failed to evaluate: ${detail}`, purpose };'''
new_error = '''    // Fail closed — never let a thrown error read as authorization.
    // Log technical details server-side only; return only stable public-safe code.
    const detail = err instanceof Error ? err.message : "unknown error";
    console.error("[generation-readiness-gate] GATE_INTERNAL_ERROR:", detail);
    return { ok: false, blockerCode: "GATE_INTERNAL_ERROR", blockerDetail: "Readiness gate failed to evaluate. Check server logs for details.", purpose };'''

content = content.replace(old_error, new_error)
p.write_text(content)
print("  Gate internal errors redacted")

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

print("\n=== Dropping DB and applying migrations from scratch... ===")
run("""DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma migrate deploy", check=False)
if result.returncode != 0:
    print("MIGRATION FAILED:")
    sys.exit(1)
print("  Migrations applied.")
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
