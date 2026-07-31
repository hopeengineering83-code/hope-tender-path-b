import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { MATCH_PAGE_SIZE } from "../../../../../lib/engine/matching-config";
import { computeTenderMutationLockKey } from "../../../../../lib/engine/advisory-lock-key";
import { buildAndVerifyBuildPlan } from "../../../../../lib/engine/automatic-build-plan";
import {
  canUseVaultRecord,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../../../../../lib/vault-review-provenance";

export const dynamic = "force-dynamic";

const MIN_DECISION_RATIONALE_LENGTH = 12;
const MAX_DECISION_RATIONALE_LENGTH = 1_000;

type MatchType = "expert" | "project";

type ManualSelectionDecision = {
  matchId: string;
  matchType: MatchType;
  isSelected: boolean;
  rationale: string;
  expectedRevision: string;
};

class MatchDecisionConflict extends Error {
  constructor(
    readonly code: "MATCH_REVISION_CONFLICT" | "MATCH_NOT_FOUND" | "MATCH_SOURCE_NOT_ELIGIBLE",
    message: string,
  ) {
    super(message);
  }
}

function parseDecisionBody(value: unknown): ManualSelectionDecision | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const matchId = typeof body.matchId === "string" ? body.matchId.trim() : "";
  const matchType = body.matchType;
  const rationale = typeof body.rationale === "string" ? body.rationale.replace(/\s+/g, " ").trim() : "";
  const expectedRevision = typeof body.expectedRevision === "string" ? body.expectedRevision.trim() : "";

  if (
    !matchId ||
    (matchType !== "expert" && matchType !== "project") ||
    typeof body.isSelected !== "boolean" ||
    rationale.length < MIN_DECISION_RATIONALE_LENGTH ||
    rationale.length > MAX_DECISION_RATIONALE_LENGTH ||
    !expectedRevision ||
    Number.isNaN(new Date(expectedRevision).getTime())
  ) return null;

  return {
    matchId,
    matchType,
    isSelected: body.isSelected,
    rationale,
    expectedRevision,
  };
}

