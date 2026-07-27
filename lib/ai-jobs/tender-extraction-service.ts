import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { recordStep } from "../ai-jobs";
import { logAction } from "../audit";
import { autoFillTenderMetadata } from "../engine/auto-fill-tender-metadata";
import { buildCandidatesFromMetadata } from "../engine/candidate-pipeline";
import { enrichMetadataWithSourceEvidence } from "../engine/metadata-source-enrichment";
import { requireVerifiedPersistedFileBytes } from "../engine/persisted-byte-integrity";
import { assessExtractionQuality, assessExtractionQualityPerPage } from "../extraction-quality";
import { extractTextFromBuffer, isMeaningfulExtraction } from "../extract-text";
import { logger } from "../observability";
import { prisma } from "../prisma";
import { getStorageAdapter } from "../storage";
import {
  parseTenderPackageSessionResult,
  recordTenderPackageAnalysisJob,
  TENDER_PACKAGE_INTAKE_OPERATION,
} from "../tender-package-intake-session";
import { limitExtractedText } from "../upload-security";
import { queueAutomaticTenderPipeline } from "./automatic-tender-pipeline";

export type TenderExtractionJobContext = {
  jobId: string;
  userId: string;
  tenderId: string | null;
  input: Record<string, unknown>;
};

type ExtractionJobDb = Pick<PrismaClient, "aiJob"> | Pick<Prisma.TransactionClient, "aiJob">;

export type EnqueueTenderExtractionInput = {
  userId: string;
  companyId: string;
  tenderId: string;
  tenderFileId: string;
  sourceContentSha256: string;
  intakeSessionId?: string | null;
  deferAnalysis?: boolean;
};

