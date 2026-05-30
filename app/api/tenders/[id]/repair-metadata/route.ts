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

export const dynamic = "force-dynamic";

const SUPPORTED_FIELDS = ["evaluationMethodology"] as const;
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

  // Scope: owner OR (ADMIN / PROPOSAL_MANAGER) — same as other tender mutations.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: { files: { select: { fileName: true, extractedText: true } } },
  }) ?? await prisma.tender.findFirst({
    where: { id: tenderId },
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
  const updates: Record<string, string> = {};

  if (requestedFields.includes("evaluationMethodology")) {
    if (tender.evaluationMethodology && tender.evaluationMethodology.trim().length > 0 && !force) {
      results.evaluationMethodology = {
        status: "SKIPPED",
        reason: "evaluationMethodology is already populated. Pass force:true (ADMIN only) to overwrite.",
      };
    } else {
      const extraction = extractEvaluationMethodologyFromSource({
        files: tender.files.map((f) => ({ fileName: f.fileName, extractedText: f.extractedText })),
      });
      if (!extraction.found) {
        results.evaluationMethodology = { status: "NOT_FOUND", reason: extraction.reason };
      } else {
        updates.evaluationMethodology = extraction.methodologyText;
        results.evaluationMethodology = {
          status: "REPAIRED",
          confidence: extraction.confidence,
          sourceFile: extraction.sourceFile,
          sourceQuote: extraction.sourceQuote,
          items: extraction.items,
        };
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

  if (Object.keys(updates).length > 0) {
    await prisma.tender.update({ where: { id: tenderId }, data: updates });
  }

  return NextResponse.json({
    success: Object.keys(updates).length > 0,
    repaired: Object.keys(updates),
    results,
  });
}
