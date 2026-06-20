// POST /api/tenders/[id]/ai-analyze/jobs
//
// Creates a durable AI Analyze job for a tender. Validates extraction
// readiness, calculates the source content hash, creates/reuses a resumable
// job + chunk records, and returns the jobId.
//
// Does NOT analyze any chunks — that's done by POST /api/ai-jobs/[jobId]/run-next.
//
// Auth: ADMIN or PROPOSAL_MANAGER (tenant-scoped via actor.id).

import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { createAnalyzeJob } from "../../../../../../lib/ai-jobs/durable-analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 10; // Job creation is fast — 10s is plenty.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;

  // Tenant-scoped tender lookup — never use an unscoped findFirst.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: {
      id: true, title: true, description: true, intakeSummary: true,
      files: { select: { id: true, fileName: true, extractedText: true, classification: true } },
    },
  });

  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  // Validate extraction readiness — at least one file must have extracted text.
  const filesWithText = tender.files.filter((f) => f.extractedText && f.extractedText.trim().length > 20);
  if (filesWithText.length === 0) {
    return NextResponse.json({
      error: "Extraction not ready. Upload tender files and wait for extraction to complete.",
      code: "EXTRACTION_NOT_READY",
      nextAction: "UPLOAD_TENDER_SOURCE",
    }, { status: 422 });
  }

  // Build tender content (same logic as the existing AI Analyze route).
  const fileTexts = tender.files
    .map((f) => f.extractedText
      ? `[FILE: ${f.fileName}]\n${f.extractedText.slice(0, 12_000)}`
      : `[FILE: ${f.fileName}] ${f.classification ?? ""}`)
    .join("\n\n");

  const tenderContent = [
    `TENDER: ${tender.title}`,
    tender.description ? `DESCRIPTION: ${tender.description.slice(0, 2_000)}` : null,
    tender.intakeSummary ? `INTAKE NOTES: ${tender.intakeSummary.slice(0, 2_000)}` : null,
    fileTexts || null,
  ].filter(Boolean).join("\n\n").slice(0, 300_000);

  if (tenderContent.trim().length === 0) {
    return NextResponse.json({
      error: "Tender content is empty after extraction.",
      code: "EMPTY_CONTENT",
    }, { status: 422 });
  }

  // Parse the force flag from the request body.
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const force = body.force === true;

  try {
    const result = await createAnalyzeJob(tenderId, actor.id, tenderContent, { force });
    return NextResponse.json({
      ok: true,
      jobId: result.jobId,
      totalChunks: result.totalChunks,
      state: result.state,
      contentHash: result.contentHash,
      nextAction: result.nextAction,
      runNextEndpoint: `/api/ai-jobs/${result.jobId}/run-next`,
      finalizeEndpoint: `/api/ai-jobs/${result.jobId}/finalize`,
      statusEndpoint: `/api/ai-jobs/${result.jobId}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, code: "JOB_CREATION_FAILED" }, { status: 500 });
  }
}
