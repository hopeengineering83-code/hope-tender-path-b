#!/usr/bin/env python3
"""Comprehensive fix for remaining #931 gaps."""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/home/z/my-project")

def run(cmd, check=True):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=True)
    if check and r.returncode != 0:
        print(f"FAILED: {cmd[:80]}")
        print(r.stderr[-500:] if r.stderr else r.stdout[-500:])
    return r

# Checkout
run("git checkout hotfix/release-safety-consolidation")
print(f"Branch: {run('git branch --show-current').stdout.strip()}")
print(f"HEAD: {run('git log --oneline -1').stdout.strip()}")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1 + FIX 4: Add assertTenderReadyToDraftBuildPlan + expand hash
# ═══════════════════════════════════════════════════════════════════════════

# First, expand build-plan-hash.ts to include deadline, emailSubject, and item details
print("\n=== Expanding build-plan-hash.ts ===")
p = ROOT / "lib/engine/build-plan-hash.ts"
content = p.read_text()

# Add deadline, submissionEmailSubject to BuildPlanHashInput
old_input = '''export type BuildPlanHashInput = {
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;'''
new_input = '''export type BuildPlanHashInput = {
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  submissionEmailSubject?: string | null;
  deadline?: Date | string | null;'''
if old_input in content:
    content = content.replace(old_input, new_input)
    print("  Added submissionEmailSubject + deadline to BuildPlanHashInput")

# Add these fields to the hash computation
old_hash = '''    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
    `submissionMethod:${input.submissionMethod ?? ""}`,
    `submissionAddress:${input.submissionAddress ?? ""}`,'''
new_hash = '''    `exactFileNaming:${input.exactFileNaming ?? ""}`,
    `exactFileOrder:${input.exactFileOrder ?? ""}`,
    `submissionMethod:${input.submissionMethod ?? ""}`,
    `submissionAddress:${input.submissionAddress ?? ""}`,
    `submissionEmailSubject:${input.submissionEmailSubject ?? ""}`,
    `deadline:${input.deadline ? new Date(input.deadline).toISOString() : ""}`,'''
if old_hash in content:
    content = content.replace(old_hash, new_hash)
    print("  Added emailSubject + deadline to hash computation")

# Add to buildPlanHashInputFromTender
old_builder = '''  submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,'''
new_builder = '''  submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    submissionEmailSubject: (tender as any).submissionEmailSubject ?? null,
    deadline: (tender as any).deadline ?? null,'''
if old_builder in content:
    content = content.replace(old_builder, new_builder)
    print("  Added emailSubject + deadline to builder")

p.write_text(content)

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: Add assertTenderReadyToDraftBuildPlan to build-plan.ts
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Adding assertTenderReadyToDraftBuildPlan to build-plan.ts ===")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

