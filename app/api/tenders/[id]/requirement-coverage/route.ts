import { NextResponse } from "next/server";
import { logger } from "../../../../../lib/observability";
import {
  forbiddenResponse,
  requireRole,
  unauthorizedResponse,
} from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { API_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  parseAutomaticRequirementEvidence,
} from "../../../../../lib/engine/automatic-requirement-coverage";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";
type CoverageStatus = "FULLY_MET" | "PARTIALLY_MET" | "NOT_MET" | "NEEDS_TRACE";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
  autoLinked: boolean;
  linkageScore: number | null;
  linkageReasons: string[];
  sourceDocumentId: string | null;
  sourceFileName: string | null;
  sourceContentHash: string | null;
  sourceByteLength: number | null;
  matchedFacets: string[];
};

type RequirementCoverageRow = {
  id: string;
  title: string;
  requirementType: string;
  priority: string;
  sectionReference: string | null;
  sourcePageNumber: number | null;
  sourceSectionHeading: string | null;
  sourceExactQuote: string | null;
  sourceConfidence: number;
  hasSourceRef: boolean;
  evidenceLinks: EvidenceLink[];
  supportLevel: SupportLevel;
  coverageStatus: CoverageStatus;
  isFullyCovered: boolean;
  automationState: "FULLY_VERIFIED" | "PARTIALLY_VERIFIED" | "AUTO_RESOLVING" | "TRUE_EVIDENCE_GAP" | "STALE_OR_INVALIDATED";
  nextAction: string;
};

