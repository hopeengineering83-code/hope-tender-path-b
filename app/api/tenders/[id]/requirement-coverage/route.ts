import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";
import { getFinalPackageReadinessModel } from "../../../../../lib/engine/final-package-readiness-model";
import { extractRequestId } from "../../../../../lib/request-id";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "../../../../../lib/vault-review-provenance";

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
  autoLinked?: boolean;
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
  nextAction: string;
};
type VaultEvidence = {
  id: string;
  name: string;
  type: "EXPERT" | "PROJECT";
  isReviewed: boolean;
};

const PERSONNEL_KEYWORDS = /personnel|team|expert|staffing|key personnel|staff|workforce|human resource/i;
const EXPERIENCE_KEYWORDS = /experience|references|similar projects|track record|past performance|portfolio/i;

function buildAutoLinks(
  requirement: { id: string; title: string; requirementType: string },
  vault: VaultEvidence[],
): EvidenceLink[] {
  const title = requirement.title.toLowerCase();
  const links: EvidenceLink[] = [];
  for (const evidence of vault) {
    if (!evidence.isReviewed) continue;
    const matches = evidence.type === "EXPERT"
      ? PERSONNEL_KEYWORDS.test(title) || requirement.requirementType === "EXPERT"
      : EXPERIENCE_KEYWORDS.test(title) || requirement.requirementType === "PROJECT_EXPERIENCE";
    if (!matches) continue;
    links.push({
      id: `auto-${evidence.id}-${requirement.id}`,
      evidenceType: evidence.type,
      evidenceSource: "VAULT_AUTO_LINK",
      evidenceReference: evidence.name,
      supportLevel: "PARTIAL",
      autoLinked: true,
    });
  }
  return links;
}

