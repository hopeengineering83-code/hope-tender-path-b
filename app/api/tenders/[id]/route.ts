import crypto from "node:crypto";
import { logger } from "../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { getStorageAdapter } from "../../../../lib/storage";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { parseTenderStatus } from "../../../../lib/tender-workflow";
import { prepareDashboardGeneratedDocuments } from "../../../../lib/dashboard-generated-documents";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../lib/rate-limit";
import { getLatestAnalyzeCheckpointProgress } from "../../../../lib/ai-analyze-checkpoints";
import { detectMetadataContamination } from "../../../../lib/engine/tender-metadata-completeness";
import { getCachedPartialJobInfo, setCachedPartialJobInfo, invalidateDashboardCache } from "../../../../lib/dashboard-cache";
import { Prisma } from "@prisma/client";
import { executeTenderDeletion } from "../../../../lib/tender/delete-tender";
import { processTenderStorageCleanupTask } from "../../../../lib/tender/tender-storage-cleanup-task";
import { buildPublicReadinessEnvelope } from "../../../../lib/engine/public-readiness-envelope";

function withDashboardGeneratedDocuments<T extends { generatedDocuments: any[] }>(tender: T): T {
  const prepared = prepareDashboardGeneratedDocuments(tender.generatedDocuments);
  return { ...tender, generatedDocuments: prepared.documents };
}

async function withDashboardFileMetrics<T extends { id: string; files: any[] }>(tender: T): Promise<T> {
  const fileTextMetrics = await prisma.$queryRaw<Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean; fileContentLength: number }>>`
    SELECT
      id,
      COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength",
      COALESCE("extractedText" LIKE '[Scanned%', false) AS "isScannedPlaceholder",
      ("fileContent" IS NOT NULL)::int AS "fileContentLength"
    FROM "TenderFile"
    WHERE "tenderId" = ${tender.id}
  `.catch(() => [] as Array<{ id: string; extractedTextLength: number; isScannedPlaceholder: boolean; fileContentLength: number }>);
  const metricById = new Map(fileTextMetrics.map((file) => [file.id, file]));
  return {
    ...tender,
    files: tender.files.map((file) => {
      const metric = metricById.get(file.id);
      return {
        ...file,
        extractedTextLength: metric?.extractedTextLength ?? 0,
        isScannedPlaceholder: metric?.isScannedPlaceholder ?? false,
        hasInlineFileContent: (metric?.fileContentLength ?? 0) > 0,
      };
    }),
  };
}

async function withDashboardGeneratedDocumentMetrics<T extends { generatedDocuments: any[] }>(tender: T): Promise<T> {
  const ids = tender.generatedDocuments.map((doc) => doc.id);
  const generatedContentMetrics = ids.length > 0
    ? await prisma.$queryRaw<Array<{ id: string; fileContentLength: number }>>`
        SELECT id, ("fileContent" IS NOT NULL)::int AS "fileContentLength"
        FROM "GeneratedDocument"
        WHERE id = ANY(${ids}::text[])
      `.catch(() => [] as Array<{ id: string; fileContentLength: number }>)
    : [];
  const metricById = new Map(generatedContentMetrics.map((doc) => [doc.id, doc.fileContentLength]));
  return {
    ...tender,
    generatedDocuments: tender.generatedDocuments.map((doc) => ({
      ...doc,
      hasInlineFileContent: (metricById.get(doc.id) ?? 0) > 0,
    })),
  };
}

