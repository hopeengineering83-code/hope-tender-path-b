import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { parseTenderStatus } from "../../../../lib/tender-workflow";
import { prepareDashboardGeneratedDocuments } from "../../../../lib/dashboard-generated-documents";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { getLatestAnalyzeCheckpointProgress } from "../../../../lib/ai-analyze-checkpoints";
import { detectMetadataContamination } from "../../../../lib/engine/tender-metadata-completeness";
import { getCachedPartialJobInfo, setCachedPartialJobInfo, invalidateDashboardCache } from "../../../../lib/dashboard-cache";

function withDashboardGeneratedDocuments<T extends { generatedDocuments: any[] }>(tender: T): T {
  const prepared = prepareDashboardGeneratedDocuments(tender.generatedDocuments);
  return { ...tender, generatedDocuments: prepared.documents };
}

async function withDashboardFileMetrics<T extends { id: string; files: any[] }>(tender: T): Promise<T> {
  const fileTextMetrics = await prisma.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>>`
    SELECT
      id,
      COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength",
      COALESCE("extractedText" LIKE '[Scanned%', false) AS "isScannedPlaceholder"
    FROM "TenderFile"
    WHERE "tenderId" = ${tender.id}
  `.catch(() => [] as Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean }>);
  const metricById = new Map(fileTextMetrics.map((file) => [file.id, file]));
  return {
    ...tender,
    files: tender.files.map((file) => {
      const metric = metricById.get(file.id);
      return {
        ...file,
        extractedTextLength: metric?.extractedTextLength ?? 0,
        isScannedPlaceholder: metric?.isScannedPlaceholder ?? false,
      };
    }),
  };
}

function withDashboardPayload<T extends { id: string; files: any[]; generatedDocuments: any[] }>(tender: T): Promise<T> {
  return withDashboardFileMetrics(withDashboardGeneratedDocuments(tender));
}

const generatedDocumentOrder = [
  { exactOrder: "asc" as const },
  { createdAt: "desc" as const },
];

const generatedDocumentDashboardSelect = {
  id: true,
  name: true,
  documentType: true,
  generationStatus: true,
  validationStatus: true,
  reviewStatus: true,
  reviewNotes: true,
  exactFileName: true,
  exactOrder: true,
  contentSummary: true,
  reviewedExpertCount: true,
  draftExpertCount: true,
  reviewedProjectCount: true,
  draftProjectCount: true,
};

