// POST /api/tenders/[id]/repair-metadata
//
// Multi-field deterministic source extractor repair route.
// This route uses the regex-only fallback framework in lib/engine/tender-field-extractors.ts
// to repair or fill missing tender metadata fields from the uploaded source files.
// It NEVER paraphrases or fuzzes; it only captures verbatim strings with source grounding.
//
// Safety:
//   • uses requireRole("ADMIN", "PROPOSAL_MANAGER"),
//   • rate-limited per user,
//   • when the extractor returns found: false, the tender row is not touched,
//   • every successful repair writes an audit log entry with sourceFile and sourceQuote.
//
// Critical fields (deadline, reference, title, clientName, submissionMethod,
// submissionAddress, submissionEmails) go through source grounding:
//   • durableFileId resolved from extraction.sourceFile
//   • activeFileIds.has(durableFileId) — the file must be ACTIVE
//   • verify the quote is contained in the active file text
//   • when grounding fails, return UNRESOLVED and do NOT write the scalar
// When grounding fails, the route returns status: "UNRESOLVED" and does NOT
// write the scalar value (no fall-through to updates).

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
  type ExtractedField,
} from "../../../../../lib/engine/tender-field-extractors";
import { containsMetadataPlaceholder } from "../../../../../lib/engine/metadata-validators";
import { detectMetadataContamination } from "../../../../../lib/engine/tender-metadata-completeness";
import {
  verifySourceQuote as verifyQuoteInActiveFiles,
  isValidReferenceCandidate,
  isValidDeadlineCandidate,
  type ActiveTenderFile,
} from "../../../../../lib/engine/source-grounded-metadata-repair";

export const dynamic = "force-dynamic";

// Critical fields that MUST go through source grounding (durable file ID
// resolution, active-file check, quote containment) BEFORE the type dispatch.
// If grounding fails, the route returns UNRESOLVED and does NOT write the
// scalar value. This prevents the deadline branch from bypassing grounding
// (the prior bug) and ensures reference evidence carries a real fileId.
const CRITICAL_SOURCE_GROUNDED_FIELDS = new Set([
  "clientName",
  "title",
  "deadline",
  "submissionMethod",
  "submissionAddress",
  "submissionEmails",
  "reference",
]);

const SUPPORTED_FIELDS = ["evaluationMethodology", ...SUPPORTED_EXTRACTORS] as const;
type SupportedField = (typeof SUPPORTED_FIELDS)[number];