function withDashboardPayload<T extends { id: string; files: any[]; generatedDocuments: any[] }>(tender: T): Promise<T> {
  return withDashboardFileMetrics(withDashboardGeneratedDocuments(tender)).then(withDashboardGeneratedDocumentMetrics);
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
  storagePath: true,
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
  clientNameSourcePage: true, clientNameSourceQuote: true, clientNameSourceFileId: true,
  titleSourcePage: true, titleSourceQuote: true, titleSourceFileId: true,
  deadlineSourcePage: true, deadlineSourceQuote: true, deadlineSourceFileId: true,
  // Reference source evidence — dedicated columns read first by the canonical
  // resolver's getSourceEvidence for fieldKey="reference". Without these, the
  // dashboard payload diverges from the strict BuildPlan validator's view.
  referenceSourcePage: true, referenceSourceQuote: true, referenceSourceFileId: true,
  submissionMethodSourcePage: true, submissionMethodSourceQuote: true, submissionMethodSourceFileId: true,
  submissionAddressSourcePage: true, submissionAddressSourceQuote: true, submissionAddressSourceFileId: true,
  submissionEmailSourcePage: true, submissionEmailSourceFileId: true, submissionEmailSourceQuote: true,
  contactDetailsSourceJson: true,
  evaluationCriteriaSourceJson: true, analysisExtractionStatus: true, clientCity: true, clientWebsite: true, submissionEmailSubject: true,
  preBidChannel: true, clientRepresentative: true, createdAt: true, updatedAt: true,
  readinessScore: true, bidOutcome: true,
  files: {
    orderBy: { createdAt: "desc" as const },
    select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, deletionStatus: true, storagePath: true, createdAt: true },
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
    const requiredDocumentsTotal = Math.max(payload.requirements.length, payload.generatedDocuments.filter((doc: any) => (doc.generationStatus ?? "").toUpperCase() === "PLANNED").length);
    const generatedDocumentsTotal = payload.generatedDocuments.filter((doc: any) => (doc.generationStatus ?? "").toUpperCase() === "GENERATED").length;
    const exportReadyDocumentsTotal = payload.generatedDocuments.filter((doc: any) => (doc.generationStatus ?? "").toUpperCase() === "GENERATED" && /READY_FOR_EXPORT|APPROVED/i.test(doc.reviewStatus ?? "")).length;
    const detailBlockers = requiredDocumentsTotal > 0 && exportReadyDocumentsTotal < requiredDocumentsTotal
      ? [{ code: "REQUIRED_DOCUMENTS_NOT_EXPORT_READY", message: `${exportReadyDocumentsTotal}/${requiredDocumentsTotal} required documents are export-ready.`, nextAction: "Open export readiness." }]
      : [];
    const envelope = buildPublicReadinessEnvelope({
      ok: detailBlockers.length === 0,
      blockers: detailBlockers,
      warnings: [],
      requiredDocumentsTotal,
      generatedDocumentsTotal,
      exportReadyDocumentsTotal,
    });
    return NextResponse.json({
      ...envelope,
      ...payload,
      latestPartialAnalysisJob: partialJobInfo,
      aiAnalyzeCheckpointProgress,
    });
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
  // Generate correlationId up front so it's available for both success and error logs/responses.
  const correlationId = crypto.randomUUID().slice(0, 8);

  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const existing = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  logger.info(`[tender-delete] Starting deletion`, { tenderId, correlationId, userId: actor.id, title: existing.title });

  try {
    // Comprehensive ordered deletion within a transaction.
    //
    // Ordering rationale:
    //  - Children of GeneratedDocument (DocumentReview, DocumentComment) must die first.
    //  - ComplianceMatrix must die before TenderRequirement (FK).
    //  - CostLine must die before PricingWorkbook (FK).
    //  - AiJobStep / AiAnalyzeChunk / AiAnalyzeRetryState must die before AiJob (FK).
    //  - FallbackApprovalRecord & ExtractionQualityOverride are scalar-only (no @relation,
    //    no FK constraint — see migration 20260622193000) so they would survive Tender
    //    deletion as orphans. We DELETE them here for hygiene (tender-specific operational
    //    state should not persist after the tender is gone).
    //  - AiUsageRecord has a SetNull relation. Migration 20260628000000_add_aiusagerecord_tender_fk
    //    added the FK constraint; typed Prisma updateMany now works without raw SQL.
    const result = await prisma.$transaction(
      async (tx) => executeTenderDeletion(
        tx,
        tenderId,
        correlationId,
        actor.id,
      ),
      { timeout: 30000, isolationLevel: "Serializable" },
    );

    // The cleanup pointer was committed inside the deletion transaction.
    // All external blob cleanup is handled exclusively through the durable
    // manifest via processTenderStorageCleanupTask. This prevents orphaned
    // blobs if the process crashes between the transaction commit and a
    // direct deleteFile call. Failed objects remain in the durable AuditLog
    // manifest for cron-based retry.
    let storageCleanupPending = false;
    if (result.storageCleanupTaskId) {
      try {
        const cleanup = await processTenderStorageCleanupTask({
          prisma,
          storage: getStorageAdapter(),
          taskId: result.storageCleanupTaskId,
        });
        storageCleanupPending = !cleanup.completed;
      } catch (cleanupError) {
        storageCleanupPending = true;
        logger.warn("[tender-delete] immediate storage cleanup deferred", {
          tenderId,
          correlationId,
          errorClass: cleanupError instanceof Error
            ? cleanupError.constructor.name
            : "UnknownError",
        });
      }
    }

    await logAction({
      userId: actor.id,
      action: "TENDER_DELETE",
      entityType: "Tender",
      entityId: tenderId,
      description: `Tender "${existing.title}" permanently deleted`,
      metadata: { tenderId, title: existing.title, clientName: existing.clientName, correlationId },
    });

    logger.info(`[tender-delete] Deletion complete`, { tenderId, correlationId });
    return NextResponse.json({ success: true, correlationId, storageCleanupPending });
  } catch (error) {
    const errorClass =
      error instanceof Prisma.PrismaClientKnownRequestError ? `PrismaError(${error.code})` :
      error instanceof Error ? error.constructor.name : "UnknownError";
    // Pass the raw error object to logger — never leak its message/string in the
    // HTTP response. The response only contains a correlationId the operator can
    // use to look up this log entry.
    logger.error("Tender deletion failed", { detail: error, tenderId, correlationId, errorClass });

    return NextResponse.json({
      error: "Failed to delete tender",
      code: "TENDER_DELETE_FAILED",
      correlationId,
    }, { status: 500 });
  }
}