function deriveSupportLevel(links: EvidenceLink[]): SupportLevel {
  if (links.length === 0) return "NONE";
  const levels = links.map((link) => normalizeSupportLevel(link.supportLevel));
  if (levels.includes("FULL")) return "FULL";
  if (levels.includes("SUBSTANTIAL")) return "SUBSTANTIAL";
  if (levels.includes("PARTIAL")) return "PARTIAL";
  if (levels.includes("NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "NONE";
}

function nextActionFor(row: {
  supportLevel: SupportLevel;
  hasSourceRef: boolean;
  coverageStatus: CoverageStatus;
  requirementType: string;
  evidenceLinks: EvidenceLink[];
}): string {
  if (row.coverageStatus === "NEEDS_TRACE") {
    return "Repair the requirement source trace: active tender file, valid page, and exact quote contained in that file are all required.";
  }
  if (row.supportLevel === "NOT_APPLICABLE") return "The N/A note remains in the audit trail but does not satisfy this tender requirement for final release.";
  if (row.supportLevel === "NONE" || row.evidenceLinks.length === 0) {
    if (row.requirementType === "EXPERT") return "Add a reviewed expert with this discipline to the vault and run Engine to match.";
    if (row.requirementType === "PROJECT_EXPERIENCE") return "Add a relevant project reference to the vault and run Engine to match.";
    if (row.requirementType === "FORM" || row.requirementType === "DECLARATION") return "Attach the official tender-issued form or declaration — do not generate.";
    return "Link vault evidence via 'Use vault evidence', or mark as not applicable with an audit note.";
  }
  if (row.supportLevel === "PARTIAL") return "Strengthen evidence: add more specific expert CVs or project references that address this requirement directly.";
  if (!row.hasSourceRef) return "Add source reference (page number or exact quote) so this requirement can be traced back to the tender document.";
  return "Requirement is covered. Verify evidence is marked REVIEWED.";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`req-coverage:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
      return NextResponse.json(
        { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true, userId: true },
    });
    if (!tender) {
      return NextResponse.json({ ok: false, error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });
    }

    const company = await prisma.company.findUnique({
      where: { userId: tender.userId },
      select: { id: true },
    });
    const finalPackageModel = await getFinalPackageReadinessModel(prisma, id, actor.id);

    const [requirements, vaultExperts, vaultProjects] = await Promise.all([
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
            select: {
              id: true,
              evidenceType: true,
              evidenceSource: true,
              evidenceReference: true,
              supportLevel: true,
            },
          },
        },
      }),
      company ? prisma.expert.findMany({
        where: { companyId: company.id, deletedAt: null },
        select: { ...VAULT_REVIEW_CONSUMER_SELECT.EXPERT, id: true },
        take: 50,
      }) : Promise.resolve([]),
      company ? prisma.project.findMany({
        where: { companyId: company.id, deletedAt: null },
        select: { ...VAULT_REVIEW_CONSUMER_SELECT.PROJECT, id: true },
        take: 50,
      }) : Promise.resolve([]),
    ]);

    const vaultEvidence: VaultEvidence[] = [
      // isReviewed drives whether the UI offers this record as linkable
      // evidence, so it must mean "generation can actually use this", not
      // "the label is literally REVIEWED". The raw comparison marked every
      // durably SOURCE_VERIFIED record unusable, hiding the entire vault from
      // a company whose evidence comes only from its own uploaded documents.
      ...vaultExperts.map((expert) => ({
        id: expert.id,
        name: expert.fullName ?? "Expert",
        type: "EXPERT" as const,
        isReviewed: canUseVaultRecord(expert as ReviewRecordState, "GENERATION"),
      })),
      ...vaultProjects.map((project) => ({
        id: project.id,
        name: project.name ?? "Project",
        type: "PROJECT" as const,
        isReviewed: canUseVaultRecord(project as ReviewRecordState, "GENERATION"),
      })),
    ];
    const canonicalStatuses = new Map(
      finalPackageModel.requirementEvidenceStatuses.map((status) => [
        status.requirementId,
        status,
      ]),
    );

    const rows: RequirementCoverageRow[] = requirements.map((requirement) => {
      const storedLinks: EvidenceLink[] = requirement.complianceMatrixRows.map((row) => ({
        id: row.id,
        evidenceType: row.evidenceType,
        evidenceSource: row.evidenceSource,
        evidenceReference: row.evidenceReference,
        supportLevel: row.supportLevel,
        autoLinked: false,
      }));
      const autoLinks = storedLinks.length === 0 ? buildAutoLinks(requirement, vaultEvidence) : [];
      const links = [...storedLinks, ...autoLinks];
      const effectiveLinks = links.filter((link) => !link.autoLinked || link.supportLevel !== "NONE");
      const supportLevel = deriveSupportLevel(effectiveLinks);
      const canonicalStatus = canonicalStatuses.get(requirement.id);
      const coverageStatus: CoverageStatus = canonicalStatus?.displayStatus ?? "NOT_MET";
      const hasSourceRef = canonicalStatus?.hasSourceTrace ?? false;
      const isFullyCovered = canonicalStatus?.displayStatus === "FULLY_MET";

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
        evidenceLinks: links,
        supportLevel,
        coverageStatus,
        isFullyCovered,
        nextAction: nextActionFor({
          supportLevel,
          hasSourceRef,
          coverageStatus,
          requirementType: requirement.requirementType,
          evidenceLinks: effectiveLinks,
        }),
      };
    });

    const totalMandatory = rows.length;
    const fullyCovered = rows.filter((row) => row.isFullyCovered).length;
    const partiallyCovered = rows.filter((row) => row.coverageStatus === "PARTIALLY_MET").length;
    const needsTrace = rows.filter((row) => row.coverageStatus === "NEEDS_TRACE").length;
    const uncovered = rows.filter((row) => row.coverageStatus === "NOT_MET").length;
    const missingSourceRef = rows.filter((row) => !row.hasSourceRef).length;
    const coverageRatio = totalMandatory > 0 ? fullyCovered / totalMandatory : 1;

    return NextResponse.json({
      ok: true,
      totalMandatory,
      fullyCovered,
      partiallyCovered,
      needsTrace,
      uncovered,
      missingSourceRef,
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
