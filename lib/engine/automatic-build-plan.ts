import type { PrismaClient } from "@prisma/client";
import {
  buildDraftBuildPlan,
  computeTenderBuildPlanHash,
  getCurrentConfirmedBuildPlan,
  validateBuildPlanForConfirmation,
  type BuildPlanItem,
} from "./build-plan";
import { attributeMetadataSourceFileId } from "./metadata-source-attribution";
import { enrichMetadataWithSourceEvidence } from "./metadata-source-enrichment";
import { locateQuoteProvenPage } from "./page-provenance";
import { syncPersistedTenderFactsToLedger } from "./tender-facts-ledger-service";

export const AUTOMATIC_BUILD_PLAN_ACTOR = "SYSTEM_AUTOMATION";

export type AutomaticBuildPlanResult =
  | {
      ok: true;
      planId: string;
      status: "CONFIRMED";
      revision: number;
      contentHash: string;
      items: BuildPlanItem[];
      confirmationMode: "AUTOMATIC_SOURCE_GROUNDED";
      authorizesGeneration: true;
      reusedCurrentPlan: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
      blockers?: string[];
      authorizesGeneration: false;
    };

function automaticValidationJson(blockers: string[] = []): string {
  return JSON.stringify({
    ok: blockers.length === 0,
    blockers,
    confirmationMode: "AUTOMATIC_SOURCE_GROUNDED",
    verifiedBy: AUTOMATIC_BUILD_PLAN_ACTOR,
  });
}

/**
 * Reconcile title provenance from the active source before Build Plan validation.
 * This never trusts the stored/AI page number: it derives file + page from the
 * actual extracted text and known page boundaries, or leaves the strict gate to
 * report TENDER_FACTS_INVALID when the source cannot prove the title.
 */
export async function reconcileTitleSourceEvidence(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
): Promise<{ repaired: boolean; proven: boolean }> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true,
      title: true,
      titleSourceFileId: true,
      titleSourcePage: true,
      titleSourceQuote: true,
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: { id: true, extractedText: true, deletionStatus: true, totalPages: true },
      },
    },
  });
  if (!tender) return { repaired: false, proven: false };

  let evidence: { titleSourceFileId?: string; titleSourcePage?: number | null; titleSourceQuote?: string } = {};
  const quotedFileId = attributeMetadataSourceFileId(tender.titleSourceQuote, tender.files);
  if (quotedFileId && tender.titleSourceQuote) {
    const file = tender.files.find((item) => item.id === quotedFileId)!;
    const page = locateQuoteProvenPage(file.extractedText, tender.titleSourceQuote, file.totalPages);
    if (page !== null) {
      evidence = { titleSourceFileId: quotedFileId, titleSourcePage: page, titleSourceQuote: tender.titleSourceQuote };
    }
  }
  if (!evidence.titleSourceFileId) {
    evidence = enrichMetadataWithSourceEvidence({ title: tender.title }, tender.files);
  }
  if (!evidence.titleSourceFileId || !evidence.titleSourcePage || !evidence.titleSourceQuote) {
    return { repaired: false, proven: false };
  }

  const repaired = tender.titleSourceFileId !== evidence.titleSourceFileId
    || tender.titleSourcePage !== evidence.titleSourcePage
    || tender.titleSourceQuote !== evidence.titleSourceQuote;
  await prisma.$transaction(async (tx) => {
    if (repaired) {
      const updated = await tx.tender.updateMany({
        where: { id: tenderId, userId },
        data: evidence,
      });
      if (updated.count !== 1) throw new Error("TITLE_SOURCE_RECONCILIATION_SCOPE_LOST");
    }
    // Scalar source columns and the canonical ledger are one authority change.
    // Keeping them in the same transaction prevents an interrupted repair from
    // exposing valid Tender fields beside stale ledger evidence.
    await syncPersistedTenderFactsToLedger(tx as PrismaClient, tenderId, userId);
  });
  return { repaired, proven: true };
}

/**
 * Builds and machine-verifies the current tender-controlled file plan.
 *
 * The service deliberately preserves the existing fail-closed CONFIRMED
 * authority used by generation/export. It replaces only the manual checkbox
 * and confirmation click: deterministic source, scope, hash, revision, and
 * item validation now create that authority automatically.
 */
