import { GoogleGenerativeAI } from "@google/generative-ai";
import { winningBenchmarkProfileText } from "./engine/winning-proposal-benchmark";

const apiKey = process.env.GEMINI_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const FALLBACK_GEMINI_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName = DEFAULT_GEMINI_MODEL) {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey);
}

function isModelUnavailableError(message: string): boolean {
  return /404|not found|not supported for generateContent|models\//i.test(message);
}

function uniqueModels(primary: string): string[] {
  return Array.from(new Set([primary, ...FALLBACK_GEMINI_MODELS]));
}

async function generate(prompt: string, modelName = DEFAULT_GEMINI_MODEL): Promise<string> {
  const errors: string[] = [];

  for (const candidateModel of uniqueModels(modelName || DEFAULT_GEMINI_MODEL)) {
    try {
      const model = getModel(candidateModel);
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      if (!text || text.trim().length === 0) throw new Error(`Empty response from Gemini API using ${candidateModel}`);
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidateModel}: ${msg}`);
      if (msg.includes("429")) throw new Error("Gemini API rate limit reached — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY")) throw new Error("Gemini API key invalid or missing");
      if (!isModelUnavailableError(msg)) throw err;
    }
  }

  throw new Error(`Gemini model unavailable. Tried ${uniqueModels(modelName || DEFAULT_GEMINI_MODEL).join(", ")}. Last errors: ${errors.join(" | ")}`);
}

// ─── Tender analysis types ────────────────────────────────────────────────────

export type AIRequirement = {
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  exactFileName?: string | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

export type AIAnalysisResult = {
  summary: string;
  requirements: AIRequirement[];
  exactFileNaming: string[];
  exactFileOrder: string[];
  evaluationMethodology: string;
  submissionNotes: string;
};

// ─── AI-extracted knowledge types ────────────────────────────────────────────

export type AIExtractedExpert = {
  fullName: string;
  title: string | null;
  yearsExperience: number | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
  profile: string;
  sourceSnippet: string;
};

export type AIExtractedProject = {
  name: string;
  clientName: string | null;
  country: string | null;
  sector: string | null;
  serviceAreas: string[];
  summary: string;
  contractValue: number | null;
  currency: string | null;
  sourceSnippet: string;
};

export type AIBidWriterInput = {
  tenderTitle: string;
  clientName: string;
  tenderText: string;
  analysisSummary: string;
  evaluationMethodology: string;
  submissionNotes: string;
  requirements: string;
  companyProfile: string;
  experts: string;
  projects: string;
  compliance: string;
  differentiators: string;
};

// ─── Tender analysis ─────────────────────────────────────────────────────────

export async function analyzeWithAI(tenderContent: string): Promise<AIAnalysisResult> {
  const trimmedTender = tenderContent.slice(0, 80_000);
  const prompt = `You are a 100-person senior tender board compressed into one analysis engine: lead bid manager, procurement lawyer, technical director, evaluator, document-control lead, and proposal writer.

Analyze the tender and return ONLY a valid JSON object — no explanation, no markdown fences.

Critical rules:
- Read the whole provided tender text. Do not stop at early contents pages.
- Do NOT convert table-of-contents entries, page numbers, clause numbers, scores, years, percentages, or page references into quantity requirements.
- Set requiredQuantity ONLY when the tender explicitly says minimum/required/at least/provide/submit a number of experts, CVs, projects, references, forms, copies, or documents.
- Do not create hundreds of line-by-line requirements. Consolidate repeated clauses into senior strategic requirement bundles.
- Separate hard submission rules from proposal-response sections. A methodology/technical approach requirement is something the proposal can write; it is not automatically missing evidence.
- Extract client, subject line, email recipients, no-financial-proposal rules, section structure, evaluation criteria, appendices, file names, and exact formatting instructions when present.
- Think like ChatGPT/Claude producing a winning proposal: identify what the proposal must SAY, what evidence must be APPENDED, and what the bid team must REVIEW.

JSON structure required:
{
  "summary": "3-5 sentence senior bid interpretation including client, assignment, main scope, response strategy, and top risks",
  "requirements": [
    {
      "title": "short strategic title",
      "description": "consolidated requirement text and why it matters for the proposal",
      "requirementType": "TECHNICAL|FINANCIAL|ELIGIBILITY|EXPERT|PROJECT_EXPERIENCE|FORMAT|SUBMISSION_RULE|DECLARATION|ANNEX|SCHEDULE|FORM|METHODOLOGY|COMPANY_PROFILE",
      "priority": "MANDATORY|SCORED|INFORMATIONAL",
      "exactFileName": "filename or null",
      "requiredQuantity": number_or_null,
      "pageLimit": number_or_null,
      "restrictions": "branding/signature/file/page/format restrictions or null",
      "sectionReference": "section/clause/annex reference or null"
    }
  ],
  "exactFileNaming": ["exact filenames required"],
  "exactFileOrder": ["files in submission order"],
  "evaluationMethodology": "evaluation criteria and how a proposal should answer them",
  "submissionNotes": "deadline, email/portal, subject line, financial proposal restrictions, appendices, and document-control notes"
}

TENDER DOCUMENT (${trimmedTender.length.toLocaleString()} chars):
${trimmedTender}`;

  const text = await generate(prompt, process.env.GEMINI_ANALYSIS_MODEL || DEFAULT_GEMINI_MODEL);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini returned no JSON object for tender analysis");
  try {
    return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
  } catch {
    throw new Error("Gemini returned malformed JSON for tender analysis");
  }
}

// ─── CV / Expert extraction ───────────────────────────────────────────────────

export async function extractExpertsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedExpert[]> {
  const prompt = `You are a CV parsing engine for an engineering consultancy. Parse the document "${documentName}" and extract all expert/staff profiles.

Return ONLY a valid JSON array — no explanation, no markdown. Each element:
{
  "fullName": "full name (required — omit record if unclear)",
  "title": "job title or null",
  "yearsExperience": integer_or_null,
  "disciplines": ["e.g. Structural Engineering, Urban Planning"],
  "sectors": ["e.g. Healthcare, Government, Infrastructure"],
  "certifications": ["professional certifications and memberships"],
  "profile": "1-3 sentence professional summary from CV content",
  "sourceSnippet": "verbatim extract ≤500 chars proving this person exists"
}

Rules: only include people clearly named in the document. Do NOT invent any field — use null if uncertain. sourceSnippet must be a direct quote.

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 60_000)}`;

  const raw = await generate(prompt, process.env.GEMINI_EXTRACTION_MODEL || "gemini-2.5-flash");
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AIExtractedExpert[]).filter(
      (e) => e && typeof e === "object" && typeof e.fullName === "string" && e.fullName.trim().length > 2,
    );
  } catch {
    console.warn("[extractExpertsFromText] JSON parse failed, returning empty");
    return [];
  }
}

// ─── Project / portfolio extraction ──────────────────────────────────────────

export async function extractProjectsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedProject[]> {
  const prompt = `You are a project portfolio parser for an engineering consultancy. Parse the document "${documentName}" and extract all project records.

