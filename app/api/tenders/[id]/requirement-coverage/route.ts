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

function deriveSupportLevel(links: EvidenceLink[]): SupportLevel {
  if (links.length === 0) return "NONE";
  const levels = links.map((l) => normalizeSupportLevel(l.supportLevel));
  if (levels.some((l) => l === "FULL")) return "FULL";
  if (levels.some((l) => l === "SUBSTANTIAL")) return "SUBSTANTIAL";
  if (levels.some((l) => l === "PARTIAL")) return "PARTIAL";
  return "NONE";
}

function nextActionFor(row: {
  supportLevel: SupportLevel;
  hasSourceRef: boolean;
  requirementType: string;
  evidenceLinks: EvidenceLink[];
}): string {
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
      select: { id: true },
    });
    if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

    const requirements = await prisma.tenderRequirement.findMany({
      where: { tenderId: id, priority: "MANDATORY" },
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
    });

    const rows: RequirementCoverageRow[] = requirements.map((req) => {
      const links: EvidenceLink[] = req.complianceMatrixRows.map((r) => ({
        id: r.id,
        evidenceType: r.evidenceType,
        evidenceSource: r.evidenceSource,
        evidenceReference: r.evidenceReference,
        supportLevel: r.supportLevel,
      }));
      const supportLevel = deriveSupportLevel(links);
      const hasSourceRef = Boolean(
        req.sectionReference || req.sourcePageNumber || req.sourceExactQuote || (req.sourceConfidence ?? 0) > 0,
      );
      const isFullyCovered = (supportLevel === "FULL" || supportLevel === "SUBSTANTIAL") && hasSourceRef;
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
        nextAction: nextActionFor({ supportLevel, hasSourceRef, requirementType: req.requirementType, evidenceLinks: links }),
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
