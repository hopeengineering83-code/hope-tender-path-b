// POST /api/tenders/[id]/repair-metadata
//
// Multi-field deterministic source extractor repair route.
// This route uses the regex-only fallback framework in lib/engine/tender-field-extractors.ts
// to repair or fill missing tender metadata fields from the uploaded source files.
// It NEVER paraphrases or fuzzes; it only captures verbatim strings with source grounding.
//
// Safety:
//   • uses requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"),
//   • rate-limited per user,
//   • when the extractor returns found: false, the tender row is not touched,
//   • every successful repair writes an audit log entry with sourceFile and sourceQuote.

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

export const dynamic = "force-dynamic";

const SUPPORTED_FIELDS = ["evaluationMethodology", ...SUPPORTED_EXTRACTORS] as const;
type SupportedField = (typeof SUPPORTED_FIELDS)[number];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
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
    include: { files: { select: { fileName: true, extractedText: true } } },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  if (!tender.files || tender.files.length === 0) {
    return NextResponse.json({
      error: "No tender files with extracted text are available; upload the tender source file(s) first.",
      code: "NO_TENDER_SOURCE",
      nextAction: "UPLOAD_TENDER_SOURCE",
    }, { status: 422 });
  }

  const results: Record<string, unknown> = {};
  const updates: Record<string, unknown> = {};
  const contactDetailsSource: Record<string, { page: number | null, quote: string | null }> = JSON.parse(tender.contactDetailsSourceJson || "{}");

  const filesInput = { files: tender.files.map((f) => ({ fileName: f.fileName, extractedText: f.extractedText })) };

  // ── evaluationMethodology (Specialized AI/Deterministic extractor) ───
  if (requestedFields.includes("evaluationMethodology")) {
    if (tender.evaluationMethodology && tender.evaluationMethodology.trim().length > 0 && !force) {
      results.evaluationMethodology = { status: "SKIPPED", reason: "Already populated" };
    } else {
      const extraction = extractEvaluationMethodologyFromSource(filesInput);
      if (!extraction.found) {
        results.evaluationMethodology = { status: "NOT_FOUND", reason: extraction.reason };
      } else {
        updates.evaluationMethodology = extraction.methodologyText;
        results.evaluationMethodology = { status: "REPAIRED", ...extraction };
        await logAction({
          userId: actor.id,
          action: "TENDER_METADATA_REPAIRED",
          entityType: "Tender",
          entityId: tenderId,
          description: `${actor.email} repaired evaluationMethodology`.slice(0, 500),
          metadata: { tenderId, field: "evaluationMethodology", ...extraction },
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

    if (field === "bidBondAmount") {
      const v = fieldData.value as { amount: number; currency: string | null };
      if (v.amount > 0 && v.currency !== "PERCENT") {
        updates.bidBondAmount = v.amount;
        if (v.currency) updates.bidBondCurrency = v.currency;
      }
    } else if (field === "deadline" || field === "preBidMeetingDate") {
      updates[field] = fieldData.value;
    } else if (field === "submissionEmails") {
      updates.submissionEmails = (fieldData.value as string[]).join("|");
      updates.submissionEmailSourcePage = fieldData.sourcePage;
    } else {
      const rawValue = fieldData.value;
      if (typeof rawValue === "string" && containsMetadataPlaceholder(rawValue)) {
        results[field] = { status: "REJECTED", reason: "Placeholder detected", value: rawValue };
        continue;
      }
      updates[field] = rawValue;

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
        contactDetailsSource[field] = { page: fieldData.sourcePage, quote: fieldData.sourceQuote };
      } else if (field === "projectTitle") {
        if (!tender.title || tender.title.startsWith("[REVIEW NEEDED]")) updates.title = rawValue;
      } else if (field === "submissionEmailSubject") {
        updates.submissionEmailSubject = rawValue;
      }
    }

    results[field] = { status: "REPAIRED", ...fieldData };
    await logAction({
      userId: actor.id,
      action: "TENDER_METADATA_REPAIRED",
      entityType: "Tender",
      entityId: tenderId,
      description: `${actor.email} repaired ${field}`.slice(0, 500),
      metadata: { tenderId, field, ...fieldData },
      requestId,
    });
  }

  if (Object.keys(contactDetailsSource).length > 0) {
    updates.contactDetailsSourceJson = JSON.stringify(contactDetailsSource);
  }

  if (Object.keys(updates).length > 0) {
    await prisma.tender.update({ where: { id: tenderId }, data: updates });
  }

  return NextResponse.json({
    success: Object.keys(updates).length > 0,
    repaired: Object.keys(updates),
    results,
  });
}
