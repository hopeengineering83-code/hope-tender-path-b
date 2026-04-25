import Anthropic from "@anthropic-ai/sdk";

const apiKey = process.env.ANTHROPIC_API_KEY;

function getClient() {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

export function isAIEnabled() {
  return Boolean(apiKey);
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
  // Raw source snippet from the document for traceability
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
  // Raw source snippet for traceability
  sourceSnippet: string;
};

// ─── Tender analysis ─────────────────────────────────────────────────────────

export async function analyzeWithAI(tenderContent: string): Promise<AIAnalysisResult> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a tender analysis engine. Extract structured information from tender documents. Return only valid JSON — no explanation, no markdown fences.",
    messages: [
      {
        role: "user",
        content: `Analyze this tender document and return a JSON object with this exact structure:
{
  "summary": "2-3 sentence executive summary",
  "requirements": [
    {
      "title": "short title",
      "description": "full requirement text",
      "requirementType": one of ["TECHNICAL","FINANCIAL","ELIGIBILITY","EXPERT","PROJECT_EXPERIENCE","FORMAT","SUBMISSION_RULE","DECLARATION","ANNEX","SCHEDULE","FORM"],
      "priority": one of ["MANDATORY","SCORED","INFORMATIONAL"],
      "exactFileName": "filename if explicitly named, else null",
      "requiredQuantity": number if specified else null,
      "pageLimit": page limit number if specified else null,
      "restrictions": "format/content restrictions or null",
      "sectionReference": "section number/name or null"
    }
  ],
  "exactFileNaming": ["exact filenames required"],
  "exactFileOrder": ["files in submission order if specified"],
  "evaluationMethodology": "how proposals will be scored",
  "submissionNotes": "key submission instructions"
}

TENDER DOCUMENT:
${tenderContent.slice(0, 12000)}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI returned invalid JSON for tender analysis");
  return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
}

// ─── CV / Expert extraction ───────────────────────────────────────────────────

/**
 * Uses Claude to parse raw CV/expert text and return structured expert records.
 * Each record includes a sourceSnippet for traceability — the exact text segment
 * from which the structured data was derived.
 */
export async function extractExpertsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedExpert[]> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a CV parsing engine for an engineering consultancy. Extract structured expert/staff profiles from document text. Return only valid JSON — no explanation.",
    messages: [
      {
        role: "user",
        content: `Parse the following document ("${documentName}") and extract all expert/staff profiles found.

Return a JSON array. Each element must have this structure:
{
  "fullName": "full name of the expert (required — omit record if name cannot be determined)",
  "title": "job title or proposed position, or null",
  "yearsExperience": integer years of experience or null,
  "disciplines": ["list of engineering/technical disciplines, e.g. Structural Engineering, Urban Planning"],
  "sectors": ["list of sectors, e.g. Healthcare, Government, Infrastructure"],
  "certifications": ["list of professional certifications, memberships, licences"],
  "profile": "1-3 sentence professional summary synthesised from the CV content",
  "sourceSnippet": "verbatim extract (max 500 chars) from the document that proves this person exists"
}

Rules:
- Only include people whose names appear clearly in the document
- Do NOT invent or guess any field — use null if uncertain
- disciplines and sectors must come from the document text, not assumptions
- sourceSnippet must be a direct quote from the input text

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 15000)}`,
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "[]";
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

/**
 * Uses Claude to parse raw project list / portfolio text and return structured
 * project records. Each record includes a sourceSnippet for traceability.
 */
export async function extractProjectsFromText(
  text: string,
  documentName: string,
): Promise<AIExtractedProject[]> {
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a project portfolio parser for an engineering consultancy. Extract structured project records from document text. Return only valid JSON — no explanation.",
    messages: [
      {
        role: "user",
        content: `Parse the following document ("${documentName}") and extract all completed/ongoing project records.

Return a JSON array. Each element must have this structure:
{
  "name": "project name (required — omit record if name cannot be determined)",
  "clientName": "client or employer name, or null",
  "country": "country where project is located, or null",
  "sector": "primary sector (e.g. Healthcare, Infrastructure, Government, Education), or null",
  "serviceAreas": ["list of services provided, e.g. Structural Engineering, Urban Planning, MEP"],
  "summary": "1-2 sentence description of the project and the firm's role",
  "contractValue": numeric contract/fee value or null (numbers only, no currency symbols),
  "currency": "currency code e.g. USD, ETB, EUR, or null",
  "sourceSnippet": "verbatim extract (max 500 chars) from the document proving this project"
}

Rules:
- Only include projects that clearly appear in the document
- Do NOT invent values — use null if uncertain
- contractValue must be a plain number (no commas, no symbols)
- sourceSnippet must be a direct quote from the input text

DOCUMENT TEXT (${text.length.toLocaleString()} chars):
${text.slice(0, 15000)}`,
      },
    ],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "[]";
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
  const client = getClient();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: "You are a professional bid writer for an engineering consultancy. Write formal, precise proposal content based only on the provided company information — never invent projects, staff, or certifications.",
    messages: [
      {
        role: "user",
        content: `Write a tender proposal for this opportunity.

TENDER: ${params.tenderTitle}
DESCRIPTION: ${params.tenderDescription}
KEY REQUIREMENTS: ${params.requirements}

COMPANY: ${params.companyName}
COMPANY PROFILE: ${params.companyProfile}
SERVICE LINES: ${params.serviceLines}

Write formal proposal content with sections:
1. Executive Summary
2. Understanding of Requirements
3. Technical Approach
4. Company Qualifications
5. Why Choose Us

Format with ## headings. Reference tender requirements directly. Use only the company information provided above.`,
      },
    ],
  });

  return message.content[0].type === "text" ? message.content[0].text : "";
}
