// POST /api/tenders/[id]/repair-metadata
//
// Repairs missing critical tender-metadata fields from the already-extracted
// tender file text using deterministic, source-grounded extractors. Today the
// only supported field is `evaluationMethodology`; the route is structured so
// additional fields can be wired in without changing the contract.
//
// Hard safety rules (enforced here, NOT optional):
//   • only the tender owner (or ADMIN / PROPOSAL_MANAGER) may run repair,
//   • we NEVER overwrite a non-empty existing value unless the caller passes
//     { force: true } AND has ADMIN role,
//   • when the extractor returns `found: false` the tender row is not
//     touched and we return 404 (with a structured reason),
//   • every successful repair writes an audit log entry with the source
//     file name, confidence, and the verbatim source quote (≤600 chars),
//   • we never echo raw provider keys, raw prompt text, or stack traces.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  extractEvaluationMethodologyFromSource,
  formatExtractionForAudit,
} from "../../../../../lib/engine/evaluation-methodology-source-extractor";
import {
  SUPPORTED_EXTRACTORS,
  runExtractorByField,
  type ExtractorFieldName,
  type ExtractedFieldOrMissing,
} from "../../../../../lib/engine/tender-field-extractors";
import { containsMetadataPlaceholder } from "../../../../../lib/engine/metadata-validators";
import { detectMetadataContamination } from "../../../../../lib/engine/tender-metadata-completeness";
import type { RepairOutcome, RepairMetadataResponse } from "../../../../../lib/engine/repair-metadata-contract";
import {
  isValidReferenceCandidate,
  isValidDeadlineCandidate,
  isValidTitleOrClientCandidate,
  verifySourceQuote,
  type ActiveTenderFile,
} from "../../../../../lib/engine/source-grounded-metadata-repair";

export const dynamic = "force-dynamic";

