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
  automationState: "COVERED" | "PARTIAL" | "SOURCE_PROCESSING" | "TRUE_EVIDENCE_GAP";
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
}): RequirementCoverageRow["automationState"] {
  if (input.coverageStatus === "FULLY_MET") return "COVERED";
  if (input.coverageStatus === "PARTIALLY_MET") return "PARTIAL";
  if (!input.hasSourceRef || input.coverageStatus === "NEEDS_TRACE") return "SOURCE_PROCESSING";
  return "TRUE_EVIDENCE_GAP";
}

function nextAutomaticAction(input: {
  title: string;
  requirementType: string;
  automationState: RequirementCoverageRow["automationState"];
  evidenceLinks: EvidenceLink[];
}): string {
  if (input.automationState === "COVERED") {
    return "Automatically covered with current tender-source trace and eligible evidence.";
  }
  if (input.automationState === "PARTIAL") {
    return "Automatically linked. The Engine will strengthen this requirement when more specific eligible evidence or validated output bytes become available.";
  }
  if (input.automationState === "SOURCE_PROCESSING") {
    return "Automatic source grounding is retrying against the active tender files. No manual source-reference entry is required.";
  }

  const type = input.requirementType.toUpperCase();
  if (type === "EXPERT") {
    return "No source-verified expert currently satisfies this discipline. Add the missing expert CV source document to Company Vault; ingestion, verification, matching, and linking then run automatically.";
  }
  if (type === "PROJECT_EXPERIENCE") {
    return "No source-verified project currently satisfies this experience requirement. Add the missing project-reference source document to Company Vault; ingestion, verification, matching, and linking then run automatically.";
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

    const [finalPackageModel, requirements] = await Promise.all([
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
    ]);

    const canonicalStatuses = new Map(
      finalPackageModel.requirementEvidenceStatuses.map((status) => [
        status.requirementId,
        status,
      ]),
    );

    const rows: RequirementCoverageRow[] = requirements.map((requirement) => {
      // Only persisted links are shown or counted. The former in-memory
      // A previous automatic-link suggestion was never release authority and caused the
      // exact contradiction visible in the supplied screenshots.
      const evidenceLinks: EvidenceLink[] = requirement.complianceMatrixRows.map((row) => {
        const automatic = parseAutomaticRequirementEvidence(row.notes);
        return {
          id: row.id,
          evidenceType: row.evidenceType,
          evidenceSource: row.evidenceSource,
          evidenceReference: row.evidenceReference,
          supportLevel: row.supportLevel,
          autoLinked: Boolean(automatic),
          linkageScore: automatic?.linkageScore ?? null,
          linkageReasons: automatic?.linkageReasons ?? [],
        };
      });
      const supportLevel = deriveSupportLevel(evidenceLinks);
      const canonicalStatus = canonicalStatuses.get(requirement.id);
      const coverageStatus: CoverageStatus = canonicalStatus?.displayStatus ?? "NOT_MET";
      const hasSourceRef = canonicalStatus?.hasSourceTrace ?? false;
      const isFullyCovered = coverageStatus === "FULLY_MET";
      const automationState = automaticStateFor({ coverageStatus, hasSourceRef, evidenceLinks });

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
    const sourceProcessing = rows.filter((row) => row.automationState === "SOURCE_PROCESSING").length;
    const coverageRatio = totalMandatory > 0 ? fullyCovered / totalMandatory : 1;

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
      coverageRatio,
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