Return ONLY a valid JSON array — no explanation, no markdown. Each element:
{
  "name": "project name (required — omit if unclear)",
  "clientName": "client name or null",
  "country": "country or null",
  "sector": "primary sector (Healthcare/Infrastructure/Government/Education/Industrial/Commercial) or null",
  "serviceAreas": ["services provided e.g. Structural Engineering, Urban Planning"],
  "summary": "1-2 sentence description of project and firm's role",
  "contractValue": number_or_null (plain number, no symbols),
  "currency": "USD|ETB|EUR|GBP|AED|SAR or null",
  "sourceSnippet": "verbatim extract ≤500 chars proving this project"
}

Rules: only include projects clearly in the document. Do NOT invent values. sourceSnippet must be a direct quote.

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 60_000)}`;

  const raw = await generate(prompt, process.env.GEMINI_EXTRACTION_MODEL || "gemini-2.5-flash");
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return (parsed as AIExtractedProject[]).filter(
      (p) => p && typeof p === "object" && typeof p.name === "string" && p.name.trim().length > 3,
    );
  } catch {
    console.warn("[extractProjectsFromText] JSON parse failed, returning empty");
    return [];
  }
}

// ─── Proposal generation ──────────────────────────────────────────────────────

export async function generateBenchmarkProposalWithAI(params: AIBidWriterInput): Promise<string> {
  const prompt = `You are ChatGPT-level senior proposal team for an engineering consultancy: bid director, sector technical lead, evaluator, procurement compliance reviewer, and persuasive technical writer.

Write a complete, winning-quality TECHNICAL PROPOSAL in markdown. Do NOT invent projects, experts, certifications, awards, or values. Use only the provided evidence. If evidence is insufficient, write a professional bid-team confirmation note inside the proposal instead of pretending the evidence exists.

REUSABLE PROPOSAL BENCHMARK PROFILE:
${winningBenchmarkProfileText()}