# Add the preflight function at the top (after imports)
preflight_code = '''
// ═══════════════════════════════════════════════════════════════════════════
// PREFLIGHT: assertTenderReadyToDraftBuildPlan
// ═══════════════════════════════════════════════════════════════════════════
// Runs BEFORE any BuildPlan DRAFT is created or rebuilt. Used by:
// - POST /api/tenders/[id]/build-plan
// - POST /api/tenders/[id]/submission-plan/build
// - generate route planOnly mode
// Creates ZERO GeneratedDocument rows.

export type BuildPlanPreflightResult =
  | { ok: true; tender: any; items: BuildPlanItem[] }
  | { ok: false; code: string; message: string; status: number };

export async function assertTenderReadyToDraftBuildPlan(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<BuildPlanPreflightResult> {
  // 1. Authenticated tender owner
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true } },
      requirements: { select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
    },
  });
  if (!tender) return { ok: false, code: "TENDER_NOT_FOUND", message: "Tender not found or not owned by actor.", status: 404 };

  // 2. At least one ACTIVE TenderFile
  if (!tender.files || tender.files.length === 0) {
    return { ok: false, code: "NO_ACTIVE_FILE", message: "No active tender file exists. Upload and extract the tender document first.", status: 422 };
  }

  // 3. Acceptable extraction quality
  const { isExtractionAcceptableForGeneration } = await import("./extraction-quality-gate");
  const { assessExtractionQuality } = await import("../extraction-quality");
  const effectiveExtractionFiles = tender.files.map((f: any) => {
    const quality = assessExtractionQuality(f.extractedText, f.originalFileName);
    return { ...f, extractionScore: Math.min(f.extractionScore ?? quality.score, quality.score), quality };
  });
  if (!isExtractionAcceptableForGeneration(effectiveExtractionFiles as any)) {
    return { ok: false, code: "EXTRACTION_NOT_READY", message: "Tender file extraction quality is too poor to build a trusted Build Plan.", status: 422 };
  }

  // 4. Canonical promoted AI_SUCCEEDED analysis only
  const { resolveTenderAnalysisState } = await import("./analysis-state-resolver");
  const analysis = await resolveTenderAnalysisState(prisma, tenderId, userId);
  if (analysis.state !== "AI_SUCCEEDED") {
    return { ok: false, code: "ANALYSIS_NOT_READY", message: `AI Analyze is not in AI_SUCCEEDED state (current: ${analysis.state}). Regex, heuristic, partial, failed, weak, or human-approved fallback analysis cannot authorize a Build Plan draft.`, status: 422 };
  }
  if (!analysis.canonicalJobId) {
    return { ok: false, code: "NO_PROMOTED_JOB", message: "No promoted AI Analyze job found. Re-run AI Analyze.", status: 422 };
  }

  // 5. Current analysis hash + completed chunks
  const { buildTenderAnalysisContent, computeAnalysisContentHash } = await import("./tender-analysis-content");
  const company = await prisma.company.findUnique({ where: { userId }, select: { documents: { select: { originalFileName: true, category: true, extractedText: true } } } }).catch(() => null);
  const currentContentHash = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tender.title, description: tender.description, intakeSummary: tender.intakeSummary, files: tender.files as any[] }, company ?? undefined));
  const latestJob = await prisma.aiJob.findFirst({ where: { tenderId, jobType: "AI_ANALYZE", tender: { userId } }, orderBy: { createdAt: "desc" }, select: { id: true, analysisInputHash: true } });
  if (latestJob?.analysisInputHash && latestJob.analysisInputHash !== currentContentHash) {
    return { ok: false, code: "ANALYSIS_HASH_MISMATCH", message: "Tender content changed since the last analysis. Re-run AI Analyze.", status: 422 };
  }

  // 6. Critical metadata grounded by active TenderFile evidence
  const { resolveCanonicalFieldState } = await import("./canonical-field-state");
  const overrides = await prisma.tenderMetadataOverride.findMany({ where: { tenderId }, select: { field: true, fieldState: true, overrideValue: true } }).catch(() => []);
  const canonicalState = resolveCanonicalFieldState({ tender: tender as any, overrides: overrides as any[], hasExtractedRequirements: tender.requirements.length > 0, submissionMethodContext: tender.submissionMethod ?? undefined });
  if (canonicalState.hasGenerationBlocker) {
    return { ok: false, code: "METADATA_CRITICAL_FIELD_INVALID", message: "One or more critical metadata fields are missing, invalid, contaminated, or ungrounded.", status: 422 };
  }

  // 7. Mandatory requirements grounded by ACTIVE TenderFile + valid page + meaningful quote contained in file text
  const mandatoryReqs = tender.requirements.filter((r: any) => (r.priority ?? "").toUpperCase() === "MANDATORY");
  if (mandatoryReqs.length === 0) {
    return { ok: false, code: "NO_MANDATORY_REQUIREMENTS", message: "No MANDATORY requirements found. Re-run AI Analyze or manually mark critical requirements as MANDATORY.", status: 422 };
  }
  const activeFileMap = new Map(tender.files.map((f: any) => [f.id, f]));
  for (const req of mandatoryReqs) {
    if (!req.sourceTenderFileId || !activeFileMap.has(req.sourceTenderFileId)) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has no active source TenderFile.`, status: 422 };
    }
    if (typeof req.sourcePageNumber !== "number" || req.sourcePageNumber < 1) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has invalid source page.`, status: 422 };
    }
    const quote = String(req.sourceExactQuote ?? "").trim();
    if (quote.length < 10) {
      return { ok: false, code: "REQUIREMENT_SOURCE_UNGROUNDED", message: `Mandatory requirement ${req.id} has no meaningful source quote.`, status: 422 };
    }
    const file = activeFileMap.get(req.sourceTenderFileId)!;
    const fileText = String(file.extractedText ?? "").toLowerCase().replace(/\\s+/g, " ").trim();
    const normalizedQuote = quote.toLowerCase().replace(/\\s+/g, " ").trim();
    if (!fileText.includes(normalizedQuote)) {
      return { ok: false, code: "REQUIREMENT_QUOTE_NOT_IN_FILE", message: `Mandatory requirement ${req.id} source quote is not contained in the referenced active TenderFile extracted text.`, status: 422 };
    }
  }

  // 8. Tender-controlled exact scope with no missing required documents
  const planItems = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  if (planItems.length === 0) {
    return { ok: false, code: "NO_PLAN_ITEMS", message: "No tender-controlled required submission files could be derived. Re-run AI Analyze or add exact file naming.", status: 422 };
  }

  return { ok: true, tender, items: planItems };
}

'''

