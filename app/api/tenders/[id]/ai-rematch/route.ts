// AI Multi-Perspective Rematch endpoint (PR #255).
//
// POST /api/tenders/[id]/ai-rematch
//
// Re-scores the existing TenderExpertMatch / TenderProjectMatch rows
// using the multi-perspective AI matcher. Pre-filters with the lexical
// scores already computed by the engine, then sends the top 15 of each
// category to Claude for structured 4-perspective evaluation.
//
// Updates each match's score + rationale fields with the AI-derived
// values. Preserves existing isSelected state UNLESS the user passes
// `applySelections: true` in the body, in which case the AI's
// recommendSelection flag overrides existing selections.
//
// User-triggered (button on the matching dashboard). Each rematch
// runs 2 Claude calls (~$0.07 per tender). Wall time: 15-25 seconds.

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import {
  aiRematchExperts,
  aiRematchProjects,
  formatAssessmentRationale,
  type ExpertCandidateInput,
  type ProjectCandidateInput,
} from "../../../../../lib/engine/ai-multi-perspective-matcher";
import { logAction } from "../../../../../lib/audit";
import { childLogger, time, reportError } from "../../../../../lib/observability";

// 60s on Hobby — two parallel Claude calls inside this route. Pro
// users can override AI_PROPOSAL_TIMEOUT_MS for headroom.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// How many top-scored lexical candidates to send to Claude per category.
// 15 is the sweet spot: enough breadth to reorder meaningfully, small
// enough that the prompt + response fit comfortably in one call.
const PRE_FILTER_LIMIT = 15;

function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  const canRematch = ["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role);
  if (!canRematch) return forbiddenResponse();

  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as { applySelections?: boolean }));
  const applySelections = body.applySelections === true;

  await prismaReady;
  const log = childLogger({ tenderId, userId: actor.id, route: "/api/tenders/[id]/ai-rematch" });
  log.info("ai_rematch_started", { applySelections });

  // ─── Load context ────────────────────────────────────────────────────────
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    include: {
      requirements: { select: { title: true, description: true, requirementType: true, priority: true } },
      expertMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: {
          expert: {
            select: {
              id: true, fullName: true, title: true, yearsExperience: true,
              disciplines: true, sectors: true, certifications: true, profile: true, trustLevel: true,
            },
          },
        },
      },
      projectMatches: {
        orderBy: { score: "desc" },
        take: PRE_FILTER_LIMIT,
        include: {
          project: {
            select: {
              id: true, name: true, clientName: true, country: true, sector: true,
              serviceAreas: true, summary: true, contractValue: true, currency: true,
              startDate: true, endDate: true, trustLevel: true,
            },
          },
        },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  if (tender.expertMatches.length === 0 && tender.projectMatches.length === 0) {
    return NextResponse.json({
      error: "No matches to rematch. Run the tender engine first to produce initial lexical matches.",
      code: "NO_MATCHES",
    }, { status: 400 });
  }

  // ─── Build candidate inputs ──────────────────────────────────────────────
  const expertCandidates: ExpertCandidateInput[] = tender.expertMatches.map((m) => ({
    id: m.expert.id,
    fullName: m.expert.fullName,
    title: m.expert.title,
    yearsExperience: m.expert.yearsExperience,
    disciplines: safeParseJsonArray(m.expert.disciplines),
    sectors: safeParseJsonArray(m.expert.sectors),
    certifications: safeParseJsonArray(m.expert.certifications),
    profile: m.expert.profile,
    trustLevel: m.expert.trustLevel,
  }));

  const projectCandidates: ProjectCandidateInput[] = tender.projectMatches.map((m) => ({
    id: m.project.id,
    name: m.project.name,
    clientName: m.project.clientName,
    country: m.project.country,
    sector: m.project.sector,
    serviceAreas: safeParseJsonArray(m.project.serviceAreas),
    summary: m.project.summary,
    contractValue: m.project.contractValue,
    currency: m.project.currency,
    startDate: m.project.startDate,
    endDate: m.project.endDate,
    trustLevel: m.project.trustLevel,
  }));

  const tenderRequirementsText = tender.requirements
    .map((r) => `[${r.priority}] ${r.title}: ${r.description}`)
    .join("\n");

  // ─── Run both AI rematch passes IN PARALLEL ─────────────────────────────
  // Two Claude calls fire simultaneously (one per category). Total wall
  // time = max(experts, projects) ≈ 15-25s instead of 30-50s sequential.
  let expertBatch, projectBatch;
  try {
    [expertBatch, projectBatch] = await time("ai-rematch.parallel_calls", () => Promise.all([
      expertCandidates.length > 0
        ? aiRematchExperts({
            tenderTitle: tender.title,
            tenderRequirementsText,
            evaluationMethodology: tender.evaluationMethodology ?? "",
            candidates: expertCandidates,
          })
        : Promise.resolve(null),
      projectCandidates.length > 0
        ? aiRematchProjects({
            tenderTitle: tender.title,
            tenderRequirementsText,
            tenderCategory: tender.category,
            candidates: projectCandidates,
          })
        : Promise.resolve(null),
    ]), { tenderId });
  } catch (err) {
    void reportError(err, { tenderId, route: "/api/tenders/[id]/ai-rematch" });
    return NextResponse.json({
      error: err instanceof Error ? err.message : "AI rematch failed",
      code: "AI_REMATCH_FAILED",
    }, { status: 502 });
  }

  if (!expertBatch && !projectBatch) {
    return NextResponse.json({
      error: "AI rematch returned no usable assessments. Check Anthropic API key and rate limits, then retry.",
      code: "NO_ASSESSMENTS",
    }, { status: 502 });
  }

  // ─── Persist updates ─────────────────────────────────────────────────────
  // Update each TenderExpertMatch / TenderProjectMatch row with the
  // AI-derived score + multi-perspective rationale. Optionally update
  // isSelected based on Claude's recommendSelection flag.
  let expertsUpdated = 0;
  let projectsUpdated = 0;

  if (expertBatch) {
    for (const a of expertBatch.assessments) {
      const match = tender.expertMatches.find((m) => m.expert.id === a.candidateId);
      if (!match) continue;
      await prisma.tenderExpertMatch.update({
        where: { id: match.id },
        data: {
          score: a.overallScore,
          rationale: formatAssessmentRationale(a),
          ...(applySelections ? { isSelected: a.recommendSelection } : {}),
        },
      });
      expertsUpdated += 1;
    }
  }
  if (projectBatch) {
    for (const a of projectBatch.assessments) {
      const match = tender.projectMatches.find((m) => m.project.id === a.candidateId);
      if (!match) continue;
      await prisma.tenderProjectMatch.update({
        where: { id: match.id },
        data: {
          score: a.overallScore,
          rationale: formatAssessmentRationale(a),
          ...(applySelections ? { isSelected: a.recommendSelection } : {}),
        },
      });
      projectsUpdated += 1;
    }
  }

  await logAction({
    userId: actor.id,
    action: "AI_REMATCH_RUN",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} ran AI multi-perspective rematch on tender "${tender.title}" — ${expertsUpdated} expert(s) + ${projectsUpdated} project(s) re-scored${applySelections ? "; selections applied" : ""}`,
    metadata: { tenderId, expertsUpdated, projectsUpdated, applySelections },
  });

  log.info("ai_rematch_done", { expertsUpdated, projectsUpdated, applySelections });

  return NextResponse.json({
    success: true,
    expertsUpdated,
    projectsUpdated,
    applySelections,
    expertBatch,
    projectBatch,
  });
}