UPLOADED CHATGPT BENCHMARK STYLE TO MATCH:
- Open with direct comparable-project proof. The first page must not sound generic.
- Carry the strongest 1-2 project references through Cover Letter, Executive Summary and Relevant Experience.
- Use evidence-led claims: project name, client, location, value, services, scale, testimony/reference and relevance when available.
- Use the tender's response structure, especially Section A / Section B / Section C / Section D when the tender implies it.
- Section A must include company background, corporate information, core expertise, proposed team, team-to-project mapping and biomedical/specialist integration when relevant.
- Section B must include client references and project cards, not just generic paragraphs.
- Section C must be scope-by-scope and evaluator-facing, not a generic methodology.
- For healthcare tenders, explicitly cover facility identification, technical assessment, Emergency, OPD, In-patient, Laboratory, Imaging/Radiology, Pharmacy, clinical zoning, patient/staff/supply flow, IPC, radiation shielding, medical equipment loads, medical gas, ICT/telehealth, MEP coordination, regulatory approval, renovation oversight, close-out and QA.
- Where evidence is missing, write "Bid-team confirmation" controls instead of unsupported claims.

Benchmark standard:
- The result must read like a proposal prepared by an experienced human bid team, not a generic template.
- It must be client-specific, tender-aware, evidence-led, persuasive, and structured around the exact tender response logic.
- It must include a cover letter, cover page, table of contents, executive summary, company profile, proposed team, relevant experience, technical approach, compliance strategy, additional information, appendices list, and declaration.
- It must turn requirements into a proposal strategy: what we understand, why our evidence fits, how we will execute, and what the client gains.
- It must explicitly map selected experts and projects to the tender risks and evaluation criteria.
- It must include bid-team review items for any remaining evidence gaps instead of blocking the proposal.
- It must not include financial offer language if submission notes say technical proposal only or no financial proposal.
- It must avoid AI disclaimers and placeholders.
- Use markdown headings: #, ##, ### and bullet lists. Use compact markdown tables where they improve evaluator readability.
- Do not repeat the same heading twice. Merge duplicate ideas into the first relevant section.
- Do not create internal debug, score, audit, repair, or benchmark-review sections. Write only client-facing proposal content and bid-team confirmation controls.

TENDER TITLE:
${params.tenderTitle}

CLIENT:
${params.clientName}

TENDER TEXT / SCOPE EXTRACT:
${params.tenderText.slice(0, 50_000)}

AI ANALYSIS SUMMARY:
${params.analysisSummary}

EVALUATION METHODOLOGY / CRITERIA:
${params.evaluationMethodology}

SUBMISSION NOTES:
${params.submissionNotes}

CONSOLIDATED REQUIREMENTS:
${params.requirements.slice(0, 22_000)}

COMPANY PROFILE AND SUPPORT DOCUMENT EVIDENCE:
${params.companyProfile.slice(0, 16_000)}

SELECTED / BEST EXPERT EVIDENCE:
${params.experts.slice(0, 16_000)}

SELECTED / BEST PROJECT EVIDENCE:
${params.projects.slice(0, 16_000)}

COMPLIANCE MATRIX / GAPS / REVIEW ITEMS:
${params.compliance.slice(0, 14_000)}

DIFFERENTIATORS TO USE:
${params.differentiators}

Before writing, silently choose the top two project references and the strongest proposed team. Then write the proposal so those selected proof points appear repeatedly and consistently across the document.`;

  return generate(prompt, process.env.GEMINI_PROPOSAL_MODEL || DEFAULT_GEMINI_MODEL);
}

export async function generateProposal(params: {
  tenderTitle: string;
  tenderDescription: string;
  requirements: string;
  companyName: string;
  companyProfile: string;
  serviceLines: string;
}): Promise<string> {
  const prompt = `You are a professional bid writer for an engineering consultancy. Write formal proposal content based ONLY on the provided company information — never invent projects, staff, or certifications.

TENDER: ${params.tenderTitle}
DESCRIPTION: ${params.tenderDescription}
KEY REQUIREMENTS: ${params.requirements}

COMPANY: ${params.companyName}
COMPANY PROFILE: ${params.companyProfile}
SERVICE LINES: ${params.serviceLines}

Write a formal proposal with these sections (use ## headings):
## Executive Summary
## Understanding of Requirements
## Technical Approach
## Company Qualifications
## Why Choose Us

Reference tender requirements directly. Use only the company information provided above.`;

  return generate(prompt, process.env.GEMINI_PROPOSAL_MODEL || DEFAULT_GEMINI_MODEL);
}