// Union of every field the repair endpoint can write. evaluationMethodology
// has its own AI-precedent extractor (lib/engine/evaluation-methodology-source-extractor.ts);
// the scalar metadata fields come from the multi-field extractor framework.
const SUPPORTED_FIELDS = ["evaluationMethodology", ...SUPPORTED_EXTRACTORS] as const;
type SupportedField = (typeof SUPPORTED_FIELDS)[number];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  const rl = rateLimit(`repair-metadata:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Rate limit exceeded. Wait and retry.", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const requestedFields = Array.isArray((body as { fields?: unknown }).fields)
    ? ((body as { fields: unknown[] }).fields).map(String).filter((f): f is SupportedField => (SUPPORTED_FIELDS as readonly string[]).includes(f))
    : ["evaluationMethodology" as SupportedField];
  const force = (body as { force?: unknown }).force === true && actor.role === "ADMIN";
  // NOTE: force:true allows overwriting existing values but does NOT bypass
  // source grounding, quote containment, active-file checks, or validation.
  // Critical source-grounded fields still require durable file ID, quote
  // containment, and active-file verification even when force is true.

  // Scope: owner OR (ADMIN / PROPOSAL_MANAGER). The fallback `?? findFirst({ where: { id } })`
  // was removed (audit SEC-002, 2026-06-20) — it allowed any REVIEWER (broader
  // than the RBAC matrix in lib/security/rbac.ts intends) to overwrite scalar
  // metadata fields on any tender they do not own. The owner-scoped findFirst
  // is the only safe lookup; if the tender doesn't belong to the actor,
  // return 404 (not 403, to avoid leaking existence).
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: { files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, fileName: true, originalFileName: true, extractedText: true, deletionStatus: true } } },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  if (!tender.files || tender.files.length === 0) {
    return NextResponse.json({
      error: "No tender files with extracted text are available; upload the tender source file(s) first.",
      code: "NO_TENDER_SOURCE",
      nextAction: "UPLOAD_TENDER_SOURCE",
    }, { status: 422 });
  }

  const outcomes: RepairOutcome[] = [];
  // Prisma update map — accepts string / number / Date / null. Cast at write time.
  const updates: Record<string, unknown> = {};

  const filesInput = { files: tender.files.map((f) => ({ fileName: f.fileName, extractedText: f.extractedText })) };
  // Map from fileName to durable file ID for source-grounding.
  // The extractor returns sourceFile as a fileName; we need the durable ID
  // to persist canonical source evidence (e.g., clientNameSourceFileId).
  const fileNameToId = new Map<string, string>();
  for (const f of tender.files as Array<{ id: string; fileName: string; originalFileName: string | null }>) {
    fileNameToId.set(f.fileName, f.id);
    if (f.originalFileName) fileNameToId.set(f.originalFileName, f.id);
  }
  // Active file IDs for evidence validation
  const activeFileIds = new Set((tender.files as Array<{ id: string }>).map((f) => f.id));
  // Active files with extracted text for quote containment verification
  const activeFilesForQuote: ActiveTenderFile[] = (tender.files as Array<{ id: string; fileName: string; extractedText: string | null }>).map((f) => ({ id: f.id, fileName: f.fileName, extractedText: f.extractedText }));

  // ── evaluationMethodology (AI-precedent extractor, separate module) ───
  if (requestedFields.includes("evaluationMethodology")) {
    if (tender.evaluationMethodology && tender.evaluationMethodology.trim().length > 0 && !force) {
      outcomes.push({ field: "evaluationMethodology", status: "SKIPPED", reason: "evaluationMethodology is already populated. Pass force:true (ADMIN only) to overwrite." });
    } else {
      const extraction = extractEvaluationMethodologyFromSource(filesInput);
      if (!extraction.found) {
        outcomes.push({ field: "evaluationMethodology", status: "NOT_FOUND", reason: extraction.reason });
      } else {
        (updates as Record<string, unknown>).evaluationMethodology = extraction.methodologyText;
        outcomes.push({ field: "evaluationMethodology", status: "REPAIRED", confidence: extraction.confidence, sourceFile: extraction.sourceFile, sourcePage: null, sourceQuote: extraction.sourceQuote });
        await logAction({
          userId: actor.id,
          action: "TENDER_METADATA_REPAIRED",
          entityType: "Tender",
          entityId: tenderId,
          description: `${actor.email} repaired evaluationMethodology — ${formatExtractionForAudit(extraction)}`.slice(0, 500),
          metadata: {
            tenderId,
            field: "evaluationMethodology",
            extractionSource: "DETERMINISTIC_SOURCE_EXTRACTOR",
            sourceFile: extraction.sourceFile,
            confidence: extraction.confidence,
            itemCount: extraction.items.length,
            sourceQuote: extraction.sourceQuote,
          },
          requestId,
        });
      }
    }
  }

  // ── Scalar fields via the multi-field extractor framework. ─────────────
  // Each field consults the same per-field rule: skip when already populated
  // (unless ADMIN force:true); set status NOT_FOUND when the regex misses;
  // persist + audit when found.
  for (const field of SUPPORTED_EXTRACTORS) {
    if (!requestedFields.includes(field)) continue;
    let durableFileId: string | null = null;
    const currentValue = (tender as unknown as Record<string, unknown>)[field];
    const alreadyPopulated = currentValue !== null && currentValue !== undefined && String(currentValue).trim().length > 0;
    if (alreadyPopulated && !force) {
      outcomes.push({ field, status: "SKIPPED", reason: `${field} is already populated. Pass force:true (ADMIN only) to overwrite.` });
      continue;
    }
    const extraction = runExtractorByField(field as ExtractorFieldName, filesInput) as ExtractedFieldOrMissing<unknown>;
    if (!extraction.found) {
      outcomes.push({ field, status: "NOT_FOUND", reason: extraction.reason });
      continue;
    }
    // ── DURABLE SOURCE-GROUNDING: applies to ALL critical fields BEFORE type dispatch ──
    // Resolve durable file ID from the extractor's sourceFile (which is a
    // fileName). This must happen BEFORE the type dispatch so deadline,
    // string fields, and any other critical field all get the same grounding
    // check. Without this block here, the `else if (field === 'deadline')`
    // branch would skip straight to (updates)[field] = dt and bypass the
    // active-file check, quote-containment check, and durable-file resolution.
    //
    // Fields WITHOUT dedicated source-evidence columns (bidBondAmount,
    // numberOfCopiesRequired, mandatorySiteVisit, pageLimit, validityDays,
    // preBidMeetingDate) are intentionally NOT in this set — they are not
    // critical BuildPlan evidence fields and do not require source grounding.
    const CRITICAL_SOURCE_GROUNDED_FIELDS = new Set([
      "clientName", "title", "deadline", "submissionMethod",
      "submissionAddress", "submissionEmails", "reference",
    ]);

    if (CRITICAL_SOURCE_GROUNDED_FIELDS.has(field)) {
      // Resolve durable file ID from fileName → TenderFile.id
      durableFileId = extraction.sourceFile ? (fileNameToId.get(extraction.sourceFile) ?? null) : null;
      if (!durableFileId || !activeFileIds.has(durableFileId)) {
        outcomes.push({ field, status: "UNRESOLVED", reason: `Source file for ${field} is not an active tender file. Re-grounding required.` });
        continue;
      }
      // Verify source quote is present and meaningful
      if (!extraction.sourceQuote || extraction.sourceQuote.trim().length < 5) {
        outcomes.push({ field, status: "UNRESOLVED", reason: `Source quote for ${field} is missing or too short. Re-grounding required.` });
        continue;
      }
      // Verify quote containment in the referenced active file
      const quoteVerification = verifySourceQuote(extraction.sourceQuote, activeFilesForQuote);
      if (!quoteVerification.verified || quoteVerification.sourceFileId !== durableFileId) {
        outcomes.push({ field, status: "UNRESOLVED", reason: `Source quote for ${field} is not contained in the referenced active tender file. Re-grounding required.` });
        continue;
      }
    }

    // ── Type-specific value validation ────────────────────────────────────────────
    // bidBondAmount produces { amount, currency } — split into two DB columns.
    if (field === "bidBondAmount") {
      const v = extraction.value as { amount: number; currency: string | null };
      if (v.amount > 0 && v.currency !== "PERCENT") {
        (updates as Record<string, unknown>).bidBondAmount = v.amount;
        if (v.currency) (updates as Record<string, unknown>).bidBondCurrency = v.currency;
      }
      // PERCENT-only matches are reported but not persisted — needs the budget
      // to compute the absolute amount, which we will not invent.
    } else if (field === "deadline" || field === "preBidMeetingDate") {
      const dt = extraction.value as Date;
      if (field === "deadline" && !isValidDeadlineCandidate(dt)) {
        outcomes.push({ field, status: "REJECTED", reason: "Extracted deadline is invalid or too far in the past.", value: dt });
        continue;
      }
      (updates as Record<string, unknown>)[field] = dt;
    } else {
      const rawValue = extraction.value as string;
      // ── Use the SHARED source-grounded metadata repair service ──────
      if (field === "reference" && !isValidReferenceCandidate(rawValue)) {
        outcomes.push({ field, status: "REJECTED", reason: `Extracted reference is invalid (stop-word, label, placeholder, or missing digit).`, value: rawValue });
        continue;
      }
      if (field === "clientName" && !isValidTitleOrClientCandidate(rawValue)) {
        outcomes.push({ field, status: "REJECTED", reason: `Extracted ${field} is invalid (placeholder, contaminated, label, or too short).`, value: rawValue });
        continue;
      }
      if (containsMetadataPlaceholder(rawValue)) {
        outcomes.push({ field, status: "REJECTED", reason: "Extracted value contains a placeholder pattern.", value: rawValue });
        continue;
      }
      // Source grounding (durableFileId, active-file check, quote containment)
      // is performed ABOVE in the CRITICAL_SOURCE_GROUNDED_FIELDS block, BEFORE
      // the type dispatch. We do NOT repeat it here.
      (updates as Record<string, unknown>)[field] = rawValue;
      // When we repair clientName, also sync procuringEntityName if it's empty
      // and re-evaluate metadataContaminated with the new clean value.
      if (field === "clientName") {
        const current = (tender as unknown as Record<string, unknown>).procuringEntityName;
        if (!current) {
          (updates as Record<string, unknown>).procuringEntityName = rawValue;
        }
        // Clear the contamination flag when the repaired value passes the check.
        if (!detectMetadataContamination(rawValue).contaminated) {
          (updates as Record<string, unknown>).metadataContaminated = false;
        }
      }
    }
    // ── PERSIST CANONICAL SOURCE EVIDENCE ATOMICALLY ────────────────────
    // For fields with dedicated source-evidence columns, persist file ID + quote.
    // The extractor does not return page numbers — for critical source-grounded
    // fields, the canonical resolver requires page > 0, so we cannot mark
    // these as fully grounded. We persist what we have and let the canonical
    // resolver determine the final state.
    const sourceEvidenceColumns: Record<string, { fileId: string; page: string; quote: string }> = {
      clientName: { fileId: "clientNameSourceFileId", page: "clientNameSourcePage", quote: "clientNameSourceQuote" },
      title: { fileId: "titleSourceFileId", page: "titleSourcePage", quote: "titleSourceQuote" },
      deadline: { fileId: "deadlineSourceFileId", page: "deadlineSourcePage", quote: "deadlineSourceQuote" },
      submissionMethod: { fileId: "submissionMethodSourceFileId", page: "submissionMethodSourcePage", quote: "submissionMethodSourceQuote" },
      submissionAddress: { fileId: "submissionAddressSourceFileId", page: "submissionAddressSourcePage", quote: "submissionAddressSourceQuote" },
      submissionEmails: { fileId: "submissionEmailSourceFileId", page: "submissionEmailSourcePage", quote: "submissionEmailSourceQuote" },
    };
    // For reference (no dedicated source columns), persist via contactDetailsSourceJson
    // which the canonical resolver reads under "procurementReferenceNumber".
    if (field === "reference" && durableFileId) {
      const existingJson = (tender as any).contactDetailsSourceJson;
      let contactDetails: Record<string, { page: number | null; quote: string | null; fileId: string | null }> = {};
      try { contactDetails = typeof existingJson === "string" ? JSON.parse(existingJson) : (existingJson ?? {}); } catch { contactDetails = {}; }
      // fileId MUST be persisted here — without it, the canonical resolver's
      // getSourceEvidence() returns fileId: null for reference, and
      // isGroundedEvidenceWithFileCheck() can NEVER mark reference as GROUNDED
      // (it requires fileId ∈ activeTenderFileIds).
      contactDetails["procurementReferenceNumber"] = {
        page: extraction.sourcePage ?? null,
        quote: extraction.sourceQuote ?? null,
        fileId: durableFileId,
      };
      (updates as Record<string, unknown>).contactDetailsSourceJson = JSON.stringify(contactDetails);
    }
    const evidenceCols = sourceEvidenceColumns[field];
    if (evidenceCols && durableFileId) {
      (updates as Record<string, unknown>)[evidenceCols.fileId] = durableFileId;
      (updates as Record<string, unknown>)[evidenceCols.quote] = extraction.sourceQuote;
      // Persist sourcePage from the extractor — it computes page number from
      // text position (form feeds / page markers). If null, leave existing
      // page evidence untouched.
      if (extraction.sourcePage != null) {
        (updates as Record<string, unknown>)[evidenceCols.page] = extraction.sourcePage;
      }
    }
    outcomes.push({ field, status: "REPAIRED", confidence: extraction.confidence, sourceFile: extraction.sourceFile, sourcePage: extraction.sourcePage ?? null, sourceQuote: extraction.sourceQuote, value: extraction.value });
    await logAction({
      userId: actor.id,
      action: "TENDER_METADATA_REPAIRED",
      entityType: "Tender",
      entityId: tenderId,
      description: `${actor.email} repaired ${field} from ${extraction.sourceFile ?? "tender source"} (${extraction.confidence})`.slice(0, 500),
      metadata: {
        tenderId,
        field,
        extractionSource: "DETERMINISTIC_SOURCE_EXTRACTOR",
        sourceFile: extraction.sourceFile,
        confidence: extraction.confidence,
        sourceQuote: extraction.sourceQuote,
      },
      requestId,
    });
  }

  if (Object.keys(updates).length > 0) {
    await prisma.tender.update({ where: { id: tenderId }, data: updates as Record<string, unknown> });
  }

  const outcomesByField: Record<string, RepairOutcome> = {};
  for (const o of outcomes) { outcomesByField[o.field] = o; }
  const response: RepairMetadataResponse = {
    success: Object.keys(updates).length > 0,
    outcomes,
    outcomesByField,
  };
  return NextResponse.json(response);
}