export type ExtractionContinuationResult = {
  queued: boolean;
  reason: string;
  jobId?: string;
  analysisRevision?: string | null;
  reused?: boolean;
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tenderExtractionRunId(input: {
  tenderFileId: string;
  sourceContentSha256: string;
}): string {
  return `extract-text-v1:${input.tenderFileId}:${input.sourceContentSha256.toLowerCase()}`;
}

export async function enqueueTenderFileExtractionJob(
  db: ExtractionJobDb,
  input: EnqueueTenderExtractionInput,
): Promise<{ id: string; status: string; reused: boolean; runId: string }> {
  if (!/^[a-f0-9]{64}$/i.test(input.sourceContentSha256)) {
    throw new Error("EXTRACT_TEXT_SOURCE_HASH_INVALID");
  }

  const runId = tenderExtractionRunId(input);
  const payload = JSON.stringify({
    tenderFileId: input.tenderFileId,
    sourceContentSha256: input.sourceContentSha256.toLowerCase(),
    companyId: input.companyId,
    intakeSessionId: input.intakeSessionId ?? null,
    deferAnalysis: input.deferAnalysis === true,
    purpose: "INITIAL_SOURCE_EXTRACTION",
  });

  const existing = await db.aiJob.findUnique({
    where: { runId },
    select: { id: true, status: true },
  });
  if (existing) return { ...existing, reused: true, runId };

  try {
    const created = await db.aiJob.create({
      data: {
        runId,
        userId: input.userId,
        tenderId: input.tenderId,
        jobType: "EXTRACT_TEXT",
        input: payload,
        analysisInputHash: stableHash(payload),
        status: "QUEUED",
      },
      select: { id: true, status: true },
    });
    return { ...created, reused: false, runId };
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const winner = await db.aiJob.findUnique({
      where: { runId },
      select: { id: true, status: true },
    });
    if (!winner) throw error;
    return { ...winner, reused: true, runId };
  }
}

function extractionMetrics(text: string): {
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number;
  extractionScore: number;
  extractionMethod: "text" | "ocr" | "mixed" | "failed";
  pageStatusJson: string | null;
  ocrModel: string | null;
} {
  const quality = assessExtractionQuality(text);
  const perPage = assessExtractionQualityPerPage(text);
  const totalPages = perPage.totalDetectedPages > 0 ? perPage.totalDetectedPages : null;
  const failedPages = perPage.failedPages.length;
  const extractedPages = totalPages === null ? null : Math.max(0, totalPages - failedPages);
  const ocrPages = perPage.ocrPages.length > 0 ? perPage.ocrPages.length : null;
  const ocrMarker = text.startsWith("[PDF text extracted via Claude vision OCR");
  const failed = !isMeaningfulExtraction(text) || quality.hasExtractionFailure;
  const extractionMethod = failed
    ? "failed"
    : ocrMarker
      ? ocrPages !== null && extractedPages !== null && ocrPages < extractedPages ? "mixed" : "ocr"
      : "text";

  return {
    totalPages,
    extractedPages,
    ocrPages,
    failedPages,
    extractionScore: quality.score,
    extractionMethod,
    pageStatusJson: perPage.pages.length > 0 ? JSON.stringify(perPage.pages) : null,
    ocrModel: ocrMarker || quality.hasOcrPlaceholder ? "claude-vision" : null,
  };
}

async function enrichTenderFromCurrentSources(input: {
  tenderId: string;
  expectedFileId: string;
  expectedContentSha256: string;
  extractedText: string;
  totalPages: number | null;
}): Promise<void> {
  const currentFile = await prisma.tenderFile.findFirst({
    where: {
      id: input.expectedFileId,
      tenderId: input.tenderId,
      contentSha256: input.expectedContentSha256,
      deletionStatus: "ACTIVE",
    },
    select: { id: true },
  });
  if (!currentFile) return;

  const tender = await prisma.tender.findUnique({
    where: { id: input.tenderId },
    select: {
      id: true,
      title: true,
      reference: true,
      clientName: true,
      category: true,
      country: true,
      deadline: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      submissionEmailSubject: true,
      clientContactName: true,
      clientContactTitle: true,
      clientContactEmail: true,
      clientContactPhone: true,
      preBidMeetingDate: true,
      preBidMeetingLocation: true,
      validityDays: true,
      pageLimit: true,
      bidBondAmount: true,
      bidBondCurrency: true,
      numberOfCopiesRequired: true,
      mandatorySiteVisit: true,
      evaluationMethodology: true,
      contactDetailsSourceJson: true,
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: {
          id: true,
          originalFileName: true,
          extractedText: true,
          totalPages: true,
          contentHash: true,
          deletionStatus: true,
        },
      },
    },
  });
  if (!tender) return;

  const files = tender.files.map((file) => file.id === input.expectedFileId
    ? {
        ...file,
        fileName: file.originalFileName,
        extractedText: input.extractedText,
        totalPages: input.totalPages,
      }
    : { ...file, fileName: file.originalFileName });

  await autoFillTenderMetadata({ ...tender, files }, prisma);
  const effectiveTender = await prisma.tender.findUnique({
    where: { id: tender.id },
    select: {
      id: true,
      title: true,
      reference: true,
      clientName: true,
      deadline: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      submissionEmailSubject: true,
      contactDetailsSourceJson: true,
    },
  });
  if (!effectiveTender) return;

  const enrichment = enrichMetadataWithSourceEvidence({
    title: effectiveTender.title,
    reference: effectiveTender.reference,
    clientName: effectiveTender.clientName,
    deadline: effectiveTender.deadline,
    submissionMethod: effectiveTender.submissionMethod,
    submissionAddress: effectiveTender.submissionAddress,
    submissionEmails: effectiveTender.submissionEmails,
    submissionEmailSubject: effectiveTender.submissionEmailSubject,
    existingContactDetailsSourceJson: effectiveTender.contactDetailsSourceJson ?? null,
  }, files);

  const candidatePipeline = buildCandidatesFromMetadata({
    values: {
      title: effectiveTender.title,
      reference: effectiveTender.reference,
      clientName: effectiveTender.clientName,
      deadline: effectiveTender.deadline,
      submissionMethod: effectiveTender.submissionMethod,
      submissionAddress: effectiveTender.submissionAddress,
      submissionEmailSubject: effectiveTender.submissionEmailSubject,
    },
    files,
    candidateType: "regex",
    extractionSourcePrefix: "extract-text-job",
  });

  if (Object.keys(enrichment).length > 0) {
    const sourceStillCurrent = await prisma.tenderFile.count({
      where: {
        id: input.expectedFileId,
        tenderId: input.tenderId,
        contentSha256: input.expectedContentSha256,
        deletionStatus: "ACTIVE",
      },
    });
    if (sourceStillCurrent === 1) {
      await prisma.tender.update({ where: { id: tender.id }, data: enrichment });
    }
  }

  if (candidatePipeline.summary.rejected > 0 || candidatePipeline.summary.needsReview > 0) {
    logger.warn("[extract-text] candidate review required", {
      tenderId: input.tenderId,
      rejected: candidatePipeline.summary.rejected,
      needsReview: candidatePipeline.summary.needsReview,
    });
  }
}

