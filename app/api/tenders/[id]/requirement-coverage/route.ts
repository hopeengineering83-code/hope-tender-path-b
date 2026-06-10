// GET /api/tenders/[id]/requirement-coverage
//
// Returns per-requirement mandatory coverage: title, type, source reference,
// support level, linked evidence rows, and recommended next action.
//
// Used by the Mandatory Requirement Coverage panel on the tender detail page.
// Only surfaces MANDATORY requirements — advisory/optional ones are out of scope.
//
// Auth: ADMIN, PROPOSAL_MANAGER, REVIEWER
// Rate: API_RATE_LIMIT (read-only)

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../lib/sanitize-error";
import { normalizeSupportLevel } from "../../../../../lib/engine/requirement-evidence-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type SupportLevel = "FULL" | "SUBSTANTIAL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE";

type EvidenceLink = {
  id: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | null;
  supportLevel: string;
  autoLinked?: boolean; // true = derived from vault match, not a stored compliance row
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
  isFullyCovered: boolean;
  nextAction: string;
};

// ── Auto-linking category keywords ──────────────────────────────────────────

const PERSONNEL_KEYWORDS = /personnel|team|expert|staffing|key personnel|staff|workforce|human resource/i;
const EXPERIENCE_KEYWORDS = /experience|references|similar projects|track record|past performance|portfolio/i;
const COMPANY_KEYWORDS = /company profile|organization|legal entity|firm profile|corporate profile/i;
const FINANCIAL_KEYWORDS = /financial capacity|turnover|audited statements|financial statements|annual revenue|bank/i;

// Returns a support level for auto-linked evidence.
// REVIEWED evidence → PARTIAL (display only, not final — user must confirm).
// UNREVIEWED evidence → cannot count toward coverage per constraints.
function autoLinkSupportLevel(isReviewed: boolean): SupportLevel {
  return isReviewed ? "PARTIAL" : "NONE";
}

type VaultEvidence = {
  id: string;
  name: string;
  type: "EXPERT" | "PROJECT" | "COMPANY" | "FINANCIAL";
  isReviewed: boolean;
};

function buildAutoLinks(
  req: { id: string; title: string; requirementType: string },
  vault: VaultEvidence[],
): EvidenceLink[] {
  const title = req.title.toLowerCase();
  const autoLinks: EvidenceLink[] = [];

  for (const v of vault) {
    if (!v.isReviewed) continue; // only REVIEWED vault items can be auto-linked (even partially)

    let matches = false;
    if (v.type === "EXPERT" && (PERSONNEL_KEYWORDS.test(title) || req.requirementType === "EXPERT")) matches = true;
    if (v.type === "PROJECT" && (EXPERIENCE_KEYWORDS.test(title) || req.requirementType === "PROJECT_EXPERIENCE")) matches = true;
    if (v.type === "COMPANY" && COMPANY_KEYWORDS.test(title)) matches = true;
    if (v.type === "FINANCIAL" && FINANCIAL_KEYWORDS.test(title)) matches = true;

    if (matches) {
      autoLinks.push({
        id: `auto-${v.id}-${req.id}`,
        evidenceType: v.type,
        evidenceSource: "VAULT_AUTO_LINK",
        evidenceReference: v.name,
        supportLevel: "PARTIAL", // auto-links are at most PARTIAL; user must confirm for FULL
        autoLinked: true,
      });
    }
  }

  return autoLinks;
}

function deriveSupportLevel(links: EvidenceLink[]): SupportLevel {
  if (links.length === 0) return "NONE";
  const levels = links.map((l) => normalizeSupportLevel(l.supportLevel));
  if (levels.some((l) => l === "FULL")) return "FULL";
  if (levels.some((l) => l === "SUBSTANTIAL")) return "SUBSTANTIAL";
  if (levels.some((l) => l === "PARTIAL")) return "PARTIAL";
  if (levels.some((l) => l === "NOT_APPLICABLE")) return "NOT_APPLICABLE";
  return "NONE";
}