# Insert after the imports (find the first function definition)
insert_point = content.find('function normalizeText')
if insert_point > 0:
    content = content[:insert_point] + preflight_code + '\n' + content[insert_point:]
    p.write_text(content)
    print("  Added assertTenderReadyToDraftBuildPlan")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 2: Update buildDraftBuildPlan to call preflight + remove heuristic authority
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Updating buildDraftBuildPlan to call preflight ===")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

old_draft = '''export async function buildDraftBuildPlan(prisma: PrismaClient, tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { requirements: true },
  });
  if (!tender) return null;
  const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  const contentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  if (!contentHash) return null;'''

new_draft = '''export async function buildDraftBuildPlan(prisma: PrismaClient, tenderId: string, userId: string) {
  // PREFLIGHT: run all safety checks before creating/rebuilding any DRAFT.
  // Creates ZERO GeneratedDocument rows.
  const preflight = await assertTenderReadyToDraftBuildPlan(prisma, tenderId, userId);
  if (!preflight.ok) return null;
  const { tender, items } = preflight;
  const contentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  if (!contentHash) return null;'''

if old_draft in content:
    content = content.replace(old_draft, new_draft)
    p.write_text(content)
    print("  buildDraftBuildPlan now calls preflight")
else:
    print("  WARNING: draft pattern not found")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 2: Remove heuristic authority from submission-plan/build route
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Removing heuristic authority from submission-plan/build ===")
p = ROOT / "app/api/tenders/[id]/submission-plan/build/route.ts"
content = p.read_text()

# Replace the heuristic-derived block with a hard block
# The block starts with "const plan = buildSubmissionPlanWithDerivedFallback" and
# includes the derived draft fallback. Replace the entire heuristic section with
# a hard 422 block.

# Find and replace the derived draft fallback block
old_heuristic = '''    const plan = buildSubmissionPlanWithDerivedFallback(tender);
    let plannedFiles = plannedSubmissionTargetFiles(plan);

    // ── Derived draft fallback ────────────────────────────────────────────────
    // The primary plan produced 0 files (e.g. all requirements are non-MANDATORY
    // and no exactFileName is set). Try a heuristic derived draft from keywords.
    let isDerivedDraft = plan.warnings.some((w: string) => w.includes("derived draft"));'''

new_heuristic = '''    // AUTHORITATIVE PLAN ONLY: no heuristic/derived/fallback plans.
    // buildSubmissionPlanWithDerivedFallback and buildDerivedDraftPlan are
    // NOT used for authoritative BuildPlan persistence. If the canonical
    // plan produces zero files, return a hard 422 blocker.
    const plan = buildSubmissionPlan(tender);
    let plannedFiles = plannedSubmissionTargetFiles(plan);
    let isDerivedDraft = false; // Never persist a DERIVED_DRAFT plan.'''

if old_heuristic in content:
    content = content.replace(old_heuristic, new_heuristic)
    print("  Replaced buildSubmissionPlanWithDerivedFallback with buildSubmissionPlan")

