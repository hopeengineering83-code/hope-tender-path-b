// POST /api/tenders/[id]/regenerate-cvs
//
// Regenerates every selected Expert CV DOCX for a tender without re-running
// the full proposal engine. Every persistence attempt is re-authorized inside
// the shared tender mutation lock immediately before the row write.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateExpertCvDocx, expertCvFileName } from "../../../../../lib/engine/expert-cv-docx";
import { logAction } from "../../../../../lib/audit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { assertTenderReadyForGenerationAndExport } from "../../../../../lib/engine/generation-readiness-gate";
import { verifiedIntegrityDataFromBase64 } from "../../../../../lib/engine/persisted-byte-integrity";
import { resolveTenderOperationGate } from "../../../../../lib/engine/tender-operation-gate";
import {
  GenerationPersistenceBlockedError,
  withTransactionalGenerationGate,
} from "../../../../../lib/engine/transactional-generation-gate";
import { logger } from "../../../../../lib/observability";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) {
    return forbiddenResponse();
  }

  const rl = await rateLimitPersistent(`regen-cvs:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: "Too many requests. Please wait before regenerating again.",
        code: "RATE_LIMITED",
        resetAt: rl.resetAt,
        retryAfter,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: {
      id: true,
      title: true,
      reference: true,
      clientName: true,
      deadline: true,
      submissionMethod: true,
      submissionEmails: true,
      submissionAddress: true,
      country: true,
      metadataContaminated: true,
      analysisExtractionStatus: true,
    },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  const cvOpGate = resolveTenderOperationGate({
    tender: {
      id: tender.id,
      title: tender.title,
      reference: tender.reference,
      clientName: tender.clientName,
      deadline: tender.deadline,
      submissionMethod: tender.submissionMethod,
      submissionEmails: tender.submissionEmails,
      submissionAddress: tender.submissionAddress,
      country: tender.country,
      metadataContaminated: tender.metadataContaminated,
      analysisExtractionStatus: tender.analysisExtractionStatus,
    },
    requirements: [],
    overrides: [],
    buildPlan: null,
    operation: "DRAFT_GENERATION",
  });
  if (cvOpGate.warnings.length > 0) {
    logger.info(
      `[regenerate-cvs] tender=${tenderId} operation-gate warnings: ${cvOpGate.warnings.join("; ")}`,
    );
  }
  if (cvOpGate.blockers.length > 0) {
    return NextResponse.json(
      {
        error: `CV regeneration blocked by operation gate: ${cvOpGate.blockers.join("; ")}`,
        code: "OPERATION_GATE_BLOCKED",
        blockers: cvOpGate.blockers,
      },
      { status: 422 },
    );
  }

  if (tender.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        code: "ANALYSIS_FROM_PARTIAL_EXTRACTION",
        error: "AI analysis ran on partial extraction; re-extract and re-run AI Analyze before regenerating CVs.",
        nextAction: "RERUN_AI_ANALYZE",
      },
      { status: 422 },
    );
  }

  // Fast preflight for a clear response before expensive DOCX rendering.
  // This does not authorize persistence. Every create/update below performs the
  // same canonical check again under the shared tender mutation lock.
  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId: actor.id,
    purpose: "regenerate-cvs",
  });
  if (!centralGate.ok) {
    return NextResponse.json(
      {
        error: `CV regeneration blocked: ${centralGate.blockerDetail}`,
        code: centralGate.blockerCode,
        nextAction: "Resolve the readiness gate blocker before regenerating CVs.",
      },
      { status: 409 },
    );
  }

  const matches = await prisma.tenderExpertMatch.findMany({
    where: { tenderId, isSelected: true },
    include: { expert: true },
    orderBy: { score: "desc" },
    take: 12,
  });
  if (matches.length === 0) {
    return NextResponse.json({
      regenerated: 0,
      skipped: 0,
      errors: [],
      note: "No selected experts on this tender — nothing to regenerate.",
    });
  }

  let regenerated = 0;
  const errors: Array<{ expertId: string; fullName: string; error: string }> = [];

  for (const match of matches) {
    const expert = match.expert;
    try {
      const fileName = expertCvFileName(expert.fullName);
      const cvBuffer = await generateExpertCvDocx({
        fullName: expert.fullName,
        title: expert.title,
        email: expert.email,
        phone: expert.phone,
        yearsExperience: expert.yearsExperience,
        disciplines: expert.disciplines,
        sectors: expert.sectors,
        certifications: expert.certifications,
        profile: expert.profile,
      });
      const cvContent = cvBuffer.toString("base64");
      const cvIntegrity = verifiedIntegrityDataFromBase64({
        fileContent: cvContent,
        filename: fileName,
        claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const persistCv = async () => {
        await prisma.$transaction(async (tx) => {
          await withTransactionalGenerationGate({
            prisma,
            tx,
            tenderId,
            userId: actor.id,
            purpose: "regenerate-cvs",
            write: async (lockedTx) => {
              const existing = await lockedTx.generatedDocument.findFirst({
                where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
                orderBy: { updatedAt: "desc" },
              });

              const regeneratedData = {
                fileContent: cvContent,
                ...cvIntegrity,
                generationStatus: "GENERATED",
                validationStatus: "PENDING",
                reviewStatus: "PENDING",
                reviewNotes: "Regenerated by /regenerate-cvs after transactional readiness recheck.",
                reviewedBy: null,
                reviewedAt: null,
                updatedAt: new Date(),
              };

              if (existing) {
                await lockedTx.generatedDocument.update({
                  where: { id: existing.id },
                  data: regeneratedData,
                });
                return;
              }

              await lockedTx.generatedDocument.create({
                data: {
                  tenderId,
                  name: `CV — ${expert.fullName}`,
                  documentType: "EXPERT_CV_PACKAGE",
                  format: "DOCX",
                  exactFileName: fileName,
                  contentSummary: `Professional CV for ${expert.fullName}${expert.title ? `, ${expert.title}` : ""}.`,
                  ...regeneratedData,
                },
              });
            },
          });
        });
      };

      try {
        await persistCv();
      } catch (createErr) {
        if ((createErr as { code?: string })?.code === "P2002") {
          const winner = await prisma.generatedDocument.findFirst({
            where: {
              tenderId,
              exactFileName: fileName,
              generationStatus: { not: "SUPERSEDED" },
            },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });
          if (!winner) {
            errors.push({
              expertId: expert.id,
              fullName: expert.fullName,
              error: "P2002 convergence failed: the concurrent winner was deleted before this row could be updated.",
            });
            continue;
          }
          // The failed transaction rolled back completely. Retrying the whole
          // gated transaction converges to updating the winner.
          await persistCv();
        } else {
          throw createErr;
        }
      }

      regenerated += 1;
    } catch (err) {
      if (err instanceof GenerationPersistenceBlockedError) {
        errors.push({
          expertId: expert.id,
          fullName: expert.fullName,
          error: `Generation readiness changed before persistence: ${err.code}`,
        });
        // The shared gate will continue to reject later writes for the same
        // changed tender revision, so stop rendering and writing immediately.
        break;
      }
      errors.push({
        expertId: expert.id,
        fullName: expert.fullName,
        error: sanitizeError(err).slice(0, 200),
      });
    }
  }

  await logAction({
    userId: actor.id,
    action: "EXPERT_CV_REGENERATE",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} regenerated ${regenerated} expert CV(s) on "${tender.title}"`,
    metadata: { tenderId, regenerated, errorCount: errors.length },
  });

  return NextResponse.json(
    {
      success: errors.length === 0,
      regenerated,
      skipped: 0,
      errors,
      note:
        regenerated > 0
          ? `Regenerated ${regenerated} CV(s). Each is now PENDING re-validation; the next ZIP download triggers it automatically.`
          : "No CVs regenerated. Check the errors array.",
    },
    {
      status: errors.some((error) =>
        error.error.startsWith("Generation readiness changed"),
      )
        ? 409
        : 200,
    },
  );
}