async function invalidateSelectionDependents(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  tenderId: string,
  reason: string,
) {
  const now = new Date();
  const [buildPlans, submissionPlans, generatedDocuments, exportPackages, sectionMaps, planState] = await Promise.all([
    tx.buildPlan.updateMany({
      where: { tenderId, status: { not: "SUPERSEDED" } },
      data: {
        status: "SUPERSEDED",
        confirmedAt: null,
        confirmedBy: null,
        confirmedById: null,
        confirmedRevision: null,
        confirmedContentHash: null,
      },
    }),
    tx.submissionPlanRevision.updateMany({
      where: {
        tenderId,
        status: { notIn: ["SUPERSEDED", "INVALIDATED"] },
      },
      data: {
        status: "INVALIDATED",
        invalidatedAt: now,
        invalidationReason: reason,
      },
    }),
    tx.generatedDocument.updateMany({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
      data: {
        generationStatus: "SUPERSEDED",
        validationStatus: "SUPERSEDED",
        reviewStatus: "SUPERSEDED",
        reviewNotes: reason,
        reviewedBy: null,
        reviewedAt: null,
      },
    }),
    tx.exportPackage.updateMany({
      where: { tenderId },
      data: {
        status: "STALE",
        integrityStatus: "UNKNOWN",
        integrityVerifiedAt: null,
      },
    }),
    tx.sectionEvidenceMap.updateMany({
      where: { tenderId, status: { not: "SUPERSEDED" } },
      data: {
        status: "SUPERSEDED",
        reviewerStatus: "PENDING",
        reviewerNote: reason,
      },
    }),
    tx.submissionPlanState.updateMany({
      where: { tenderId },
      data: {
        provenance: "STALE_SELECTION_DECISION",
        confirmationStatus: "NOT_CONFIRMED",
        confirmedAt: null,
      },
    }),
  ]);

  return {
    buildPlans: buildPlans.count,
    submissionPlans: submissionPlans.count,
    generatedDocuments: generatedDocuments.count,
    exportPackages: exportPackages.count,
    sectionMaps: sectionMaps.count,
    planState: planState.count,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [selectedExperts, selectedProjects, unselectedExperts, unselectedProjects] = await Promise.all([
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: true },
      orderBy: { score: "desc" },
      include: {
        expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
      },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: true },
      orderBy: { score: "desc" },
      include: {
        project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
      },
    }),
    prisma.tenderExpertMatch.findMany({
      where: { tenderId, isSelected: false },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE,
      include: {
        expert: { select: { id: true, fullName: true, title: true, disciplines: true, sectors: true, trustLevel: true } },
      },
    }),
    prisma.tenderProjectMatch.findMany({
      where: { tenderId, isSelected: false },
      orderBy: { score: "desc" },
      take: MATCH_PAGE_SIZE,
      include: {
        project: { select: { id: true, name: true, clientName: true, sector: true, contractValue: true, currency: true, trustLevel: true } },
      },
    }),
  ]);

  const combineMatches = <T extends { isSelected: boolean; score: number }>(selected: T[], unselected: T[]): T[] => {
    return [...selected, ...unselected]
      .sort((a, b) => {
        if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
        return b.score - a.score;
      });
  };

  const expertMatches = combineMatches(selectedExperts, unselectedExperts);
  const projectMatches = combineMatches(selectedProjects, unselectedProjects);

  return NextResponse.json({
    expertMatches: expertMatches.map((match) => ({
      id: match.id,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
      revision: match.updatedAt.toISOString(),
      expert: match.expert,
    })),
    projectMatches: projectMatches.map((match) => ({
      id: match.id,
      score: match.score,
      rationale: match.rationale,
      isSelected: match.isSelected,
      revision: match.updatedAt.toISOString(),
      project: match.project,
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`matches:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Too many requests", retryAfter }, {
      status: 429,
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: { id: true },
  });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseDecisionBody(await req.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json({
      error: `A valid match, expected revision, selected option, and ${MIN_DECISION_RATIONALE_LENGTH}-${MAX_DECISION_RATIONALE_LENGTH} character rationale are required.`,
      code: "SCOPED_SELECTION_DECISION_REQUIRED",
    }, { status: 400 });
  }

  try {
    const decision = await prisma.$transaction(async (tx) => {
      const lockKey = computeTenderMutationLockKey(tenderId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const selectedBefore = parsed.matchType === "expert"
        ? await tx.tenderExpertMatch.findMany({
            where: { tenderId, isSelected: true },
            orderBy: { id: "asc" },
            select: { id: true },
          })
        : await tx.tenderProjectMatch.findMany({
            where: { tenderId, isSelected: true },
            orderBy: { id: "asc" },
            select: { id: true },
          });

      const match = parsed.matchType === "expert"
        ? await tx.tenderExpertMatch.findFirst({
            where: { id: parsed.matchId, tenderId },
            include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } },
          })
        : await tx.tenderProjectMatch.findFirst({
            where: { id: parsed.matchId, tenderId },
            include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } },
          });

      if (!match) throw new MatchDecisionConflict("MATCH_NOT_FOUND", "Match not found.");
      if (match.updatedAt.toISOString() !== new Date(parsed.expectedRevision).toISOString()) {
        throw new MatchDecisionConflict(
          "MATCH_REVISION_CONFLICT",
          "The Engine selection changed after this page was loaded. Refresh and review the current selection before recording an exception.",
        );
      }

      const record = parsed.matchType === "expert"
        ? (match as typeof match & { expert: Parameters<typeof canUseVaultRecord>[0] }).expert
        : (match as typeof match & { project: Parameters<typeof canUseVaultRecord>[0] }).project;
      if (parsed.isSelected && !canUseVaultRecord(record, "MATCHING")) {
        throw new MatchDecisionConflict(
          "MATCH_SOURCE_NOT_ELIGIBLE",
          "This record is not currently source-verified and cannot be selected.",
        );
      }

      if (match.isSelected === parsed.isSelected) {
        return {
          noChange: true,
          matchId: match.id,
          matchType: parsed.matchType,
          isSelected: match.isSelected,
          revision: match.updatedAt.toISOString(),
          invalidated: {
            buildPlans: 0,
            submissionPlans: 0,
            generatedDocuments: 0,
            exportPackages: 0,
            sectionMaps: 0,
            planState: 0,
          },
        };
      }

      const updated = parsed.matchType === "expert"
        ? await tx.tenderExpertMatch.update({
            where: { id: parsed.matchId },
            data: { isSelected: parsed.isSelected },
            select: { id: true, isSelected: true, updatedAt: true },
          })
        : await tx.tenderProjectMatch.update({
            where: { id: parsed.matchId },
            data: { isSelected: parsed.isSelected },
            select: { id: true, isSelected: true, updatedAt: true },
          });

      const invalidationReason = `Superseded by scoped ${parsed.matchType} evidence-selection decision ${updated.id}.`;
      const invalidated = await invalidateSelectionDependents(tx, tenderId, invalidationReason);
      const selectedAfter = parsed.matchType === "expert"
        ? await tx.tenderExpertMatch.findMany({
            where: { tenderId, isSelected: true },
            orderBy: { id: "asc" },
            select: { id: true },
          })
        : await tx.tenderProjectMatch.findMany({
            where: { tenderId, isSelected: true },
            orderBy: { id: "asc" },
            select: { id: true },
          });

      await tx.auditLog.create({
        data: {
          userId,
          action: "TENDER_EVIDENCE_SELECT",
          entityType: parsed.matchType === "expert" ? "TenderExpertMatch" : "TenderProjectMatch",
          entityId: updated.id,
          description: "Scoped evidence-selection exception recorded; dependent release artifacts invalidated.",
          metadata: JSON.stringify({
            decisionType: "MATERIAL_EVIDENCE_SELECTION_EXCEPTION",
            tenderId,
            matchType: parsed.matchType,
            affectedRecordId: updated.id,
            alternatives: [
              { option: "KEEP_ENGINE_SELECTION", selected: match.isSelected },
              { option: "APPLY_SCOPED_EXCEPTION", selected: parsed.isSelected },
            ],
            sourceEvidence: {
              sourceDocumentId: record.sourceDocumentId,
              trustLevel: record.trustLevel,
              sourceEligible: canUseVaultRecord(record, "MATCHING"),
            },
            rationale: parsed.rationale,
            selectedOption: parsed.isSelected,
            decisionMaker: userId,
            decisionTimestamp: updated.updatedAt.toISOString(),
            previousRevision: match.updatedAt.toISOString(),
            resultingRevision: updated.updatedAt.toISOString(),
            selectedBefore: selectedBefore.map((item) => item.id),
            selectedAfter: selectedAfter.map((item) => item.id),
            affectedOutputs: invalidated,
            invalidationRules: [
              "SUPERSEDE_BUILD_PLAN",
              "INVALIDATE_SUBMISSION_PLAN_REVISION",
              "SUPERSEDE_GENERATED_DOCUMENTS",
              "STALE_EXPORT_PACKAGES",
              "SUPERSEDE_SECTION_EVIDENCE_MAP",
            ],
          }),
        },
      });

      return {
        noChange: false,
        matchId: updated.id,
        matchType: parsed.matchType,
        isSelected: updated.isSelected,
        revision: updated.updatedAt.toISOString(),
        invalidated,
      };
    }, { isolationLevel: "Serializable" });

    if (decision.noChange) {
      return NextResponse.json({
        ...decision,
        planRebuild: { status: "NOT_REQUIRED" },
      });
    }

    const planRebuild = await buildAndVerifyBuildPlan(prisma, tenderId, userId, {
      reuseCurrent: false,
    }).then((result) => result.ok
      ? {
          status: "MACHINE_CONFIRMED",
          revision: result.revision,
          contentHash: result.contentHash,
          confirmationMode: result.confirmationMode,
        }
      : {
          status: "SAFE_BLOCKED",
          code: result.code,
          message: result.message,
          blockers: result.blockers ?? [],
        })
      .catch(() => ({
        status: "SAFE_BLOCKED",
        code: "AUTOMATIC_PLAN_REBUILD_FAILED",
        message: "The decision was preserved, but the automatic Build Plan rebuild did not complete. Dependent artifacts remain safely invalidated.",
        blockers: [],
      }));

    return NextResponse.json({
      ...decision,
      planRebuild,
      nextAutomaticAction: planRebuild.status === "MACHINE_CONFIRMED"
        ? "CONTINUE_AUTOMATED_GENERATION"
        : "RETRY_AUTOMATIC_PLAN_REBUILD",
    });
  } catch (error) {
    if (error instanceof MatchDecisionConflict) {
      const publicMessage = error.code === "MATCH_NOT_FOUND"
      ? "The selected evidence row was not found."
      : error.code === "MATCH_REVISION_CONFLICT"
        ? "The Engine selection changed after this page was loaded. Refresh and review the current selection before recording an exception."
        : "This record is not currently source-verified and cannot be selected.";
    return NextResponse.json({ error: publicMessage, code: error.code }, {
        status: error.code === "MATCH_NOT_FOUND" ? 404 : error.code === "MATCH_REVISION_CONFLICT" ? 409 : 422,
      });
    }
    return NextResponse.json({
      error: "The evidence-selection decision could not be persisted safely.",
      code: "SCOPED_SELECTION_DECISION_FAILED",
    }, { status: 500 });
  }
}