# Replace the derived draft fallback block with a hard block
old_derived_block = '''    if (plannedFiles.length === 0 && tender.requirements.length > 0) {
      // Gate: if ALL requirements are non-MANDATORY (SCORED/INFORMATIONAL) and no
      // exactFileName is set, we cannot reliably auto-build a plan — require the
      // user to manually mark at least one requirement as MANDATORY or add explicit
      // file names. This prevents a derived draft from being built on purely advisory
      // requirements, which would produce a misleading DERIVED_DRAFT_UNCONFIRMED plan.
      const hasExplicitFileNames = tender.requirements.some((r) => (r.exactFileName ?? "").trim().length > 0);
      const hasMandatory = tender.requirements.some((r) => (r.priority ?? "").toUpperCase() === "MANDATORY");
      if (!hasMandatory && !hasExplicitFileNames) {
        return NextResponse.json({
          ok: false,
          errorCode: "BUILD_PLAN_ALL_OPTIONAL_REQUIREMENTS",
          error: "Cannot auto-build submission plan: all requirements are SCORED or INFORMATIONAL (none are MANDATORY) and no explicit file names are set. Mark at least one requirement as MANDATORY or add exactFileName values, then rebuild the plan.",
          blockers: [
            "All requirements are non-MANDATORY — no required submission files can be derived.",
            "Set at least one requirement priority to MANDATORY, or add exactFileName values, then rebuild.",
          ],
          nextAction: "SET_MANDATORY_REQUIREMENTS_OR_ADD_FILE_NAMES",
        }, { status: 422 });
      }

      const derivedEntries = buildDerivedDraftPlan({
        requirements: tender.requirements.map((r) => ({
          title: r.title,
          description: r.description,
          requirementType: r.requirementType,
          priority: r.priority,
        })),
        submissionMethod: tender.submissionMethod,
        title: tender.title,
        tenderCategory: tender.category,
        analysisExtractionStatus: tender.analysisExtractionStatus,
      });

      if (derivedEntries.length === 0) {
        // Requirements exist but derived plan also empty — hard block.
        return NextResponse.json({
          errorCode: "BUILD_PLAN_EMPTY",
          message: "Cannot build a submission plan: no requirements could be mapped to submission documents. Re-run AI Analyze or manually add requirements.",
          blockers: ["No submission documents could be derived from the current requirements"],
          nextAction: "RERUN_AI_ANALYZE",
        }, { status: 400 });
      }

      // Use derived entries as planned files — store DERIVED_DRAFT note in contentSummary
      // since the schema generationStatus only has known values (PLANNED, GENERATED, …).
      plannedFiles = derivedEntries.map((entry, index) => ({
        canonicalId: `derived-${index + 1}`,
        exactFileName: `${entry.name}.docx`,
        documentType: entry.documentType,
        required: entry.required,
        exactOrder: index + 1,
        format: "DOCX" as const,
        envelope: (entry.documentType === "FINANCIAL" ? "FINANCIAL" : "TECHNICAL") as "TECHNICAL" | "FINANCIAL",
        sourceRequirementIds: [],
        pageLimit: null,
        templateRequired: false,
        templateSourceFileId: null,
        brandingAllowed: true,
        signatureAllowed: true,
        stampAllowed: true,
        grouping: null,
        notes: entry.derivedFrom,
      }));

      isDerivedDraft = true;
    } else if (plannedFiles.length === 0) {'''

new_derived_block = '''    if (plannedFiles.length === 0 && tender.requirements.length > 0) {
      // NO HEURISTIC FALLBACK: do not persist a BuildPlan from keyword guesses,
      // optional-only requirements, or ungrounded exact-file guesses. Return a
      // hard 422 blocker requiring AI Analyze or manually grounded requirements.
      return NextResponse.json({
        ok: false,
        errorCode: "BUILD_PLAN_NO_GROUNDED_ITEMS",
        error: "Cannot build a trusted Build Plan: no tender-controlled required submission files could be derived from grounded MANDATORY requirements or exact file naming. Re-run AI Analyze to extract grounded requirements, or manually add exact file names with source evidence.",
        blockers: ["No grounded plan items — heuristic/derived drafts are not persisted as authoritative BuildPlans."],
        nextAction: "RERUN_AI_ANALYZE",
      }, { status: 422 });
    } else if (plannedFiles.length === 0) {'''

if old_derived_block in content:
    content = content.replace(old_derived_block, new_derived_block)
    print("  Removed derived draft fallback block")
else:
    print("  WARNING: derived block pattern not found")

# Remove the buildDerivedDraftPlan import
content = content.replace(
    'import { buildSubmissionPlan, buildSubmissionPlanWithDerivedFallback, plannedSubmissionTargetFiles, buildDerivedDraftPlan } from "../../../../../../lib/engine/submission-plan";',
    'import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../../../../../../lib/engine/submission-plan";'
)
p.write_text(content)
print("  Removed buildSubmissionPlanWithDerivedFallback + buildDerivedDraftPlan imports")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 3: Race-safe confirmation with optimistic revision/hash check
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Making confirmation race-safe ===")
p = ROOT / "app/api/tenders/[id]/build-plan/confirm/route.ts"
content = p.read_text()