export async function buildAndVerifyBuildPlan(
  prisma: PrismaClient,
  tenderId: string,
  userId: string,
  options: { reuseCurrent?: boolean } = {},
): Promise<AutomaticBuildPlanResult> {
  await reconcileTitleSourceEvidence(prisma, tenderId, userId);
  if (options.reuseCurrent !== false) {
    const current = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
    if (current.ok) {
      return {
        ok: true,
        planId: current.plan.id,
        status: "CONFIRMED",
        revision: current.plan.revision,
        contentHash: current.currentHash ?? current.plan.confirmedContentHash ?? current.plan.contentHash,
        items: current.items,
        confirmationMode: "AUTOMATIC_SOURCE_GROUNDED",
        authorizesGeneration: true,
        reusedCurrentPlan: true,
      };
    }
  }

  const draftResult = await buildDraftBuildPlan(prisma, tenderId, userId);
  if (!draftResult.ok) {
    return {
      ok: false,
      code: draftResult.code,
      message: draftResult.message,
      status: draftResult.status,
      authorizesGeneration: false,
    };
  }

  const candidateId = draftResult.plan.id as string;
  const candidateRevision = draftResult.plan.revision as number;
  const candidateHash = draftResult.plan.contentHash as string;
  const items = draftResult.items;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const candidate = await (tx as any).buildPlan.findUnique({ where: { id: candidateId } });
        if (
          !candidate ||
          candidate.status !== "DRAFT" ||
          candidate.revision !== candidateRevision ||
          candidate.contentHash !== candidateHash
        ) {
          return {
            ok: false as const,
            code: "BUILD_PLAN_AUTOMATION_CONFLICT",
            message: "The Build Plan changed during automatic verification. Retry the Engine or rebuild the plan.",
            status: 409,
            authorizesGeneration: false as const,
          };
        }

        const validation = await validateBuildPlanForConfirmation(tx as PrismaClient, tenderId, userId, items);
        const currentHash = await computeTenderBuildPlanHash(tx as PrismaClient, tenderId, userId, items);
        const blockers = [
          ...validation.blockers,
          ...(!currentHash || currentHash !== candidateHash
            ? ["Build Plan content changed during automatic verification."]
            : []),
        ];

        if (blockers.length > 0 || !validation.ok || !currentHash) {
          const validationUpdate = await (tx as any).buildPlan.updateMany({
            where: {
              id: candidateId,
              status: "DRAFT",
              revision: candidateRevision,
              contentHash: candidateHash,
            },
            data: { validationJson: automaticValidationJson(blockers) },
          });
          if (validationUpdate.count === 0) {
            return {
              ok: false as const,
              code: "BUILD_PLAN_AUTOMATION_CONFLICT",
              message: "The Build Plan changed during automatic validation. Retry the Engine or rebuild the plan.",
              status: 409,
              authorizesGeneration: false as const,
            };
          }
          return {
            ok: false as const,
            code: "BUILD_PLAN_AUTOMATION_BLOCKED",
            message: "The automatically derived Build Plan could not be source-verified.",
            status: 422,
            blockers,
            authorizesGeneration: false as const,
          };
        }

        const verifiedAt = new Date();
        const update = await (tx as any).buildPlan.updateMany({
          where: {
            id: candidateId,
            status: "DRAFT",
            revision: candidateRevision,
            contentHash: candidateHash,
          },
          data: {
            status: "CONFIRMED",
            confirmedRevision: candidateRevision,
            confirmedContentHash: currentHash,
            confirmedById: null,
            confirmedBy: AUTOMATIC_BUILD_PLAN_ACTOR,
            confirmedAt: verifiedAt,
            validationJson: automaticValidationJson(),
          },
        });
        if (update.count === 0) {
          return {
            ok: false as const,
            code: "BUILD_PLAN_AUTOMATION_CONFLICT",
            message: "The Build Plan changed before automatic verification could commit. Retry the Engine or rebuild the plan.",
            status: 409,
            authorizesGeneration: false as const,
          };
        }

        return {
          ok: true as const,
          planId: candidateId,
          status: "CONFIRMED" as const,
          revision: candidateRevision,
          contentHash: currentHash,
          items,
          confirmationMode: "AUTOMATIC_SOURCE_GROUNDED" as const,
          authorizesGeneration: true as const,
          reusedCurrentPlan: false,
        };
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      if (error?.code === "P2034" && attempt < maxRetries) continue;
      return {
        ok: false,
        code: error?.code === "P2034"
          ? "BUILD_PLAN_AUTOMATION_CONFLICT"
          : "BUILD_PLAN_AUTOMATION_INTERNAL_ERROR",
        message: error?.code === "P2034"
          ? "Automatic Build Plan verification conflicted repeatedly. Retry the Engine."
          : "Automatic Build Plan verification failed due to an internal error.",
        status: error?.code === "P2034" ? 409 : 500,
        authorizesGeneration: false,
      };
    }
  }

  return {
    ok: false,
    code: "BUILD_PLAN_AUTOMATION_CONFLICT",
    message: "Automatic Build Plan verification could not converge.",
    status: 409,
    authorizesGeneration: false,
  };
}
