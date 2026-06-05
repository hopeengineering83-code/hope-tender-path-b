import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { answerTenderCopilotQuestion } from "../../../../../lib/engine/tender-ai-copilot";
import { buildEvidenceGraph } from "../../../../../lib/evidence-graph";
import { logAction } from "../../../../../lib/audit";
import { rateLimit, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";

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

  const rl = rateLimit(`copilot:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id } = await params;
  const body = await req.json().catch(() => ({} as { question?: string }));
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3) return NextResponse.json({ error: "Question must be at least 3 characters." }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: "Question must be 2000 characters or fewer." }, { status: 400 });

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

  // PR XX-G2 — build the evidence graph once and pass to the Copilot.
  // The Copilot returns evidenceIds that the server filters against the
  // graph; hallucinated IDs are dropped before responses leave the box.
  const company = await prisma.company.findFirst({ where: { userId: actor.id }, select: { id: true } });
  const evidenceGraph = await buildEvidenceGraph(id, company?.id ?? null);

  let response;
  try {
    response = await answerTenderCopilotQuestion({
      question,
      evidenceGraph,
      context: {
        tenderTitle: tender.title,
        tenderSummary: [
          tender.analysisSummary ? `Analysis: ${short(tender.analysisSummary, 900)}` : null,
          tender.evaluationMethodology ? `Evaluation: ${short(tender.evaluationMethodology, 900)}` : null,
          tender.notes ? `Notes: ${short(tender.notes, 900)}` : null,
          `Status=${tender.status}, stage=${tender.stage}, workflowProgress=${Math.round(tender.readinessScore ?? 0)}/100`,
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
    metadata: { tenderId: id, question, confidence: response.confidence, riskCount: response.risks.length, actionCount: response.nextActions.length, verifiedEvidenceCount: response.evidenceUsed.length, droppedEvidenceCount: response.evidenceDropped?.length ?? 0 },
  });

  // Persist the conversation turn. Failures are non-blocking — the answer is
  // always returned even if the DB write fails (e.g. cold-start lag, migration
  // not yet applied on the current environment).
  try {
    // Build a compact citations array from the verified evidence nodes.
    const citations = response.evidenceUsed.length > 0
      ? response.evidenceUsed.map((ev) => ({
          page: (ev as { page?: number }).page ?? null,
          quote: (ev as { snippet?: string }).snippet ?? null,
          field: ev.id,
        }))
      : null;

    await prisma.tenderCopilotMessage.createMany({
      data: [
        {
          tenderId: id,
          userId: actor.id,
          role: "user",
          content: question,
          citations: Prisma.JsonNull,
        },
        {
          tenderId: id,
          userId: actor.id,
          role: "assistant",
          content: response.answer,
          citations: citations !== null ? (citations as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      ],
    });
  } catch (saveErr) {
    console.warn("[copilot] Failed to persist chat history — answer still returned:", saveErr instanceof Error ? saveErr.message : saveErr);
  }

  return NextResponse.json({ success: true, response });
}