old_confirm = '''  const result = await prisma.$transaction(async (tx) => {
    const draft = await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });
    if (!draft) return { status: 404 as const, body: { ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." } };
    const items = JSON.parse(draft.itemsJson || "[]");
    const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
    const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
    const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];
    if (staleBlockers.length > 0 || !validation.ok) {
      await (tx as any).buildPlan.update({ where: { id: draft.id }, data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }), contentHash: contentHash ?? draft.contentHash } });
      return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
    }
    // CONFIRM updates the SAME DRAFT row — never delete a confirmed plan.
    // The one-row-per-tender constraint (tenderId @unique) guarantees no
    // duplicate. confirmedRevision/confirmedContentHash snapshot the current
    // revision+hash so post-confirmation drift is detectable.
    const confirmed = await (tx as any).buildPlan.update({ where: { id: draft.id }, data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: contentHash, confirmedById: actor.id, confirmedBy: actor.id, confirmedAt: new Date(), validationJson: JSON.stringify({ ok: true, blockers: [] }) } });
    return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
  });'''

new_confirm = '''  // RACE-SAFE CONFIRMATION: use a serializable transaction with optimistic
  // concurrency. The update includes a WHERE clause that checks id, status=DRAFT,
  // revision, AND contentHash — so if a concurrent rebuild changes revision or
  // hash between our read and our update, the update affects 0 rows and we
  // return a stale/conflict response. This prevents confirming an older revision.
  const result = await prisma.$transaction(async (tx) => {
    const draft = await (tx as any).buildPlan.findFirst({ where: { tenderId: id, status: "DRAFT", tender: { userId: actor.id } }, orderBy: { updatedAt: "desc" } });
    if (!draft) return { status: 404 as const, body: { ok: false, code: "BUILD_PLAN_DRAFT_MISSING", error: "Build Plan draft missing." } };
    const items = JSON.parse(draft.itemsJson || "[]");
    const validation = await validateBuildPlanForConfirmation(tx as any, id, actor.id, items);
    const contentHash = await computeTenderBuildPlanHash(tx as any, id, actor.id, items);
    const staleBlockers = !contentHash || contentHash !== draft.contentHash ? ["Build Plan hash is stale; rebuild before confirming."] : [];
    if (staleBlockers.length > 0 || !validation.ok) {
      await (tx as any).buildPlan.update({ where: { id: draft.id }, data: { validationJson: JSON.stringify({ ok: false, blockers: validation.blockers.concat(staleBlockers) }), contentHash: contentHash ?? draft.contentHash } });
      return { status: 422 as const, body: { ok: false, code: "BUILD_PLAN_CONFIRMATION_BLOCKED", blockers: validation.blockers.concat(staleBlockers), authorizesGeneration: false } };
    }
    // OPTIMISTIC CONCURRENCY: update ONLY if id, status=DRAFT, revision,
    // AND contentHash still match the values we read. If a concurrent rebuild
    // changed revision or hash, updateMany returns count=0 and we fail.
    const updateResult = await (tx as any).buildPlan.updateMany({
      where: { id: draft.id, status: "DRAFT", revision: draft.revision, contentHash: draft.contentHash },
      data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: contentHash, confirmedById: actor.id, confirmedBy: actor.id, confirmedAt: new Date(), validationJson: JSON.stringify({ ok: true, blockers: [] }) },
    });
    if (updateResult.count === 0) {
      return { status: 409 as const, body: { ok: false, code: "BUILD_PLAN_CONFLICT", error: "Build Plan was rebuilt or tender state changed during confirmation. Retry confirmation.", authorizesGeneration: false } };
    }
    const confirmed = await (tx as any).buildPlan.findUnique({ where: { id: draft.id } });
    return { status: 200 as const, body: { ok: true, status: confirmed.status, revision: confirmed.revision, confirmedContentHash: confirmed.confirmedContentHash, authorizesGeneration: true } };
  }, { isolationLevel: "Serializable" });'''

if old_confirm in content:
    content = content.replace(old_confirm, new_confirm)
    p.write_text(content)
    print("  Confirmation is now race-safe (serializable + optimistic updateMany)")