export async function continueTenderPipelineAfterExtraction(input: {
  userId: string;
  tenderId: string;
  companyId: string;
  intakeSessionId?: string | null;
  deferAnalysis?: boolean;
}): Promise<ExtractionContinuationResult> {
  const ownedTender = await prisma.tender.findFirst({
    where: { id: input.tenderId, userId: input.userId },
    select: { id: true },
  });
  if (!ownedTender) return { queued: false, reason: "TENDER_NOT_OWNED" };

  if (input.deferAnalysis && !input.intakeSessionId) {
    return { queued: false, reason: "ANALYSIS_EXPLICITLY_DEFERRED" };
  }

  if (input.intakeSessionId) {
    const sessionRow = await prisma.tenderWorkflowRun.findUnique({
      where: {
        companyId_tenderId_operation_idempotencyKey: {
          companyId: input.companyId,
          tenderId: input.tenderId,
          operation: TENDER_PACKAGE_INTAKE_OPERATION,
          idempotencyKey: input.intakeSessionId,
        },
      },
      select: { status: true, resultJson: true },
    });
    const session = parseTenderPackageSessionResult(sessionRow?.resultJson);
    if (!sessionRow || !session || sessionRow.status !== "SUCCEEDED" || session.missingBatchIndexes.length > 0) {
      return { queued: false, reason: "SOURCE_PACKAGE_INCOMPLETE" };
    }
  }

  const files = await prisma.tenderFile.findMany({
    where: { tenderId: input.tenderId, deletionStatus: "ACTIVE" },
    select: {
      id: true,
      extractedText: true,
      extractionMethod: true,
      integrityStatus: true,
    },
  });
  if (files.length === 0) return { queued: false, reason: "NO_ACTIVE_SOURCE_FILES" };
  if (files.some((file) => file.integrityStatus !== "VERIFIED" || !file.extractionMethod)) {
    return { queued: false, reason: "SOURCE_EXTRACTION_PENDING" };
  }
  if (files.some((file) => file.extractionMethod === "failed" || !isMeaningfulExtraction(file.extractedText ?? ""))) {
    return { queued: false, reason: "SOURCE_EXTRACTION_REVIEW_REQUIRED" };
  }

  const pipeline = await queueAutomaticTenderPipeline({
    tenderId: input.tenderId,
    userId: input.userId,
    companyId: input.companyId,
    source: "secure-upload",
  });
  if (input.intakeSessionId) {
    await recordTenderPackageAnalysisJob({
      prisma,
      companyId: input.companyId,
      tenderId: input.tenderId,
      sessionId: input.intakeSessionId,
      jobId: pipeline.jobId,
      analysisRevision: pipeline.analysisRevision,
    });
  }
  return {
    queued: true,
    reason: "AI_ANALYZE_QUEUED",
    jobId: pipeline.jobId,
    analysisRevision: pipeline.analysisRevision,
  };
}

