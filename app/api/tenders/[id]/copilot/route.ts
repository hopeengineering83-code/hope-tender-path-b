import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { answerTenderCopilotQuestion } from "../../../../../lib/engine/tender-ai-copilot";
import { logAction } from "../../../../../lib/audit";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function short(value: string | null | undefined, max = 420): string {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  const body = await req.json().catch(() => ({} as { question?: string }));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3) return NextResponse.json({ error: "Question must be at least 3 characters." }, { status: 400 });

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { createdAt: "desc" } },
      expertMatches: { where: { isSelected: true }, include: { expert: true }, orderBy: { score: "desc" } },
      projectMatches: { where: { isSelected: true }, include: { project: true }, orderBy: { score: "desc" } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, orderBy: { exactOrder: "asc" } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const recentAudit = await prisma.auditLog.findMany({
    where: { entityType: "Tender", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const controls = recentAudit
    .filter((log) => log.action.startsWith("TENDER_CONTROL_"))
    .map((log) => `${log.action}: ${short(log.description, 300)}`)
    .slice(0, 15);

  let response;
  try {
    response = await answerTenderCopilotQuestion({
      question,
      context: {
        tenderTitle: tender.title,
        tenderSummary: [
          tender.analysisSummary ? `Analysis: ${short(tender.analysisSummary, 900)}` : null,
          tender.evaluationMethodology ? `Evaluation: ${short(tender.evaluationMethodology, 900)}` : null,
          tender.notes ? `Notes: ${short(tender.notes, 900)}` : null,
          `Status=${tender.status}, stage=${tender.stage}, readiness=${Math.round(tender.readinessScore ?? 0)}/100`,
        ].filter(Boolean).join("\n"),
        requirements: tender.requirements.map((req) => `[${req.priority}] ${req.requirementType}: ${req.title} — ${short(req.description, 360)}`),
        complianceGaps: tender.complianceGaps.map((gap) => `[${gap.severity}] ${gap.title} — ${short(gap.description, 360)}${gap.mitigationPlan ? ` | Mitigation: ${short(gap.mitigationPlan, 220)}` : ""}`),
        selectedExperts: tender.expertMatches.map((match) => `${match.expert.fullName}${match.expert.title ? ` — ${match.expert.title}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.expert.trustLevel}; rationale=${short(match.rationale, 360)}; profile=${short(match.expert.profile, 240)}`),
        selectedProjects: tender.projectMatches.map((match) => `${match.project.name}${match.project.clientName ? ` — ${match.project.clientName}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.project.trustLevel}; rationale=${short(match.rationale, 360)}; summary=${short(match.project.summary, 260)}`),
        generatedDocuments: tender.generatedDocuments.map((doc) => `${doc.name} (${doc.documentType}) generation=${doc.generationStatus}, validation=${doc.validationStatus}, review=${doc.reviewStatus}; ${short(doc.contentSummary, 320)}`),
        controls,
        recentAudit: recentAudit.map((log) => `${log.action}: ${short(log.description, 360)}`),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Copilot AI call failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  await logAction({
    userId: actor.id,
    action: "TENDER_COPILOT_QUESTION",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} asked Tender AI Copilot: ${short(question, 180)}`,
    metadata: { tenderId: id, question, confidence: response.confidence, riskCount: response.risks.length, actionCount: response.nextActions.length },
  });

  return NextResponse.json({ success: true, response });
}
