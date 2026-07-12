// POST /api/tenders/[id]/regenerate-cvs
//
// One-shot maintenance endpoint that regenerates every Expert CV DOCX
// for a tender WITHOUT re-running the whole proposal engine. Used to
// retro-fix CVs that were rendered with forbidden-trace artifacts
// (PDF "=PAGE N=" markers, AI prep notes) before the trace-stripper
// landed in expert-cv-docx.ts.
//
// Body: {} (empty — endpoint scopes to selected experts on the tender)
// Returns: { regenerated: number, skipped: number, errors: Array<...> }

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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`regen-cvs:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests. Please wait before regenerating again.", code: "RATE_LIMITED", resetAt: rl.resetAt, retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: {
      id: true, title: true, reference: true, clientName: true, deadline: true,
      submissionMethod: true, submissionEmails: true, submissionAddress: true,
      country: true, metadataContaminated: true, analysisExtractionStatus: true,
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // ── Operation gate (DRAFT_GENERATION) — non-blocking observability ────
  // CV regeneration is a DRAFT_GENERATION operation. The gate surfaces
  // metadata warnings without blocking; the central readiness gate above
  // is the real hard blocker.
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
    logger.info(`[regenerate-cvs] tender=${tenderId} operation-gate warnings: ${cvOpGate.warnings.join("; ")}`);
  }
  if (cvOpGate.blockers.length > 0) {
    return NextResponse.json({
      error: `CV regeneration blocked by operation gate: ${cvOpGate.blockers.join("; ")}`,
      code: "OPERATION_GATE_BLOCKED",
      blockers: cvOpGate.blockers,
    }, { status: 422 });
  }

  // ── Central generation readiness gate ──────────────────────────────────
  // Regenerating expert CVs creates GENERATED GeneratedDocument rows —
  // Block on PARTIAL_EXTRACTION_AI_ANALYZED — inconsistent to allow CV
  // regeneration on partial extraction when /generate blocks it.
  if (tender.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    return NextResponse.json({ success: false, ok: false, code: "ANALYSIS_FROM_PARTIAL_EXTRACTION", error: "AI analysis ran on partial extraction; re-extract and re-run AI Analyze before regenerating CVs.", nextAction: "RERUN_AI_ANALYZE" }, { status: 422 });
  }

  // Fast preflight for a clear response before expensive DOCX rendering. This
  // does not authorize persistence: every write is rechecked under the shared
  // tender lock by withTransactionalGenerationGate below.
  const centralGate = await assertTenderReadyForGenerationAndExport({
    prisma,
    tenderId,
    userId: actor.id,
    purpose: "regenerate-cvs",
  });
  if (!centralGate.ok) {
    return NextResponse.json({
      error: `CV regeneration blocked: ${centralGate.blockerDetail}`,
      code: centralGate.blockerCode,
      nextAction: "Resolve the readiness gate blocker before regenerating CVs.",
    }, { status: 409 });
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

  for (const m of matches) {
    const expert = m.expert;
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
      const cvIntegrity = verifiedIntegrityDataFromBase64({ fileContent: cvContent, filename: fileName, claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      await prisma.$transaction(async (tx) => {
        await withTransactionalGenerationGate({
          prisma,
          tx,
          tenderId,
          userId: actor.id,
          purpose: "regenerate-cvs",
          write: async (lockedTx) => {
            // The lookup and write happen under the same tender mutation lock.
            // A source revision, AI promotion, or Build Plan change cannot race
            // between readiness evaluation and persistence.
            const existing = await lockedTx.generatedDocument.findFirst({
              where: { tenderId, exactFileName: fileName, generationStatus: { not: "SUPERSEDED" } },
              orderBy: { updatedAt: "desc" },
            });

            if (existing) {
              await lockedTx.generatedDocument.update({
                where: { id: existing.id },
                data: {
                  fileContent: cvContent,
                  ...cvIntegrity,
                  generationStatus: "GENERATED",
                  validationStatus: "PENDING",
                  reviewStatus: "PENDING",
                  reviewNotes: "Regenerated by /regenerate-cvs maintenance endpoint after trace-stripper fix.",
                  reviewedBy: null,
                  reviewedAt: null,
                  updatedAt: new Date(),
                },
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
                fileContent: cvContent,
                ...cvIntegrity,
                generationStatus: "GENERATED",
                validationStatus: "PENDING",
                reviewStatus: "PENDING",
                contentSummary: `Professional CV for ${expert.fullName}${expert.title ? `, ${expert.title}` : ""}.`,
              },
            });
          },
        });
      });

      regenerated += 1;
    } catch (err) {
      if (err instanceof GenerationPersistenceBlockedError) {
        errors.push({
          expertId: expert.id,
          fullName: expert.fullName,
          error: `Generation readiness changed before persistence: ${err.code}`,
        });
        // Once the shared gate blocks, every later write would also be invalid.
        // Stop immediately so the route cannot keep rendering or attempting rows.
        break;
      }
      errors.push({ expertId: expert.id, fullName: expert.fullName, error: sanitizeError(err).slice(0, 200) });
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

  return NextResponse.json({
    success: errors.length === 0,
    regenerated,
    skipped: 0,
    errors,
    note: regenerated > 0
      ? `Regenerated ${regenerated} CV(s). Each is now PENDING re-validation; the next ZIP download triggers it automatically.`
      : "No CVs regenerated. Check the errors array.",
  }, { status: errors.some((error) => error.error.startsWith("Generation readiness changed")) ? 409 : 200 });
}