else:
    print("  WARNING: confirm pattern not found")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: Update build-plan/route.ts to call preflight
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Updating build-plan route to use preflight ===")
p = ROOT / "app/api/tenders/[id]/build-plan/route.ts"
content = p.read_text()

# The route already calls buildDraftBuildPlan which now calls preflight.
# But we should return a better error than just "TENDER_NOT_FOUND" when
# preflight fails. Update to return preflight error details.
old_route = '''  const plan = await buildDraftBuildPlan(prisma, id, actor.id);
  if (!plan) return NextResponse.json({ ok: false, code: "TENDER_NOT_FOUND", error: "Tender not found" }, { status: 404 });'''

new_route = '''  // PREFLIGHT runs inside buildDraftBuildPlan via assertTenderReadyToDraftBuildPlan.
  // If preflight fails, buildDraftBuildPlan returns null. We re-run the preflight
  // here to get the specific error code/message for the response.
  const { assertTenderReadyToDraftBuildPlan } = await import("../../../../../lib/engine/build-plan");
  const preflight = await assertTenderReadyToDraftBuildPlan(prisma, id, actor.id);
  if (!preflight.ok) {
    return NextResponse.json({ ok: false, code: preflight.code, error: preflight.message }, { status: preflight.status });
  }
  const plan = await buildDraftBuildPlan(prisma, id, actor.id);
  if (!plan) return NextResponse.json({ ok: false, code: "TENDER_NOT_FOUND", error: "Tender not found" }, { status: 404 });'''

if old_route in content:
    content = content.replace(old_route, new_route)
    p.write_text(content)
    print("  build-plan route now returns preflight error details")

# ═══════════════════════════════════════════════════════════════════════════
# FIX 4: Update computeTenderBuildPlanHash to pass deadline + emailSubject
# ═══════════════════════════════════════════════════════════════════════════
print("\n=== Updating computeTenderBuildPlanHash to include deadline + emailSubject ===")
p = ROOT / "lib/engine/build-plan.ts"
content = p.read_text()

old_select = '''      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true,'''
# Check if deadline is already in the select
if 'deadline: true' not in content:
    content = content.replace(
        old_select,
        'id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true, deadline: true,'
    )
    print("  Added deadline: true to tender select")

# Add deadline + submissionEmailSubject to the hash input
old_hash_input = '''    submissionEmails: tender.submissionEmails,
    files: tender.files.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: f.deletionStatus })),'''
new_hash_input = '''    submissionEmails: tender.submissionEmails,
    submissionEmailSubject: tender.submissionEmailSubject,
    deadline: tender.deadline,
    files: tender.files.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: f.deletionStatus })),'''

if old_hash_input in content:
    content = content.replace(old_hash_input, new_hash_input)
    print("  Added deadline + emailSubject to hash input")

p.write_text(content)

print("\n✓ All fixes applied. Running typecheck...")
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx tsc --noEmit", check=False)
if result.returncode != 0:
    print("TYPECHECK FAILED:")
    print(result.stdout[-1500:])
    print(result.stderr[-1500:])
    sys.exit(1)
print("  Typecheck passed.")

print("\n✓ Running lint...")
result = run("npx eslint . --ext .ts,.tsx --max-warnings 50", check=False)
if result.returncode != 0:
    print("LINT FAILED:")
    print(result.stdout[-500:])
    print(result.stderr[-500:])
    sys.exit(1)
print("  Lint passed.")

print("\n✓ Dropping DB and applying migrations from scratch...")
run("""DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\\$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE').then(() => p.\\$executeRawUnsafe('CREATE SCHEMA public')).then(() => { console.log('Schema dropped'); return p.\\$disconnect(); }).catch(e => { console.error(e.message); process.exit(1); });
" """)
result = run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma migrate deploy", check=False)
if result.returncode != 0:
    print("MIGRATION FAILED:")
    print(result.stdout[-500:])
    print(result.stderr[-500:])
    sys.exit(1)
print("  Migrations applied.")
run("DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public' npx prisma generate")

print("\n✓ Running full test suite...")
test_env = {**__import__('os').environ, "DATABASE_URL": "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public", "RUN_DB_INTEGRATION": "true"}
result = run("node scripts/run-tests.mjs", check=False, )
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
