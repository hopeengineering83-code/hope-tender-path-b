/**
 * lib/tender/delete-tender.ts
 *
 * Extracted DELETE transaction body for testability.
 *
 * Uses a transaction-local, server-set deletion context (SET LOCAL GUC)
 * recognized by the guard_canonical_requirement_set_delete trigger.
 *
 * Security properties:
 * - The GUC is set AFTER ownership verification (requireRole + findFirst)
 * - set_config(..., is_local => true) only lasts for the current transaction
 * - Only the specific tenderId is authorized
 * - Direct deletion outside this function remains blocked by the trigger
 * - tenderId is passed as a BOUND PARAMETER (no string interpolation, no
 *   unsafe raw query) and is also validated as a UUID as defense in depth
 * - Every external storage pointer is persisted in a durable cleanup task
 *   inside the same transaction before the tender and its rows disappear
 */

import { Prisma } from "@prisma/client";
import { logger } from "../observability";
import { createTenderStorageCleanupTask } from "./tender-storage-cleanup-task";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function executeTenderDeletion(
  tx: Prisma.TransactionClient,
  tenderId: string,
  correlationId: string,
  actorId: string,
): Promise<{ storageCleanupTaskId: string | null }> {
  const logPhase = (phase: string, model: string) => {
    const msg = `[tender-delete] Phase: ${phase} | Model: ${model}`;
    logger.info(`${msg} | tenderId: ${tenderId} | correlationId: ${correlationId}`);
    logger.info(msg, { phase, model, tenderId, correlationId });
  };

  const wrapDelete = async (modelName: string, op: Promise<unknown>) => {
    logPhase("DELETE", modelName);
    try {
      return await op;
    } catch (e) {
      const errorClass =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? `PrismaError(${e.code})`
          : e instanceof Error
            ? e.constructor.name
            : "UnknownError";
      logger.error(`[tender-delete] ${modelName} deletion failed`, {
        modelName, tenderId, correlationId, errorClass, error: e,
      });
      throw e;
    }
  };

  // Set transaction-local deletion context.
  //
  // The `SET LOCAL` utility statement cannot be parameterized (Postgres parses
  // it via the simple protocol), which previously forced a raw, interpolated
  // unsafe-raw call. The `set_config(name, value, is_local)` *function*
  // is an ordinary expression, so the tenderId is sent as a real bind
  // parameter ($1) — never concatenated into the SQL text. `is_local => true`
  // gives the exact same transaction-local scope as `SET LOCAL`, and the
  // trigger continues to read it via current_setting('app.tender_deletion_context').
  // UUID validation is retained as defense in depth.
  logPhase("SET_CONTEXT", "TransactionGUC");
  if (!UUID_RE.test(tenderId)) {
    throw new Error(`Invalid tenderId format (expected UUID): ${tenderId}`);
  }
  await tx.$executeRaw`SELECT set_config('app.tender_deletion_context', ${tenderId}, true)`;

  // Read every external pointer while the rows are still transactionally
  // available. Database-base64 content is deleted with the row and does not
  // require an external cleanup task.
  const tenderFiles = await tx.tenderFile.findMany({
    where: { tenderId },
    select: {
      storagePath: true,
      originalFileName: true,
    },
  });

  // Layer 1: GeneratedDocument + nested children
  const generatedDocs = await tx.generatedDocument.findMany({
    where: { tenderId },
    select: {
      id: true,
      storagePath: true,
      exactFileName: true,
    },
  });
  if (generatedDocs.length > 0) {
    const docIds = generatedDocs.map((d) => d.id);
    await wrapDelete("DocumentReview", tx.documentReview.deleteMany({ where: { documentId: { in: docIds } } }));
    await wrapDelete("DocumentComment", tx.documentComment.deleteMany({ where: { documentId: { in: docIds } } }));
    await wrapDelete("GeneratedDocument", tx.generatedDocument.deleteMany({ where: { tenderId } }));
  }

  // Layer 2: ProposalVersion, ExportPackage
  await wrapDelete("ProposalVersion", tx.proposalVersion.deleteMany({ where: { tenderId } }));
  await wrapDelete("ExportPackage", tx.exportPackage.deleteMany({ where: { tenderId } }));

  // Layer 3: ComplianceMatrix
  await wrapDelete("ComplianceMatrix", tx.complianceMatrix.deleteMany({ where: { tenderId } }));

  // Layer 4: TenderRequirement (explicit — GUC authorizes via trigger)
  await wrapDelete("TenderRequirement", tx.tenderRequirement.deleteMany({ where: { tenderId } }));

  // Layer 5: AiJob + nested children
  await wrapDelete("AiAnalyzeChunk", tx.aiAnalyzeChunk.deleteMany({ where: { tenderId } }));
  await wrapDelete("AiAnalyzeRetryState", tx.aiAnalyzeRetryState.deleteMany({ where: { tenderId } }));
  const aiJobs = await tx.aiJob.findMany({ where: { tenderId }, select: { id: true } });
  if (aiJobs.length > 0) {
    const jobIds = aiJobs.map((j) => j.id);
    await wrapDelete("AiJobStep", tx.aiJobStep.deleteMany({ where: { jobId: { in: jobIds } } }));
    await wrapDelete("AiJob", tx.aiJob.deleteMany({ where: { tenderId } }));
  }

  // Layer 6: PricingWorkbook + CostLine
  const pricingWorkbooks = await tx.pricingWorkbook.findMany({ where: { tenderId }, select: { id: true } });
  if (pricingWorkbooks.length > 0) {
    const workbookIds = pricingWorkbooks.map((w) => w.id);
    await wrapDelete("CostLine", tx.costLine.deleteMany({ where: { workbookId: { in: workbookIds } } }));
    await wrapDelete("PricingWorkbook", tx.pricingWorkbook.deleteMany({ where: { tenderId } }));
  }

  // Layer 7: Remaining tender-linked operational state
  await wrapDelete("TenderFile", tx.tenderFile.deleteMany({ where: { tenderId } }));
  await wrapDelete("ComplianceGap", tx.complianceGap.deleteMany({ where: { tenderId } }));
  await wrapDelete("TenderExpertMatch", tx.tenderExpertMatch.deleteMany({ where: { tenderId } }));
  await wrapDelete("TenderProjectMatch", tx.tenderProjectMatch.deleteMany({ where: { tenderId } }));
  await wrapDelete("MatchScoreBreakdown", tx.matchScoreBreakdown.deleteMany({ where: { tenderId } }));
  await wrapDelete("EvaluatorObjection", tx.evaluatorObjection.deleteMany({ where: { tenderId } }));
  await wrapDelete("SectionEvidenceMap", tx.sectionEvidenceMap.deleteMany({ where: { tenderId } }));
  await wrapDelete("TenderMetadataOverride", tx.tenderMetadataOverride.deleteMany({ where: { tenderId } }));
  await wrapDelete("SubmissionPlanState", tx.submissionPlanState.deleteMany({ where: { tenderId } }));
  await wrapDelete("TenderShare", tx.tenderShare.deleteMany({ where: { tenderId } }));
  await wrapDelete("TenderCopilotMessage", tx.tenderCopilotMessage.deleteMany({ where: { tenderId } }));

  // Layer 8: Scalar-only orphan tables
  await wrapDelete("FallbackApprovalRecord", tx.fallbackApprovalRecord.deleteMany({ where: { tenderId } }));
  await wrapDelete("ExtractionQualityOverride", tx.extractionQualityOverride.deleteMany({ where: { tenderId } }));

  // Layer 9: AiUsageRecord — nullify (FAIL CLOSED, no P2021 skip)
  logPhase("UPDATE_NULL", "AiUsageRecord");
  try {
    await tx.aiUsageRecord.updateMany({ where: { tenderId }, data: { tenderId: null } });
  } catch (e) {
    const errorClass =
      e instanceof Prisma.PrismaClientKnownRequestError
        ? `PrismaError(${e.code})`
        : e instanceof Error
          ? e.constructor.name
          : "UnknownError";
    logger.error(`[tender-delete] AiUsageRecord nullification failed — rolling back`, {
      tenderId, correlationId, errorClass, error: e,
    });
    throw e; // Roll back the entire transaction — fail closed.
  }

  // Commit a durable retry manifest BEFORE the final Tender row disappears.
  // The AuditLog row is independent of the Tender FK and survives the cascade.
  const storageCleanupTaskId = await createTenderStorageCleanupTask({
    tx,
    userId: actorId,
    tenderId,
    correlationId,
    files: [
      ...tenderFiles.map((file) => ({
        storagePath: file.storagePath,
        fileName: file.originalFileName,
      })),
      ...generatedDocs.map((doc) => ({
        storagePath: doc.storagePath,
        fileName: doc.exactFileName ?? "generated-document",
      })),
    ],
  });

  // Layer 10: Final Tender deletion
  await wrapDelete("Tender", tx.tender.delete({ where: { id: tenderId } }));

  // Return only the durable cleanup task ID. External blob cleanup is handled
  // exclusively through the durable manifest via processTenderStorageCleanupTask.
  // This prevents orphaned blobs if the process crashes between the transaction
  // commit and a direct deleteFile call.
  return { storageCleanupTaskId };
}
