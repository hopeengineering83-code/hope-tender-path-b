import { generateWithFallback } from "../ai";

export type TenderCopilotContext = {
  tenderTitle: string;
  tenderSummary: string;
  requirements: string[];
  complianceGaps: string[];
  selectedExperts: string[];
  selectedProjects: string[];
  generatedDocuments: string[];
  controls: string[];
  recentAudit: string[];
};

export type TenderCopilotResponse = {
  answer: string;
  recommendations: string[];
  evidenceReferences: string[];
  risks: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  nextActions: Array<{ title: string; owner: "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT"; priority: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You are Tender AI Copilot: a senior bid director, procurement reviewer, commercial reviewer, and proposal strategist.

Use only the supplied tender context. Relate requirements, compliance gaps, selected experts, selected projects, generated documents, controls, and audit events. Be practical and give owners/actions.

Return ONLY valid JSON:
{
  "answer": "direct answer in 3-8 concise paragraphs",
  "recommendations": ["specific recommendation"],
  "evidenceReferences": ["Requirement / Compliance gap / Selected expert / Selected project / Generated document / Audit item used"],
  "risks": [{ "title": "risk", "severity": "HIGH" | "MEDIUM" | "LOW", "detail": "why it matters" }],
  "nextActions": [{ "title": "action", "owner": "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT", "priority": "HIGH" | "MEDIUM" | "LOW", "detail": "exact next step" }],
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`;

function buildContextText(context: TenderCopilotContext): string {
  return [
    `Tender: ${context.tenderTitle}`,
    `Summary: ${context.tenderSummary}`,
    "\nRequirements:",
    ...(context.requirements.length ? context.requirements.map((x) => `- ${x}`) : ["- None available"]),
    "\nCompliance gaps:",
    ...(context.complianceGaps.length ? context.complianceGaps.map((x) => `- ${x}`) : ["- None open"]),
    "\nSelected experts:",
    ...(context.selectedExperts.length ? context.selectedExperts.map((x) => `- ${x}`) : ["- None selected"]),
    "\nSelected projects:",
    ...(context.selectedProjects.length ? context.selectedProjects.map((x) => `- ${x}`) : ["- None selected"]),
    "\nGenerated documents:",
    ...(context.generatedDocuments.length ? context.generatedDocuments.map((x) => `- ${x}`) : ["- None generated"]),
    "\nTender controls:",
    ...(context.controls.length ? context.controls.map((x) => `- ${x}`) : ["- None recorded"]),
    "\nRecent audit:",
    ...(context.recentAudit.length ? context.recentAudit.map((x) => `- ${x}`) : ["- None available"]),
  ].join("\n").slice(0, 45_000);
}

function parseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
}

function severity(value: unknown): "HIGH" | "MEDIUM" | "LOW" {
  return (["HIGH", "MEDIUM", "LOW"].includes(value as string) ? value : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW";
}

function owner(value: unknown): "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT" {
  return (["TECHNICAL", "COMPLIANCE", "COMMERCIAL", "PROPOSAL", "MANAGEMENT"].includes(value as string) ? value : "PROPOSAL") as "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT";
}

function confidence(value: unknown): "HIGH" | "MEDIUM" | "LOW" {
  return (["HIGH", "MEDIUM", "LOW"].includes(value as string) ? value : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW";
}

export async function answerTenderCopilotQuestion(input: { question: string; context: TenderCopilotContext }): Promise<TenderCopilotResponse> {
  const question = input.question.trim();
  if (question.length < 3) throw new Error("Question must be at least 3 characters.");
  const prompt = `TENDER CONTEXT\n${buildContextText(input.context)}\n\nUSER QUESTION\n${question}\n\nAnswer as Tender AI Copilot using the required JSON shape.`;
  const raw = await generateWithFallback(prompt, { systemPrompt: SYSTEM_PROMPT });
  const parsed = parseJson(raw);
  if (!parsed) throw new Error("AI copilot returned malformed JSON. Retry the question.");

  const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).filter(Boolean).slice(0, 8) : [];
  const evidenceReferences = Array.isArray(parsed.evidenceReferences) ? parsed.evidenceReferences.map(String).filter(Boolean).slice(0, 10) : [];
  const risks = Array.isArray(parsed.risks)
    ? (parsed.risks as Array<Record<string, unknown>>).map((risk) => ({
        title: typeof risk.title === "string" ? risk.title.slice(0, 140) : "Risk",
        severity: severity(risk.severity),
        detail: typeof risk.detail === "string" ? risk.detail.slice(0, 600) : "",
      })).slice(0, 8)
    : [];
  const nextActions = Array.isArray(parsed.nextActions)
    ? (parsed.nextActions as Array<Record<string, unknown>>).map((action) => ({
        title: typeof action.title === "string" ? action.title.slice(0, 160) : "Action",
        owner: owner(action.owner),
        priority: severity(action.priority),
        detail: typeof action.detail === "string" ? action.detail.slice(0, 700) : "",
      })).slice(0, 10)
    : [];

  return { answer: typeof parsed.answer === "string" ? parsed.answer.slice(0, 4_000) : "No answer returned.", recommendations, evidenceReferences, risks, nextActions, confidence: confidence(parsed.confidence) };
}
