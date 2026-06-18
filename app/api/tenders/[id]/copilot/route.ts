import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { answerTenderCopilotQuestion } from "../../../../../lib/engine/tender-ai-copilot";
import { buildEvidenceGraph } from "../../../../../lib/evidence-graph";
import { logAction } from "../../../../../lib/audit";
import { rateLimitPersistent, AI_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../lib/sanitize-error";

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

  const rl = await rateLimitPersistent(`copilot:${actor.id}`, AI_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json({ error: "Too many requests", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null) as { question?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3) return NextResponse.json({ error: "Question must be at least 3 characters." }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: "Question must be 2000 characters or fewer." }, { status: 400 });

  await prismaReady;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: { orderBy: { createdAt: "asc" } },
      complianceGaps: { where: { isResolved: false }, orderBy: { createdAt: "desc" }, select: { severity: true, title: true, description: true, mitigationPlan: true } },
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

  const company = await prisma.company.findFirst({ where: { userId: actor.id }, select: { id: true } });
  const evidenceGraph = await buildEvidenceGraph(id, company?.id ?? null);

  const gateWarnings: string[] = [];
  if (tender.requirements.length === 0) {
    gateWarnings.push("NO_REQUIREMENTS: No tender requirements have been extracted yet. Do not give specific compliance or bid advice — instruct the user to run AI Analyze first.");
  }
  if (!(tender as { clientName?: string | null }).clientName) {
    gateWarnings.push("MISSING_CLIENT: Procuring entity / client name has not been extracted or confirmed. Do not assume a client name — instruct the user to run AI Analyze or enter it manually.");
  }
  const unresolvedCritical = tender.complianceGaps.filter((gap) => gap.severity === "CRITICAL").length;
  if (unresolvedCritical > 0) {
    gateWarnings.push(`CRITICAL_COMPLIANCE_GAPS: ${unresolvedCritical} unresolved CRITICAL compliance gap(s) exist. Flag these prominently in your answer and recommend immediate remediation before proceeding.`);
  }
  const extractionStatus = (tender as { analysisExtractionStatus?: string | null }).analysisExtractionStatus;
  if (extractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION" || extractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED") {
    gateWarnings.push(`WEAK_EXTRACTION: Tender analysis used fallback/weak extraction (${extractionStatus}). Treat all extracted requirements and metadata as potentially incomplete. Recommend re-running AI Analyze after OCR extraction.`);
  } else if (extractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") {
    gateWarnings.push("EXTRACTION_CORRUPTED: Tender file extraction is corrupted; AI Analyze was skipped. The copilot has very limited context — instruct the user to re-upload or run OCR before asking bid strategy questions.");
  }

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
        requirements: tender.requirements.map((requirement) => `[${requirement.priority}] ${requirement.requirementType}: ${requirement.title} — ${short(requirement.description, 360)}`),
        complianceGaps: tender.complianceGaps.map((gap) => `[${gap.severity}] ${gap.title} — ${short(gap.description, 360)}${gap.mitigationPlan ? ` | Mitigation: ${short(gap.mitigationPlan, 220)}` : ""}`),
        selectedExperts: tender.expertMatches.map((match) => `${match.expert.fullName}${match.expert.title ? ` — ${match.expert.title}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.expert.trustLevel}; rationale=${short(match.rationale, 360)}; profile=${short(match.expert.profile, 240)}`),
        selectedProjects: tender.projectMatches.map((match) => `${match.project.name}${match.project.clientName ? ` — ${match.project.clientName}` : ""}; score=${Math.round(match.score * 100)}%; trust=${match.project.trustLevel}; rationale=${short(match.rationale, 360)}; summary=${short(match.project.summary, 260)}`),
        generatedDocuments: tender.generatedDocuments.map((document) => `${document.name} (${document.documentType}) generation=${document.generationStatus}, validation=${document.validationStatus}, review=${document.reviewStatus}; ${short(document.contentSummary, 320)}`),
        controls,
        recentAudit: recentAudit.map((entry) => `${entry.action}: ${short(entry.description, 360)}`),
        gateWarnings: gateWarnings.length > 0 ? gateWarnings : undefined,
      },
    });
  } catch (error) {
    console.error(`[copilot] AI request failed for tender ${id}: ${sanitizeError(error)}`);
    return NextResponse.json({ error: "Copilot AI request failed. Retry or review provider configuration." }, { status: 502 });
  }

  await logAction({
    userId: actor.id,
    action: "TENDER_COPILOT_QUESTION",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} asked Tender AI Copilot: ${short(question, 180)}`,
    metadata: { tenderId: id, question, confidence: response.confidence, riskCount: response.risks.length, actionCount: response.nextActions.length, verifiedEvidenceCount: response.evidenceUsed.length, droppedEvidenceCount: response.evidenceDropped?.length ?? 0, gateWarningCount: gateWarnings.length },
  });

  try {
    const citations = response.evidenceUsed.length > 0
      ? response.evidenceUsed.map((evidence) => ({
          page: (evidence as { page?: number }).page ?? null,
          quote: (evidence as { snippet?: string }).snippet ?? null,
          field: evidence.id,
        }))
      : null;

    await prisma.tenderCopilotMessage.createMany({
      data: [
        { tenderId: id, userId: actor.id, role: "user", content: question, citations: Prisma.JsonNull },
        { tenderId: id, userId: actor.id, role: "assistant", content: response.answer, citations: citations !== null ? (citations as Prisma.InputJsonValue) : Prisma.JsonNull },
      ],
    });
  } catch (error) {
    console.warn("[copilot] Failed to persist chat history — answer still returned:", sanitizeError(error));
  }

  return NextResponse.json({ success: true, response });
}