function deriveSupportLevel(links: EvidenceLink[]): SupportLevel {
  if (links.length === 0) return "NONE";
  const levels = links.map((link) => normalizeSupportLevel(link.supportLevel));
  if (levels.includes("FULL")) return "FULL";
  if (levels.includes("SUBSTANTIAL")) return "SUBSTANTIAL";
  if (levels.includes("PARTIAL")) return "PARTIAL";
  if (levels.includes("NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "NONE";
}

function automaticStateFor(input: {
  coverageStatus: CoverageStatus;
  hasSourceRef: boolean;
  evidenceLinks: EvidenceLink[];
  resolverRunning: boolean;
}): RequirementCoverageRow["automationState"] {
  if (input.coverageStatus === "FULLY_MET") return "FULLY_VERIFIED";
  if (input.coverageStatus === "PARTIALLY_MET") return "PARTIALLY_VERIFIED";
  // AUTO_RESOLVING is bound to the exact requirement: only requirements
  // whose own source trace is missing or stale (and therefore actually
  // need re-grounding) show AUTO_RESOLVING when a resolver is active.
  // Requirements that are already grounded but lack eligible evidence
  // show TRUE_EVIDENCE_GAP — the resolver is not working on their source
  // trace, so showing "Auto-resolving" would be misleading.
  if (input.resolverRunning && !input.hasSourceRef) return "AUTO_RESOLVING";
  if (!input.hasSourceRef || input.coverageStatus === "NEEDS_TRACE") return "STALE_OR_INVALIDATED";
  return "TRUE_EVIDENCE_GAP";
}

function nextAutomaticAction(input: {
  title: string;
  requirementType: string;
  automationState: RequirementCoverageRow["automationState"];
  evidenceLinks: EvidenceLink[];
}): string {
  if (input.automationState === "FULLY_VERIFIED") {
    return "Automatically covered with current tender-source trace and eligible evidence.";
  }
  if (input.automationState === "PARTIALLY_VERIFIED") {
    return "Automatically linked. The Engine will strengthen this requirement when more specific eligible evidence or validated output bytes become available.";
  }
  if (input.automationState === "AUTO_RESOLVING") {
    return "Automatic source grounding is retrying against the active tender files. No manual source-reference entry is required.";
  }

  const type = input.requirementType.toUpperCase();
  if (type === "EXPERT") {
    return "Every Company Vault document was searched automatically and none proves an expert for this discipline. Ingestion, source-document resolution, verification, matching and linking have already run — no upload is required unless the vault genuinely holds no CV for this discipline.";
  }
  if (type === "PROJECT_EXPERIENCE") {
    return "Every Company Vault document was searched automatically and none proves a project for this experience requirement. Ingestion, source-document resolution, verification, matching and linking have already run — no upload is required unless the vault genuinely holds no matching project reference.";
  }
  if (type === "FORM" || type === "ANNEX" || type === "DECLARATION") {
    return "No eligible tender-issued original or generated artifact is available yet. The Build Plan and generation pipeline will attach it automatically when the required source or output exists.";
  }
  if (type === "METHODOLOGY" || /methodology|work plan|technical approach/i.test(input.title)) {
    return "The automatic generation pipeline has not produced validated methodology bytes yet. Coverage will update without a confirmation step after generation.";
  }
  if (input.evidenceLinks.length > 0) {
    return "Current evidence is retained but is not strong enough for full release coverage. The Engine will upgrade it automatically when stronger verified evidence becomes available.";
  }
  return "No eligible source-grounded evidence exists for this requirement yet. Add the actual missing source document or complete the dependent generation stage; linking remains automatic.";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
    } catch (error) {
      return error instanceof Error && error.message === "Forbidden"
        ? forbiddenResponse()
        : unauthorizedResponse();
    }

    const rl = rateLimit(`req-coverage:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { ok: false, error: "Too many requests", code: "RATE_LIMITED", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true },
    });
    if (!tender) {
      return NextResponse.json(
        { ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const [finalPackageModel, requirements, activeResolverJob] = await Promise.all([
      getFinalPackageReadinessModel(prisma, id, actor.id),
      prisma.tenderRequirement.findMany({
        where: { tenderId: id, priority: { in: ["MANDATORY", "CRITICAL"] } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          requirementType: true,
          priority: true,
          sectionReference: true,
          sourcePageNumber: true,
          sourceSectionHeading: true,
          sourceExactQuote: true,
          sourceConfidence: true,
          complianceMatrixRows: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              evidenceType: true,
              evidenceSource: true,
              evidenceReference: true,
              supportLevel: true,
              notes: true,
            },
          },
        },
      }),
      prisma.aiJob.findFirst({
        where: {
          tenderId: id,
          userId: actor.id,
          jobType: "ENGINE_RUN",
          status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
        },
        select: { id: true },
      }),
    ]);

    const canonicalStatuses = new Map(
      finalPackageModel.requirementEvidenceStatuses.map((status) => [
        status.requirementId,
        status,
      ]),
    );

    const rows: RequirementCoverageRow[] = requirements.map((requirement) => {
      // Only persisted links are shown or counted. The former in-memory
      // VAULT_AUTO_LINK suggestion was never release authority and caused the
      // exact contradiction visible in the supplied screenshots.
      const evidenceLinks: EvidenceLink[] = requirement.complianceMatrixRows.flatMap((row) => {
        const automatic = parseAutomaticRequirementEvidence(row.notes);
        // Generic/null automatic rows have no auditable evidence identity and
        // are neither rendered nor counted. Reconciliation deletes them.
        if (row.evidenceSource.startsWith("AUTO_") && !automatic) return [];
        if (!automatic && !row.evidenceReference?.trim()) return [];
        return [{
          id: row.id,
          evidenceType: row.evidenceType,
          evidenceSource: row.evidenceSource,
          evidenceReference: row.evidenceReference,
          supportLevel: row.supportLevel,
          autoLinked: Boolean(automatic),
          linkageScore: automatic?.linkageScore ?? null,
          linkageReasons: automatic?.linkageReasons ?? [],
          sourceDocumentId: automatic?.sourceDocumentId ?? null,
          sourceFileName: automatic?.sourceFileName ?? null,
          sourceContentHash: automatic?.sourceContentHash ?? null,
          sourceByteLength: automatic?.sourceByteLength ?? null,
          matchedFacets: automatic?.matchedFacets ?? [],
        }];
      });
      const supportLevel = deriveSupportLevel(evidenceLinks);
      const canonicalStatus = canonicalStatuses.get(requirement.id);
      const coverageStatus: CoverageStatus = canonicalStatus?.displayStatus ?? "NOT_MET";
      const hasSourceRef = canonicalStatus?.hasSourceTrace ?? false;
      const isFullyCovered = coverageStatus === "FULLY_MET";
      const automationState = automaticStateFor({
        coverageStatus,
        hasSourceRef,
        evidenceLinks,
        resolverRunning: Boolean(activeResolverJob),
      });

      return {
        id: requirement.id,
        title: requirement.title,
        requirementType: requirement.requirementType,
        priority: requirement.priority,
        sectionReference: requirement.sectionReference,
        sourcePageNumber: requirement.sourcePageNumber,
        sourceSectionHeading: requirement.sourceSectionHeading,
        sourceExactQuote: requirement.sourceExactQuote,
        sourceConfidence: requirement.sourceConfidence ?? 0,
        hasSourceRef,
        evidenceLinks,
        supportLevel,
        coverageStatus,
        isFullyCovered,
        automationState,
        nextAction: nextAutomaticAction({
          title: requirement.title,
          requirementType: requirement.requirementType,
          automationState,
          evidenceLinks,
        }),
      };
    });

    const totalMandatory = rows.length;
    const fullyCovered = rows.filter((row) => row.coverageStatus === "FULLY_MET").length;
    const partiallyCovered = rows.filter((row) => row.coverageStatus === "PARTIALLY_MET").length;
    const needsTrace = rows.filter((row) => row.coverageStatus === "NEEDS_TRACE").length;
    const uncovered = rows.filter((row) => row.coverageStatus === "NOT_MET").length;
    const missingSourceRef = rows.filter((row) => !row.hasSourceRef).length;
    const automaticallyLinked = rows.reduce(
      (sum, row) => sum + row.evidenceLinks.filter((link) => link.autoLinked).length,
      0,
    );
    const trueEvidenceGaps = rows.filter((row) => row.automationState === "TRUE_EVIDENCE_GAP").length;
    const sourceProcessing = rows.filter((row) => row.automationState === "AUTO_RESOLVING").length;
    const staleOrInvalidated = rows.filter((row) => row.automationState === "STALE_OR_INVALIDATED").length;
    // Primary coverage is deliberately unweighted: only canonically FULL
    // mandatory requirements count. Partial progress is reported separately.
    const coverageRatio = totalMandatory > 0
      ? fullyCovered / totalMandatory
      : 1;
    const weightedProgressRatio = totalMandatory > 0
      ? (fullyCovered + partiallyCovered * 0.5) / totalMandatory
      : 1;

    return NextResponse.json({
      ok: true,
      automatic: true,
      manualConfirmationRequired: false,
      totalMandatory,
      fullyCovered,
      partiallyCovered,
      needsTrace,
      uncovered,
      missingSourceRef,
      automaticallyLinked,
      trueEvidenceGaps,
      sourceProcessing,
      staleOrInvalidated,
      coverageRatio,
      weightedProgressRatio,
      rows,
      finalPackageReadiness: {
        requirements: finalPackageModel.requirements,
        evidence: finalPackageModel.evidence,
        requirementEvidenceStatuses: finalPackageModel.requirementEvidenceStatuses,
      },
    });
  } catch (error) {
    logger.error("requirement-coverage GET failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Requirement coverage could not be loaded.",
        code: "REQUIREMENT_COVERAGE_RUNTIME_ERROR",
        requestId,
      },
      { status: 500 },
    );
  }
}
