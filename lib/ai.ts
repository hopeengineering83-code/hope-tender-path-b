import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName = "gemini-1.5-pro") {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey);
}

async function generate(prompt: string, modelName = "gemini-1.5-pro"): Promise<string> {
  const model = getModel(modelName);
  const result = await model.generateContent(prompt);
  return result.response.text();
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

// ─── Tender analysis ─────────────────────────────────────────────────────────

export async function analyzeWithAI(tenderContent: string): Promise<AIAnalysisResult> {
  const prompt = `You are a tender analysis engine. Analyze this tender document and return ONLY a valid JSON object — no explanation, no markdown fences.

JSON structure required:
{
  "summary": "2-3 sentence executive summary",
  "requirements": [
    {
      "title": "short title",
      "description": "full requirement text",
      "requirementType": "TECHNICAL|FINANCIAL|ELIGIBILITY|EXPERT|PROJECT_EXPERIENCE|FORMAT|SUBMISSION_RULE|DECLARATION|ANNEX|SCHEDULE|FORM",
      "priority": "MANDATORY|SCORED|INFORMATIONAL",
      "exactFileName": "filename or null",
      "requiredQuantity": number_or_null,
      "pageLimit": number_or_null,
      "restrictions": "restrictions or null",
      "sectionReference": "section ref or null"
    }
  ],
  "exactFileNaming": ["exact filenames required"],
  "exactFileOrder": ["files in submission order"],
  "evaluationMethodology": "scoring methodology",
  "submissionNotes": "submission instructions"
}

TENDER DOCUMENT:
${tenderContent.slice(0, 15000)}`;

  const text = await generate(prompt);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini returned invalid JSON for tender analysis");
  return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
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
${text.slice(0, 20000)}`;

  const raw = await generate(prompt);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as AIExtractedExpert[];
    return parsed.filter((e) => e.fullName && typeof e.fullName === "string" && e.fullName.trim().length > 2);
  } catch {
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
${text.slice(0, 20000)}`;

  const raw = await generate(prompt);
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as AIExtractedProject[];
    return parsed.filter((p) => p.name && typeof p.name === "string" && p.name.trim().length > 3);
  } catch {
    return [];
  }
}

// ─── Proposal generation ──────────────────────────────────────────────────────

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

  return generate(prompt, "gemini-1.5-pro");
}
