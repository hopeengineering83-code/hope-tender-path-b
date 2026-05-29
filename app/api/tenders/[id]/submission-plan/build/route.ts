// POST /api/tenders/[id]/submission-plan/build
//
// Builds and persists a submission plan for the given tender.
// Creates GeneratedDocument rows (status=PLANNED) for each planned file
// that does not already have a matching row. Never overwrites rows that
// have already been generated (generationStatus !== "PLANNED").
//
// Auth: ADMIN or PROPOSAL_MANAGER. User-scoped tender query.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../../../../../../lib/engine/submission-plan";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`submission-plan-build:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id } = await params;

  try {
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        id: true,
        title: true,
        exactFileNaming: true,
        exactFileOrder: true,
        pageLimit: true,
        requirements: {
          select: {
            id: true,
            title: true,
            description: true,
            requirementType: true,
            priority: true,
            exactFileName: true,
            exactOrder: true,
            requiredQuantity: true,
            pageLimit: true,
            restrictions: true,
            sectionReference: true,
          },
        },
        generatedDocuments: {
          select: {
            id: true,
            exactFileName: true,
            name: true,
            generationStatus: true,
          },
        },
      },
    });

    if (!tender) {
      return NextResponse.json({ ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
    }

    if (tender.requirements.length === 0) {
      return NextResponse.json({ ok: false, error: "Tender has no requirements — run AI Analyze first.", code: "NO_REQUIREMENTS" }, { status: 422 });
    }

    const plan = buildSubmissionPlan(tender);
    const plannedFiles = plannedSubmissionTargetFiles(plan);

    // Build a set of already-existing exactFileNames (case-insensitive)
    const existingKeys = new Set(
      tender.generatedDocuments
        .map((doc) => (doc.exactFileName ?? doc.name ?? "").toLowerCase())
        .filter(Boolean),
    );

    let created = 0;
    let skipped = 0;
    const fileStatuses: { exactFileName: string; status: "created" | "skipped" }[] = [];

    for (const file of plannedFiles) {
      const key = file.exactFileName.toLowerCase();
      if (existingKeys.has(key)) {
        skipped++;
        fileStatuses.push({ exactFileName: file.exactFileName, status: "skipped" });
        continue;
      }

      await prisma.generatedDocument.create({
        data: {
          tenderId: id,
          name: file.exactFileName,
          exactFileName: file.exactFileName,
          exactOrder: file.exactOrder,
          documentType: file.documentType ?? "TECHNICAL_PROPOSAL",
          generationStatus: "PLANNED",
          reviewStatus: "PENDING",
          validationStatus: "PENDING",
        },
      });
      existingKeys.add(key);
      created++;
      fileStatuses.push({ exactFileName: file.exactFileName, status: "created" });
    }

    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_BUILT",
      entityType: "Tender",
      entityId: id,
      description: `Submission plan built for tender "${tender.title}" — ${created} created, ${skipped} skipped, ${plannedFiles.length} total planned files`,
      metadata: { created, skipped, total: plannedFiles.length },
    });

    return NextResponse.json({
      ok: true,
      created,
      skipped,
      total: plannedFiles.length,
      files: fileStatuses,
    });
  } catch (error) {
    console.error("[submission-plan/build] error:", error);
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