export async function runTenderFileExtractionJob(
  ctx: TenderExtractionJobContext,
): Promise<Record<string, unknown> | {
  terminalStatus: "SUPERSEDED";
  output: Record<string, unknown>;
  code: string;
  retryable: false;
}> {
  const tenderFileId = typeof ctx.input.tenderFileId === "string" ? ctx.input.tenderFileId : "";
  const expectedHash = typeof ctx.input.sourceContentSha256 === "string"
    ? ctx.input.sourceContentSha256.toLowerCase()
    : "";
  const companyId = typeof ctx.input.companyId === "string" ? ctx.input.companyId : "";
  const intakeSessionId = typeof ctx.input.intakeSessionId === "string" ? ctx.input.intakeSessionId : null;
  const deferAnalysis = ctx.input.deferAnalysis === true;

  if (!ctx.tenderId || !tenderFileId || !companyId || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("EXTRACT_TEXT_INPUT_INVALID");
  }

  await recordStep(ctx.jobId, {
    stepName: "extract.scope",
    message: "Verifying tenant ownership and exact source-byte revision.",
    status: "RUNNING",
  });

  const ownedTender = await prisma.tender.findFirst({
    where: { id: ctx.tenderId, userId: ctx.userId },
    select: { id: true },
  });
  if (!ownedTender) {
    return {
      terminalStatus: "SUPERSEDED",
      code: "EXTRACTION_SCOPE_SUPERSEDED",
      retryable: false,
      output: { reason: "Tender ownership or source scope changed before extraction." },
    };
  }

  const file = await prisma.tenderFile.findFirst({
    where: {
      id: tenderFileId,
      tenderId: ctx.tenderId,
      contentSha256: expectedHash,
      deletionStatus: "ACTIVE",
    },
    select: {
      id: true,
      tenderId: true,
      originalFileName: true,
      mimeType: true,
      storagePath: true,
      fileContent: true,
      contentSha256: true,
      contentByteLength: true,
      contentMimeType: true,
      detectedFormat: true,
      integrityStatus: true,
      updatedAt: true,
      extractedText: true,
      extractionMethod: true,
      totalPages: true,
      extractionScore: true,
    },
  });
  if (!file) {
    return {
      terminalStatus: "SUPERSEDED",
      code: "SOURCE_REVISION_SUPERSEDED",
      retryable: false,
      output: { reason: "The source file revision is no longer current." },
    };
  }

  let extractedText = file.extractedText ?? "";
  let metrics = file.extractionMethod
    ? {
        totalPages: file.totalPages,
        extractedPages: file.totalPages,
        ocrPages: null as number | null,
        failedPages: 0,
        extractionScore: file.extractionScore ?? 0,
        extractionMethod: file.extractionMethod as "text" | "ocr" | "mixed" | "failed",
        pageStatusJson: null as string | null,
        ocrModel: null as string | null,
      }
    : null;

  if (!metrics) {
    await recordStep(ctx.jobId, {
      stepName: "extract.storage-read",
      message: `Reading verified source bytes for ${file.originalFileName}.`,
      status: "RUNNING",
    });
    const buffer = await getStorageAdapter().getFile({
      storagePath: file.storagePath || undefined,
      fileContent: file.fileContent,
      fileName: file.originalFileName,
    });
    requireVerifiedPersistedFileBytes({
      bytes: buffer,
      filename: file.originalFileName,
      claimedMimeType: file.mimeType,
      persisted: file,
    });

    await recordStep(ctx.jobId, {
      stepName: "extract.run",
      message: `Extracting text from ${buffer.length} verified bytes.`,
      status: "RUNNING",
    });
    const limited = limitExtractedText(
      await extractTextFromBuffer(buffer, file.mimeType, file.originalFileName),
    );
    extractedText = limited.text;
    metrics = extractionMetrics(extractedText);

    const persisted = await prisma.tenderFile.updateMany({
      where: {
        id: file.id,
        tenderId: file.tenderId,
        contentSha256: expectedHash,
        deletionStatus: "ACTIVE",
        updatedAt: file.updatedAt,
      },
      data: {
        extractedText: extractedText || null,
        totalPages: metrics!.totalPages,
        extractedPages: metrics!.extractedPages,
        ocrPages: metrics!.ocrPages,
        failedPages: metrics!.failedPages,
        extractionScore: metrics!.extractionScore,
        extractionMethod: metrics!.extractionMethod,
        pageStatusJson: metrics!.pageStatusJson,
        ocrModel: metrics!.ocrModel,
      },
    });
    if (persisted.count !== 1) {
      return {
        terminalStatus: "SUPERSEDED",
        code: "SOURCE_CHANGED_DURING_EXTRACTION",
        retryable: false,
        output: { reason: "The source file changed while extraction was running." },
      };
    }
  } else {
    await recordStep(ctx.jobId, {
      stepName: "extract.resume",
      message: "Reusing the durable file-level extraction checkpoint.",
      status: "RUNNING",
    });
  }

  // After the if-block above, metrics is guaranteed non-null:
  // either it was truthy before, or it was reassigned inside the block.
  if (!metrics) throw new Error("Extraction metrics unavailable");

  try {
    await enrichTenderFromCurrentSources({
      tenderId: ctx.tenderId,
      expectedFileId: file.id,
      expectedContentSha256: expectedHash,
      extractedText,
      totalPages: metrics!.totalPages,
    });
  } catch (error) {
    logger.warn("[extract-text] source enrichment failed after durable extraction", {
      jobId: ctx.jobId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  }

  const continuation = await continueTenderPipelineAfterExtraction({
    userId: ctx.userId,
    tenderId: ctx.tenderId,
    companyId,
    intakeSessionId,
    deferAnalysis,
  });

  await logAction({
    userId: ctx.userId,
    action: "TENDER_FILE_EXTRACTION",
    entityType: "TenderFile",
    entityId: file.id,
    description: "Durable background extraction completed for a verified tender source file.",
    metadata: {
      tenderId: ctx.tenderId,
      sourceContentSha256: expectedHash,
      extractionMethod: metrics!.extractionMethod,
      extractionScore: metrics!.extractionScore,
      totalPages: metrics!.totalPages,
      continuationReason: continuation.reason,
      analysisJobId: continuation.jobId ?? null,
    },
  });

  await recordStep(ctx.jobId, {
    stepName: "extract.complete",
    message: continuation.queued
      ? "Extraction completed and the canonical analysis job was queued."
      : `Extraction completed; continuation state: ${continuation.reason}.`,
    status: "SUCCEEDED",
  });

  return {
    fileId: file.id,
    fileName: file.originalFileName,
    sourceContentSha256: expectedHash,
    textLength: extractedText.length,
    extractionScore: metrics.extractionScore,
    extractionMethod: metrics.extractionMethod,
    totalPages: metrics.totalPages,
    extractionUsable: isMeaningfulExtraction(extractedText) && metrics.extractionMethod !== "failed",
    continuation,
  };
}