function nextActionFor(row: {
  supportLevel: SupportLevel;
  hasSourceRef: boolean;
  requirementType: string;
  evidenceLinks: EvidenceLink[];
}): string {
  if (row.supportLevel === "NOT_APPLICABLE") return "Requirement marked not applicable by reviewer. Keep the audit note for export review.";
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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`req-coverage:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: { id: true, userId: true },
    });
    if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

    // Find the company for this user to look up vault evidence
    const company = await prisma.company.findUnique({
      where: { userId: tender.userId },
      select: { id: true },
    });

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
      // Load reviewed experts for auto-linking (company-scoped)
      company ? prisma.expert.findMany({
        where: { companyId: company.id, deletedAt: null },
        select: { id: true, fullName: true, trustLevel: true },
        take: 50,
      }) : Promise.resolve([]),
      // Load reviewed projects for auto-linking (company-scoped)
      company ? prisma.project.findMany({
        where: { companyId: company.id, deletedAt: null },
        select: { id: true, name: true, trustLevel: true },
        take: 50,
      }) : Promise.resolve([]),
    ]);

    // Build vault evidence list for auto-linking (display only)
    const vaultEvidence: VaultEvidence[] = [
      ...vaultExperts.map((e) => ({
        id: e.id,
        name: e.fullName ?? "Expert",
        type: "EXPERT" as const,
        isReviewed: e.trustLevel === "REVIEWED",
      })),
      ...vaultProjects.map((p) => ({
        id: p.id,
        name: p.name ?? "Project",
        type: "PROJECT" as const,
        isReviewed: p.trustLevel === "REVIEWED",
      })),
    ];

    const rows: RequirementCoverageRow[] = requirements.map((req) => {
      const storedLinks: EvidenceLink[] = req.complianceMatrixRows.map((r) => ({
        id: r.id,
        evidenceType: r.evidenceType,
        evidenceSource: r.evidenceSource,
        evidenceReference: r.evidenceReference,
        supportLevel: r.supportLevel,
        autoLinked: false,
      }));

      // Auto-link reviewed vault evidence for display (at most PARTIAL, user must confirm for FULL)
      // Only add auto-links when there are no stored compliance matrix rows for this requirement
      const autoLinks = storedLinks.length === 0
        ? buildAutoLinks(req, vaultEvidence)
        : [];

      const links = [...storedLinks, ...autoLinks];
      // Auto-linked evidence from unreviewed sources cannot count toward coverage;
      // stored rows reflect actual user-confirmed links.
      const effectiveLinks = links.filter((l) => !l.autoLinked || l.supportLevel !== "NONE");
      const supportLevel = deriveSupportLevel(effectiveLinks);
      const hasSourceRef = Boolean(
        req.sectionReference || req.sourcePageNumber || req.sourceExactQuote || (req.sourceConfidence ?? 0) > 0,
      );
      // Auto-linked evidence cannot make a requirement isFullyCovered — user must confirm
      const hasOnlyAutoLinks = storedLinks.length === 0 && autoLinks.length > 0;
      const isFullyCovered = supportLevel === "NOT_APPLICABLE" || (!hasOnlyAutoLinks && (supportLevel === "FULL" || supportLevel === "SUBSTANTIAL") && hasSourceRef);
      return {
        id: req.id,
        title: req.title,
        requirementType: req.requirementType,
        priority: req.priority,
        sectionReference: req.sectionReference,
        sourcePageNumber: req.sourcePageNumber,
        sourceSectionHeading: req.sourceSectionHeading,
        sourceExactQuote: req.sourceExactQuote,
        sourceConfidence: req.sourceConfidence ?? 0,
        hasSourceRef,
        evidenceLinks: links,
        supportLevel,
        isFullyCovered,
        nextAction: nextActionFor({ supportLevel, hasSourceRef, requirementType: req.requirementType, evidenceLinks: effectiveLinks }),
      };
    });

    const totalMandatory = rows.length;
    const fullyCovered = rows.filter((r) => r.isFullyCovered).length;
    const partiallyCovered = rows.filter((r) => r.supportLevel === "PARTIAL" || r.supportLevel === "SUBSTANTIAL").length;
    const uncovered = rows.filter((r) => r.supportLevel === "NONE").length;
    const missingSourceRef = rows.filter((r) => !r.hasSourceRef).length;
    const coverageRatio = totalMandatory > 0 ? fullyCovered / totalMandatory : 1;

    return NextResponse.json({
      ok: true,
      totalMandatory,
      fullyCovered,
      partiallyCovered,
      uncovered,
      missingSourceRef,
      coverageRatio,
      rows,
    });
  } catch (error) {
    console.error("requirement-coverage GET failed", error);
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