// Maps each critical field to its dedicated source-evidence columns so the
// PERSIST CANONICAL SOURCE EVIDENCE block can write them unconditionally
// (clearing stale pages when provenPage is null).
const EVIDENCE_COLUMNS: Record<string, { fileId: string; page: string; quote: string }> = {
  clientName: { fileId: "clientNameSourceFileId", page: "clientNameSourcePage", quote: "clientNameSourceQuote" },
  title: { fileId: "titleSourceFileId", page: "titleSourcePage", quote: "titleSourceQuote" },
  deadline: { fileId: "deadlineSourceFileId", page: "deadlineSourcePage", quote: "deadlineSourceQuote" },
  submissionMethod: { fileId: "submissionMethodSourceFileId", page: "submissionMethodSourcePage", quote: "submissionMethodSourceQuote" },
  submissionAddress: { fileId: "submissionAddressSourceFileId", page: "submissionAddressSourcePage", quote: "submissionAddressSourceQuote" },
  submissionEmails: { fileId: "submissionEmailSourceFileId", page: "submissionEmailSourcePage", quote: "submissionEmailSourceQuote" },
  reference: { fileId: "referenceSourceFileId", page: "referenceSourcePage", quote: "referenceSourceQuote" },
};

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

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: {
      files: {
        select: {
          id: true,
          fileName: true,
          extractedText: true,
          totalPages: true,
          deletionStatus: true,
        },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  if (!tender.files || tender.files.length === 0) {
    return NextResponse.json({
      error: "No tender files with extracted text are available; upload the tender source file(s) first.",
      code: "NO_TENDER_SOURCE",
      nextAction: "UPLOAD_TENDER_SOURCE",
    }, { status: 422 });
  }

  // Active tender files (filter out DELETED/PENDING_DELETE). The quote
  // verification and the activeFileIds check both reference this set so a
  // fileId pointing at a deleted file is rejected (not silently carried
  // over).
  const activeFiles: ActiveTenderFile[] = tender.files
    .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
    .map((f) => ({ id: f.id, fileName: f.fileName, extractedText: f.extractedText, totalPages: f.totalPages ?? null }));
  const activeFileIds = new Set<string>(activeFiles.map((f) => f.id));

  const results: Record<string, unknown> = {};
  const updates: Record<string, unknown> = {};
  const contactDetails: Record<string, { page: number | null, quote: string | null, fileId?: string | null }> = JSON.parse(tender.contactDetailsSourceJson || "{}");

  const filesInput = { files: tender.files.map((f) => ({ fileName: f.fileName, extractedText: f.extractedText, totalPages: f.totalPages ?? null })) };

  // ── evaluationMethodology (Specialized AI/Deterministic extractor, NON-critical) ───
  // evaluationMethodology is not in CRITICAL_SOURCE_GROUNDED_FIELDS — its
  // sourcePage is null because the methodology extractor returns prose, not
  // a single verbatim quote tied to one page.
  if (requestedFields.includes("evaluationMethodology")) {
    if (tender.evaluationMethodology && tender.evaluationMethodology.trim().length > 0 && !force) {
      results.evaluationMethodology = { status: "SKIPPED", reason: "Already populated" };
    } else {
      const extraction = extractEvaluationMethodologyFromSource(filesInput);
      if (!extraction.found) {
        results.evaluationMethodology = { status: "NOT_FOUND", reason: extraction.reason };
      } else {
        updates.evaluationMethodology = extraction.methodologyText;
        results.evaluationMethodology = { status: "REPAIRED", sourcePage: null, sourceQuote: extraction.sourceQuote, sourceFile: extraction.sourceFile, confidence: extraction.confidence, methodologyText: extraction.methodologyText };
        await logAction({
          userId: actor.id,
          action: "TENDER_METADATA_REPAIRED",
          entityType: "Tender",
          entityId: tenderId,
          description: `${actor.email} repaired evaluationMethodology`.slice(0, 500),
          metadata: {
            tenderId,
            field: "evaluationMethodology",
            sourceFile: extraction.sourceFile,
            confidence: extraction.confidence,
            sourceQuote: extraction.sourceQuote,
            extractionSource: "DETERMINISTIC_SOURCE_EXTRACTOR",
          },
          requestId,
        });
      }
    }
  }

  // ── Scalar fields via the multi-field extractor framework ─────────────
  for (const field of SUPPORTED_EXTRACTORS) {
    if (!requestedFields.includes(field)) continue;
    const currentValue = (tender as any)[field];
    const alreadyPopulated = currentValue !== null && currentValue !== undefined && String(currentValue).trim().length > 0;
    if (alreadyPopulated && !force) {
      results[field] = { status: "SKIPPED", reason: `${field} is already populated.` };
      continue;
    }

    const extraction = runExtractorByField(field as ExtractorFieldName, filesInput) as ExtractedFieldOrMissing<unknown>;
    if (!extraction.found) {
      results[field] = { status: "NOT_FOUND", reason: extraction.reason };
      continue;
    }

    const fieldData = extraction as ExtractedField<any>;

    // ── Source grounding for CRITICAL fields ────────────────────────
    // Runs BEFORE the type dispatch so the deadline branch (and every
    // other critical field branch) cannot bypass it. When grounding fails,
    // the route returns UNRESOLVED and `continue`s — no fall-through to
    // the updates object.
    let durableFileId: string | null = null;
    let provenPage: number | null = null;
    let evidenceCols: { fileId: string; page: string; quote: string } | null = null;
    if (CRITICAL_SOURCE_GROUNDED_FIELDS.has(field)) {
      // Resolve durableFileId from extraction.sourceFile. The extractor
      // returns sourceFile as a FILENAME (e.g. "tender.pdf"), not a file
      // ID. We must map it to the active file's ID by matching the fileName.
      durableFileId = extraction.sourceFile;
      const matchedFile = activeFiles.find((f) => f.fileName === durableFileId);
      durableFileId = matchedFile?.id ?? null;
      evidenceCols = EVIDENCE_COLUMNS[field] ?? null;

      // UNRESOLVED case 1: source file is missing or not an active tender file
      if (!durableFileId || !activeFileIds.has(durableFileId)) {
        results[field] = {
          status: "UNRESOLVED",
          reason: "Source file is missing or not an active tender file — re-upload or re-extract the source.",
          field,
        };
        continue;
      }

      // UNRESOLVED case 2: source quote is missing or too short to ground
      if (!extraction.sourceQuote || extraction.sourceQuote.trim().length < 5) {
        results[field] = {
          status: "UNRESOLVED",
          reason: "Source quote is missing or too short to ground the field — re-extract the source.",
          field,
        };
        continue;
      }

      // UNRESOLVED case 3: quote is not contained in the referenced active file
      const verified = verifyQuoteInActiveFiles(extraction.sourceQuote, activeFiles);
      if (!verified.verified) {
        results[field] = {
          status: "UNRESOLVED",
          reason: "Source quote is not contained in the referenced active tender file — the extractor may have hallucinated.",
          field,
        };
        continue;
      }

      provenPage = extraction.sourcePage;
    }

    // ── Type dispatch (AFTER source grounding) ──────────────────────
    // Validate critical candidates with the shared validators BEFORE writing.
    // isValidReferenceCandidate rejects TOC fragments / stop-words / labels.
    // isValidDeadlineCandidate rejects past dates / placeholder strings.
    if (field === "reference" && extraction.found) {
      const refValue = fieldData.value as unknown;
      if (typeof refValue === "string" && !isValidReferenceCandidate(refValue)) {
        results[field] = { status: "REJECTED", reason: "Reference value failed shared isValidReferenceCandidate validation", value: refValue };
        continue;
      }
    }
    if (field === "deadline" && extraction.found) {
      const dlValue = fieldData.value as unknown;
      if (!isValidDeadlineCandidate(dlValue)) {
        results[field] = { status: "REJECTED", reason: "Deadline value failed shared isValidDeadlineCandidate validation", value: dlValue };
        continue;
      }
    }

    if (field === "bidBondAmount") {
      const v = fieldData.value as { amount: number; currency: string | null };
      if (v.amount > 0 && v.currency !== "PERCENT") {
        updates.bidBondAmount = v.amount;
        if (v.currency) updates.bidBondCurrency = v.currency;
      }
    } else if (field === "deadline" || field === "preBidMeetingDate") {
      // The deadline branch does NOT re-resolve the durable file id or call
      // the quote verification helper — those happen in the
      // CRITICAL_SOURCE_GROUNDED_FIELDS block above. Bypassing them was the
      // prior bug; this branch just writes the validated value.
      const dt = fieldData.value as Date;
      (updates as Record<string, unknown>)[field] = dt;
    } else if (field === "submissionEmails") {
      updates.submissionEmails = (fieldData.value as string[]).join("|");
      updates.submissionEmailSourcePage = fieldData.sourcePage;
    } else {
      const rawValue = extraction.value as string;
      if (typeof rawValue === "string" && containsMetadataPlaceholder(rawValue)) {
        // Reject placeholder values — never store them. The continue skips
        // the audit log and DB write so the operator sees the rejection
        // without a spurious TENDER_METADATA_REPAIRED entry.
        results[field] = { status: "REJECTED", reason: "placeholder pattern detected — value matches a known placeholder, not a real extraction", value: rawValue };
        continue;
      }
      (updates as Record<string, unknown>)[field] = rawValue;

      // Handle field-specific mappings and source tracking
      if (field === "clientName") {
        if (!tender.procuringEntityName) updates.procuringEntityName = rawValue;
        updates.clientNameSourcePage = fieldData.sourcePage;
        updates.clientNameSourceQuote = fieldData.sourceQuote;
        if (!detectMetadataContamination(rawValue as string).contaminated) updates.metadataContaminated = false;
      } else if (field === "submissionMethod") {
        updates.submissionMethodSourcePage = fieldData.sourcePage;
        updates.submissionMethodSourceQuote = fieldData.sourceQuote;
      } else if (field === "submissionAddress") {
        updates.submissionAddressSourcePage = fieldData.sourcePage;
        updates.submissionAddressSourceQuote = fieldData.sourceQuote;
      } else if (["clientContactName", "clientContactTitle", "clientContactEmail", "clientContactPhone", "clientAddress", "country", "clientCity", "clientWebsite", "authorizedOfficer", "contactChannel"].includes(field)) {
        contactDetails[field] = { page: fieldData.sourcePage, quote: fieldData.sourceQuote };
      } else if (field === "projectTitle") {
        if (!tender.title || tender.title.startsWith("[REVIEW NEEDED]")) updates.title = rawValue;
      } else if (field === "submissionEmailSubject") {
        updates.submissionEmailSubject = rawValue;
      } else if (field === "reference" && durableFileId) {
        // Persist reference evidence via contactDetailsSourceJson WITH
        // fileId — without fileId, the canonical resolver's
        // isGroundedEvidenceWithFileCheck can never mark reference as
        // GROUNDED when activeTenderFileIds is enforced.
        contactDetails["procurementReferenceNumber"] = {
          page: provenPage,
          quote: extraction.sourceQuote,
          fileId: durableFileId,
        };
      }
    }
    // ── PERSIST CANONICAL SOURCE EVIDENCE ───────────────────────────
    // Write the source-evidence columns (fileId, page, quote) for critical
    // fields UNCONDITIONALLY — even when provenPage is null. The old
    // conditional write left stale pages on the row when a re-extraction
    // ungrounded a field. Writing null clears the stale value.
    if (evidenceCols && durableFileId) {
      (updates as Record<string, unknown>)[evidenceCols.fileId] = durableFileId;
      (updates as Record<string, unknown>)[evidenceCols.page] = provenPage;
      (updates as Record<string, unknown>)[evidenceCols.quote] = extraction.sourceQuote;
      // Dedicated referenceSourcePage column (written unconditionally so a
      // null provenPage clears stale state).
      if (field === "reference") {
        (updates as Record<string, unknown>).referenceSourcePage = provenPage;
      }
    }

    results[field] = { status: "REPAIRED", sourceFile: extraction.sourceFile, sourcePage: provenPage, sourceQuote: extraction.sourceQuote, confidence: extraction.confidence, value: fieldData.value };
    await logAction({
      userId: actor.id,
      action: "TENDER_METADATA_REPAIRED",
      entityType: "Tender",
      entityId: tenderId,
      description: `${actor.email} repaired ${field}`.slice(0, 500),
      metadata: {
        tenderId,
        field,
        sourceFile: extraction.sourceFile,
        confidence: extraction.confidence,
        sourceQuote: extraction.sourceQuote,
        extractionSource: "DETERMINISTIC_SOURCE_EXTRACTOR",
      },
      requestId,
    });
  }

  if (Object.keys(contactDetails).length > 0) {
    updates.contactDetailsSourceJson = JSON.stringify(contactDetails);
  }

  if (Object.keys(updates).length > 0) {
    await prisma.tender.update({ where: { id: tenderId }, data: updates });
  }

  return NextResponse.json({
    success: Object.keys(updates).length > 0,
    repaired: Object.keys(updates),
    results,
    // outcomesByField is an alias for results — the DB-integration tests
    // (release-blockers-integration.test.ts) assert body.outcomesByField
    // to verify per-field repair outcomes. Both keys return the same object
    // so both the UI (results) and tests (outcomesByField) work.
    outcomesByField: results,
  });
}