const TENDER_DASHBOARD_SELECT = {
  id: true, title: true, description: true, reference: true, clientName: true, category: true, country: true, budget: true, currency: true,
  deadline: true, submissionMethod: true, submissionAddress: true, status: true, stage: true, intakeSummary: true, analysisSummary: true,
  evaluationMethodology: true, notes: true, clientContactName: true, clientContactTitle: true, clientContactEmail: true, clientContactPhone: true,
  clientAddress: true, submissionEmails: true, validityDays: true, bidBondAmount: true, bidBondCurrency: true, preBidMeetingDate: true,
  preBidMeetingLocation: true, mandatorySiteVisit: true, numberOfCopiesRequired: true, technicalWeight: true, financialWeight: true,
  procuringEntityName: true, legalClientName: true, donorAgency: true, implementingAgency: true, metadataContaminated: true,
  clientNameSourcePage: true, clientNameSourceQuote: true, submissionEmailSourcePage: true, contactDetailsSourceJson: true,
  submissionMethodSourcePage: true, submissionMethodSourceQuote: true, submissionAddressSourcePage: true, submissionAddressSourceQuote: true,
  evaluationCriteriaSourceJson: true, analysisExtractionStatus: true, clientCity: true, clientWebsite: true, submissionEmailSubject: true,
  preBidChannel: true, clientRepresentative: true, createdAt: true, updatedAt: true,
  readinessScore: true, bidOutcome: true,
  files: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true },
  },
  requirements: { orderBy: { createdAt: "asc" as const }, select: { id: true, title: true, description: true, requirementType: true, priority: true, sourceConfidence: true, sourcePageNumber: true, sourceExactQuote: true, sourceTenderFileId: true, exactFileName: true, sectionReference: true, createdAt: true, updatedAt: true } },
  complianceGaps: { orderBy: { createdAt: "desc" as const }, select: { id: true, tenderId: true, title: true, description: true, severity: true, mitigationPlan: true, isResolved: true, resolvedNote: true, createdAt: true, updatedAt: true } },
  generatedDocuments: { orderBy: generatedDocumentOrder, select: generatedDocumentDashboardSelect },
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  try {
    const tender = await prisma.tender.findFirst({
      where: { id, userId },
      select: TENDER_DASHBOARD_SELECT,
    });

    if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Surface the latest resumable analysis job so the UI can show a
    // "Resume analysis" banner and pre-wire the continue flow on page load.
    // Failed AI_ANALYZE jobs can still be resumable when their output preserved
    // successful chunkResults before a timeout/provider failure triggered regex fallback.
    let partialJobInfo: { jobId: string; completedChunks: number; totalChunks: number } | null = null;

    // Check cache first (10-second TTL prevents N+1 queries on dashboard reloads)
    const cached = getCachedPartialJobInfo(id, userId);
    if (cached) {
      partialJobInfo = cached;
    } else {
      // Cache miss: query database and cache result
      const latestPartialJobCandidates = await prisma.aiJob.findMany({
        where: { tenderId: id, userId, jobType: "AI_ANALYZE", status: { in: ["PARTIAL_SUCCESS", "FAILED"] } },
        orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
        take: 10,
        select: { id: true, output: true },
      }).catch(() => []);

      for (const candidate of latestPartialJobCandidates) {
        try {
          const out = JSON.parse(candidate.output ?? "{}") as { completedChunks?: number; totalChunks?: number; chunkResults?: unknown[] };
          const completedChunks = typeof out.completedChunks === "number" ? out.completedChunks : (Array.isArray(out.chunkResults) ? out.chunkResults.length : 0);
          if (completedChunks <= 0) continue;
          partialJobInfo = {
            jobId: candidate.id,
            completedChunks,
            totalChunks: out.totalChunks ?? 0,
          };
          // Cache the result for 10 seconds
          setCachedPartialJobInfo(id, userId, partialJobInfo.jobId, partialJobInfo.completedChunks, partialJobInfo.totalChunks);
          break;
        } catch { /* ignore */ }
      }
    }

    const aiAnalyzeCheckpointProgress = await getLatestAnalyzeCheckpointProgress(id, userId).catch(() => null);
    const payload = await withDashboardPayload(tender as any);
    return NextResponse.json({ ...payload, latestPartialAnalysisJob: partialJobInfo, aiAnalyzeCheckpointProgress });
  } catch (error) {
    logger.error("[GET /api/tenders/[id]] failed:", { detail: error });
    return NextResponse.json({ error: "Failed to load tender" }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = rateLimit(`tender-update:${userId}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id } = await params;
  const existing = await prisma.tender.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    if (body.budget !== undefined && body.budget !== null) {
      const parsedBudget = parseFloat(body.budget);
      if (!Number.isFinite(parsedBudget) || parsedBudget < 0 || parsedBudget > 1e12) {
        return NextResponse.json({ error: "budget must be a finite number between 0 and 1,000,000,000,000" }, { status: 400 });
      }
    }
    const status = parseTenderStatus(body.status);

    const prevStatus = existing.status;

    // When the user manually provides a new clientName, re-evaluate the
    // contamination flag so a valid correction clears the generation block.
    const newClientName = body.clientName ?? existing.clientName;
    const metadataContaminatedOverride =
      body.clientName != null && body.clientName !== existing.clientName
        ? detectMetadataContamination(newClientName).contaminated
        : undefined;

    const tender = await prisma.tender.update({
      where: { id },
      data: {
        title: body.title ?? existing.title,
        description: body.description ?? existing.description,
        reference: body.reference ?? existing.reference,
        clientName: newClientName,
        ...(metadataContaminatedOverride !== undefined ? { metadataContaminated: metadataContaminatedOverride } : {}),
        category: body.category ?? existing.category,
        budget:
          body.budget !== undefined
            ? body.budget
              ? parseFloat(body.budget)
              : null
            : existing.budget,
        currency: body.currency ?? existing.currency,
        deadline:
          body.deadline !== undefined
            ? body.deadline
              ? new Date(body.deadline)
              : null
            : existing.deadline,
        submissionMethod: body.submissionMethod ?? existing.submissionMethod,
        submissionAddress: body.submissionAddress ?? existing.submissionAddress,
        intakeSummary: body.intakeSummary ?? existing.intakeSummary,
        analysisSummary: body.analysisSummary ?? existing.analysisSummary,
        evaluationMethodology: body.evaluationMethodology ?? existing.evaluationMethodology,
        notes: body.notes ?? existing.notes,
        status: status ?? existing.status,
        updatedAt: new Date(),
      },
      select: TENDER_DASHBOARD_SELECT,
    });

    await logAction({
      userId,
      action: "TENDER_UPDATE",
      entityType: "Tender",
      entityId: id,
      description: `Tender "${tender.title}" updated${status && status !== prevStatus ? ` (status: ${prevStatus} → ${status})` : ""}`,
      metadata: { tenderId: id, prevStatus, newStatus: status ?? prevStatus },
    });

    // Record a MANUAL_CONFIRMED audit entry when the user provided a NEW
    // value for one of the critical metadata fields. The metadata-repair
    // endpoint and the AI-extracted analysis are the only other sources for
    // these fields; logging a manual confirmation lets later panels show
    // "this field was set by <user> on <date>" instead of "AI-extracted".
    const MANUAL_FIELDS = [
      ["clientName", existing.clientName, tender.clientName],
      ["reference", existing.reference, tender.reference],
      ["submissionMethod", existing.submissionMethod, tender.submissionMethod],
      ["submissionAddress", existing.submissionAddress, tender.submissionAddress],
      ["deadline", existing.deadline?.toISOString() ?? null, (tender.deadline as Date | null)?.toISOString() ?? null],
      ["evaluationMethodology", existing.evaluationMethodology, tender.evaluationMethodology],
    ] as const;
    const manuallySet = MANUAL_FIELDS
      .filter(([field, before, after]) => body[field] !== undefined && (after ?? "") !== (before ?? ""))
      .map(([field]) => field);
    if (manuallySet.length > 0) {
      await logAction({
        userId,
        action: "TENDER_METADATA_MANUAL_CONFIRMED",
        entityType: "Tender",
        entityId: id,
        description: `${manuallySet.length} critical metadata field(s) manually confirmed: ${manuallySet.join(", ")}`,
        metadata: { tenderId: id, fields: manuallySet, source: "MANUAL_CONFIRMED" },
      });
    }

    // Invalidate dashboard cache when tender is updated
    invalidateDashboardCache(id);

    return NextResponse.json(await withDashboardPayload(tender as any));
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to update tender" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const existing = await prisma.tender.findFirst({ where: { id, userId: actor.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Comprehensive ordered deletion in a transaction to avoid P2003
    // foreign-key errors. The Prisma schema declares onDelete: Cascade on
    // all child models, but production databases may have schema drift
    // (missing cascade constraints) that causes P2003 on the parent delete.
    //
    // We explicitly delete ALL 16 child models that have a tenderId FK,
    // plus their nested children, in dependency order. Each delete is
    // wrapped in .catch() with logging so a missing table (schema drift)
    // doesn't abort the entire transaction — the parent delete will still
    // succeed if the cascade constraint IS present.
    await prisma.$transaction(async (tx) => {
      // ── Layer 1: GeneratedDocument and its children ──────────────
      const generatedDocs = await tx.generatedDocument.findMany({
        where: { tenderId: id },
        select: { id: true },
      });
      if (generatedDocs.length > 0) {
        const docIds = generatedDocs.map((d: { id: string }) => d.id);
        // Delete document children first (reviews, comments, evidence)
        await tx.documentReview.deleteMany({ where: { documentId: { in: docIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] documentReview cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.documentComment.deleteMany({ where: { documentId: { in: docIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] documentComment cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.generatedDocument.deleteMany({ where: { tenderId: id } });
      }

      // ── Layer 2: ProposalVersion (child of Tender, may have its own children) ──
      await tx.proposalVersion.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] proposalVersion cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });

      // ── Layer 3: ExportPackage ───────────────────────────────────
      await tx.exportPackage.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] exportPackage cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });

      // ── Layer 4: AI jobs and their children ──────────────────────
      const aiJobs = await tx.aiJob.findMany({
        where: { tenderId: id },
        select: { id: true },
      });
      if (aiJobs.length > 0) {
        const jobIds = aiJobs.map((j: { id: string }) => j.id);
        await tx.aiAnalyzeChunk.deleteMany({ where: { jobId: { in: jobIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] aiAnalyzeChunk cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.aiAnalyzeRetryState.deleteMany({ where: { jobId: { in: jobIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] aiAnalyzeRetryState cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.aiJobStep.deleteMany({ where: { jobId: { in: jobIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] aiJobStep cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.aiJob.deleteMany({ where: { tenderId: id } });
      }

      // ── Layer 5: ComplianceMatrix (references TenderRequirement) ──
      // Must delete before TenderRequirement
      await tx.complianceMatrix.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] complianceMatrix cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });

      // ── Layer 6: PricingWorkbook and CostLine ────────────────────
      const pricingWorkbooks = await tx.pricingWorkbook.findMany({
        where: { tenderId: id },
        select: { id: true },
      });
      if (pricingWorkbooks.length > 0) {
        const workbookIds = pricingWorkbooks.map((w: { id: string }) => w.id);
        await tx.costLine.deleteMany({ where: { workbookId: { in: workbookIds } } }).catch((e: unknown) => {
          console.error(`[tender-delete] costLine cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await tx.pricingWorkbook.deleteMany({ where: { tenderId: id } });
      }

      // ── Layer 7: Remaining tender children ───────────────────────
      await tx.tenderRequirement.deleteMany({ where: { tenderId: id } });
      await tx.tenderFile.deleteMany({ where: { tenderId: id } });
      await tx.complianceGap.deleteMany({ where: { tenderId: id } });
      await tx.tenderExpertMatch.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] tenderExpertMatch cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.tenderProjectMatch.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] tenderProjectMatch cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.matchScoreBreakdown.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] matchScoreBreakdown cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.evaluatorObjection.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] evaluatorObjection cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.sectionEvidenceMap.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] sectionEvidenceMap cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.tenderMetadataOverride.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] tenderMetadataOverride cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.submissionPlanState.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] submissionPlanState cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.tenderShare.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] tenderShare cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });
      await tx.tenderCopilotMessage.deleteMany({ where: { tenderId: id } }).catch((e: unknown) => {
        console.error(`[tender-delete] tenderCopilotMessage cleanup failed for tender ${id}: ${e instanceof Error ? e.message : String(e)}`);
      });

      // ── Layer 8: AI analysis checkpoints (raw SQL — table may not exist) ──
      try {
        await tx.$executeRawUnsafe('DELETE FROM "AiAnalysisCheckpoint" WHERE "tenderId" = $1', id);
      } catch (cleanupErr) {
        console.warn(`[tender-delete] AiAnalysisCheckpoint table not cleaned for tender ${id}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
      }

      // ── Layer 9: Finally delete the tender itself ────────────────
      await tx.tender.delete({ where: { id } });
    }, {
      timeout: 30000,
      isolationLevel: "Serializable",
    });

    await logAction({
      userId: actor.id,
      action: "TENDER_DELETE",
      entityType: "Tender",
      entityId: id,
      description: `Tender "${existing.title}" permanently deleted`,
      metadata: { tenderId: id, title: existing.title, clientName: existing.clientName },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const correlationId = require("crypto").randomUUID().slice(0, 8);
    logger.error("Tender deletion failed", { detail: error, tenderId: id, correlationId });
    return NextResponse.json(
      { error: "Failed to delete tender", code: "TENDER_DELETE_FAILED", correlationId },
      { status: 500 }
    );
  }
}
