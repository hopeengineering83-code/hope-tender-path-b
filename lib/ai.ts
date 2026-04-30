// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// gemini-2.0-flash: fast, long-context, cost-efficient — used for all AI calls.
// gemini-1.5-pro: legacy fallback if 2.0-flash is unavailable.
const PRIMARY_MODEL = "gemini-2.0-flash";
const FALLBACK_MODEL = "gemini-1.5-pro";
const GENERATION_MODEL = PRIMARY_MODEL;

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName: string) {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey);
}

async function generate(prompt: string, modelName = PRIMARY_MODEL): Promise<string> {
  const tryModel = async (name: string): Promise<string> => {
    const model = getModel(name);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text || text.trim().length === 0) throw new Error("Empty response from Gemini API");
    return text;
  };

  try {
    return await tryModel(modelName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429")) throw new Error("Gemini API rate limit reached — try again in a moment");
    if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
      throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
    // Model unavailable — try the legacy fallback once
    if (msg.includes("404") || msg.includes("not found") || msg.includes("deprecated") || msg.includes("not supported")) {
      try {
        return await tryModel(modelName === PRIMARY_MODEL ? FALLBACK_MODEL : PRIMARY_MODEL);
      } catch (fallbackErr) {
        const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        if (fallbackMsg.includes("429")) throw new Error("Gemini API rate limit reached — try again in a moment");
        throw fallbackErr;
      }
    }
    throw err;
  }
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
  const prompt = `You are a 100-person senior tender board compressed into one analysis engine: lead bid manager, procurement lawyer, technical director, evaluator, document-control lead, and proposal writer. You have evaluated thousands of tenders for World Bank, UNDP, government, and private-sector clients.

Analyze the tender and return ONLY a valid JSON object — no explanation, no markdown fences, no code blocks.

## ANALYSIS PROCESS (think step by step before writing JSON):
Step 1 — Identify: client name, tender title, tender reference, deadline, submission method, email recipients, exact subject line required, country/location.
Step 2 — Detect: is financial proposal excluded? Is this technical-only? Are there shortlisting stages?
Step 3 — Extract SECTIONS: what sections must the proposal contain (Company Profile, Relevant Experience, Technical Approach, Additional Information, etc.)?
Step 4 — Extract EVALUATION CRITERIA: what will evaluators score and how?
Step 5 — Extract QUALIFICATION REQUIREMENTS: required licences, team composition, healthcare experience, donor compliance standards.
Step 6 — Extract EXPERT REQUIREMENTS: how many experts, what disciplines, what minimum experience?
Step 7 — Extract PROJECT REQUIREMENTS: how many references, what sector/type, what minimum value/scale?
Step 8 — Extract FORMAT/SUBMISSION RULES: file format, naming, page limits, appendix structure.
Step 9 — Build strategic requirement bundles: consolidate related requirements into strategic groups.
Step 10 — Write evaluationMethodology: how the proposal should be structured to score maximum points against each criterion.

## CRITICAL RULES:
- Do NOT convert table-of-contents entries, page numbers, clause numbers, scores, years, percentages, or page references into quantity requirements.
- Set requiredQuantity ONLY when the tender explicitly says minimum/required/at least/provide/submit a specific NUMBER of experts, CVs, projects, or references.
- Do not create hundreds of line-by-line requirements — consolidate into 10-20 strategic bundles maximum.
- A methodology/technical approach requirement is something the proposal WRITES — it is not a missing document.
- Extract email recipients, exact subject line, no-financial-proposal rules, appendix letters, and evaluation scoring weights when present.
- evaluationMethodology must be actionable: "Score criterion X by doing Y using evidence Z" — not just a list of criteria.
- submissionNotes must include: deadline, email recipients, exact subject line, file format, financial proposal restriction, appendix requirements.

JSON structure required:
{
  "summary": "4-6 sentence senior bid interpretation: client name, tender title, assignment scope, key technical challenges, main evaluation driver, top strategic risk for the responding firm",
  "requirements": [
    {
      "title": "short strategic title (max 80 chars)",
      "description": "consolidated requirement text explaining what must be in the proposal and why it matters for scoring",
      "requirementType": "TECHNICAL|FINANCIAL|ELIGIBILITY|EXPERT|PROJECT_EXPERIENCE|FORMAT|SUBMISSION_RULE|DECLARATION|ANNEX|SCHEDULE|FORM|METHODOLOGY|COMPANY_PROFILE",
      "priority": "MANDATORY|SCORED|INFORMATIONAL",
      "exactFileName": "exact filename if specified or null",
      "requiredQuantity": number_or_null,
      "pageLimit": number_or_null,
      "restrictions": "branding/signature/file/page/format restrictions or null",
      "sectionReference": "section/clause/annex reference or null"
    }
  ],
  "exactFileNaming": ["exact filenames required by the tender"],
  "exactFileOrder": ["files in the required submission order"],
  "evaluationMethodology": "Detailed scoring guidance: for each evaluation criterion, explain what evidence to present, what to emphasise, and what the evaluator is looking for. Include criterion weights if specified.",
  "submissionNotes": "Complete submission instructions: deadline with time and timezone, email recipients (all), exact subject line (verbatim), file format requirements, financial proposal restriction (yes/no), appendix lettering, and any other document-control notes."
}

TENDER DOCUMENT (${trimmedTender.length.toLocaleString()} chars):
${trimmedTender}`;

  const text = await generate(prompt);
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

  const raw = await generate(prompt);
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

  const raw = await generate(prompt);
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
  const noFinancial = /technical proposal only|no financial|financial.*not required|financial proposal.*not/i.test(
    params.submissionNotes + params.tenderText,
  );

  const isHealthcare = /health|hospital|medical|clinic|pharma|radiology|laboratory|MEP|biomedical/i.test(
    params.tenderText + params.analysisSummary,
  );

  const isFacilityAssessment = /facility identification|shortlisted propert|site assessment|renovation|premises/i.test(
    params.tenderText,
  );

  const tenderSections = extractTenderSections(params.tenderText);
  const exactEmails = Array.from(
    (params.tenderText + params.submissionNotes).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi),
  )
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(", ");

  const subjectMatch =
    (params.tenderText + params.submissionNotes).match(/Subject(?:\s+Line)?\s*:\s*[""]([^""]+)[""]/i) ??
    (params.tenderText + params.submissionNotes).match(/subject[^\n.]{0,30}[""]([^""]{5,120})[""]/i);
  const exactSubject = subjectMatch?.[1] ?? `Technical Proposal for ${params.tenderTitle}`;

  const healthcareGuidance = isHealthcare
    ? `
HEALTHCARE-SPECIFIC PROPOSAL GUIDANCE (mandatory for this tender):
- The cover letter MUST cite the company's specific hospital project experience by name and ETB/contract value from the evidence.
- Executive Summary must lead with: "We have already delivered this assignment" framing if hospital evidence exists.
- Team section must show each expert's ROLE on a PREVIOUS HOSPITAL PROJECT — not just their qualifications.
- Include a Team-to-Project Experience Mapping section showing expert → previous hospital project → role performed.
- Technical Approach must address: clinical zone segregation (Emergency/OPD/In-patient/Laboratory/Imaging/Pharmacy), patient-staff-supply flow, IPC compliance, radiation shielding for imaging, medical gas coordination, accessible design.
- MEP section must cover: medical-grade electrical load planning, UPS/generator backup for life-critical loads, ICT/nurse call/BMS/fire alarm, medical gas, clinical waste stream segregation.
- Regulatory: Ethiopian Health Authority licensing, EBCS compliance, World Bank ESF documentation (if applicable).
- Biomedical engineering integration must be addressed even if naming a specialist-to-be-engaged.
- QA: describe a staged design review (conceptual → schematic → detailed → construction documents).`
    : "";

  const facilityGuidance = isFacilityAssessment
    ? `
FACILITY IDENTIFICATION SCOPE GUIDANCE:
- Section on "Facility Identification and Technical Assessment" must describe the assessment matrix: structural adequacy, spatial feasibility, utility availability, regulatory compliance, accessibility, patient flow potential, safety, expansion possibilities.
- Must offer written technical recommendation methodology for shortlisted properties.`
    : "";

  const sectionStructureGuidance =
    tenderSections.length > 0
      ? `
EXACT TENDER SECTION STRUCTURE — follow this precisely:
${tenderSections.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Each section heading in your proposal must match or directly correspond to one of these tender sections.`
      : "";

  const prompt = `You are a 12-person senior bid team compressed into one expert proposal writer: bid director, sector technical lead, procurement compliance reviewer, evaluator, and persuasive senior writer. You have won tenders for international development organisations, World Bank projects, and private-sector clients.

## YOUR TASK
Write a complete, winning-quality TECHNICAL PROPOSAL in markdown for the tender below. This is the final submission document that will be evaluated by the client.

## NON-NEGOTIABLE QUALITY RULES
1. Evidence-first: Every strong claim must be backed by a specific project name, ETB/contract value, expert name + licence, or client reference from the EVIDENCE sections. Never invent facts.
2. Tender-specific structure: Follow the exact sections required by the tender (see TENDER SECTION STRUCTURE below). Do not use generic proposal templates.
3. Client-value framing: Every section must answer the client's implicit question: "Why should we choose this firm?" — answer it with evidence, not marketing language.
4. Expert-to-project mapping: Each proposed expert must be linked to a specific previous similar project and the role they performed on it.
5. Gap honesty: Where evidence is insufficient, write a professional "Senior Bid Review Action" note — do not pretend evidence exists.
6. NO financial content: ${noFinancial ? "This tender explicitly requires a TECHNICAL PROPOSAL ONLY. Do not include any financial offer, rates, pricing, or cost information anywhere in the proposal." : "Include financial capacity statements if required by the evaluation criteria, but do not quote prices."}
7. No AI traces: No phrases like "As an AI", "Certainly!", "I cannot", "Please note", "[INSERT]", or placeholder brackets of any kind.
8. Proposal length: Write the full proposal with all required sections. Do not truncate or summarise sections.

## SUBMISSION DETAILS (embed in cover letter and cover page)
- Submit to emails: ${exactEmails || "see tender instructions"}
- Exact subject line: "${exactSubject}"
- No financial proposal: ${noFinancial ? "CONFIRMED — technical proposal only" : "N/A"}

## MANDATORY PROPOSAL STRUCTURE
Write the proposal with ALL of these elements in order:

### COVER LETTER
- Addressed to the client by name
- Reference line citing exact tender title
- Opening paragraph citing the company's STRONGEST 1-2 specific projects directly comparable to this tender (name + value)
- List the enclosed documents/appendices by letter (Appendix A, B, C…)
- Confirm: technical proposal only, no financial proposal${noFinancial ? " (REQUIRED)" : ""}
- Signed by the General Manager / Principal with name and title

### COVER PAGE / TITLE PAGE
- Tender title and company name
- Submitted to / Submitted by
- Exact email recipients and subject line
- Submission date and deadline
- 3-5 key company stats as headline figures (e.g., "2 Hospitals Designed | ETB 675M Healthcare | 12-Expert Team")

### TABLE OF CONTENTS
- List all sections with sub-sections

### EXECUTIVE SUMMARY
- Lead with the company's direct experience match — "We have already delivered [X similar projects]…"
- Cite specific contract values, project names, and client names
- Explain why the same team is available for this engagement
- Address the top 3 evaluation criteria directly
- 3-4 strong paragraphs, no bullet lists

${sectionStructureGuidance}

### SECTION A: COMPANY PROFILE
A.1 Company Background — founding date, licence grade, staff count, completed projects, certifications
A.2 Corporate Information — structured table of legal name, registration, TIN/VAT, address, GM name
A.3 Core Areas of Expertise — bulleted service lines directly relevant to this tender
A.4 Proposed Project Team — table with: Expert Name | Qualifications & Licences | Healthcare/Relevant Experience | Role on This Assignment
A.5 Team-to-Project Experience Mapping — table: Expert & Role | Previous Similar Project | Role Previously Performed | Key Contribution
A.6 Specialist Integration (e.g., Biomedical) — if tender requires specialist expertise not in core team

### SECTION B: RELEVANT EXPERIENCE
B.1 Client References — list verified clients with reference numbers if available
B.2 Project Portfolio — for each project: Name | Client | Value | Scope | Services Provided | Relevance to this tender

### SECTION C: TECHNICAL APPROACH
C.1 Understanding of the Assignment — what the client needs and the key technical challenges
C.2 Technical Methodology — numbered sub-sections matching the tender's scope of services
${healthcareGuidance}
${facilityGuidance}
C.3 Quality Assurance — staged review process, QA checkpoints, document control

### SECTION D: ADDITIONAL INFORMATION
D.1 Value to the Client — specific, evidence-backed value propositions (not generic marketing)
D.2 Value-Added Services — in-house capabilities beyond minimum scope
D.3 Professional Certifications — list ISO, donor compliance, professional body memberships
D.4 Declaration of Eligibility — formal confirmation statement

### APPENDICES LIST
List appendices A through E (or as required) specifying what each contains

---

## TENDER INFORMATION

TENDER TITLE: ${params.tenderTitle}
CLIENT: ${params.clientName}

TENDER TEXT / FULL SCOPE EXTRACT:
${params.tenderText.slice(0, 48_000)}

AI ANALYSIS SUMMARY:
${params.analysisSummary}

EVALUATION CRITERIA (answer each explicitly):
${params.evaluationMethodology}

SUBMISSION NOTES:
${params.submissionNotes}

CONSOLIDATED REQUIREMENTS:
${params.requirements.slice(0, 20_000)}

---

## COMPANY EVIDENCE (use this — do not invent)

COMPANY PROFILE:
${params.companyProfile.slice(0, 14_000)}

PROPOSED EXPERT EVIDENCE:
${params.experts.slice(0, 14_000)}

RELEVANT PROJECT EVIDENCE:
${params.projects.slice(0, 14_000)}

COMPLIANCE / GAPS / REVIEW ACTIONS:
${params.compliance.slice(0, 12_000)}

KEY DIFFERENTIATORS TO WEAVE INTO THE NARRATIVE:
${params.differentiators}

---

Now write the complete technical proposal. Make every paragraph earn its place. The evaluator must feel — after reading the first two pages — that this firm has done this exact project before and can do it again with zero learning curve.`;

  return generate(prompt, GENERATION_MODEL);
}

function extractTenderSections(tenderText: string): string[] {
  const sectionPatterns = [
    /^(?:SECTION\s+[A-Z]|Section\s+[A-Z])\s*[:\-–]\s*(.+)$/gm,
    /^([A-Z]\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Proposed Team|Relevant Experience|Financial Information)[^\n]*)$/gm,
    /^(\d+\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Executive Summary|Introduction|Methodology|Team)[^\n]*)$/gm,
  ];
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const pattern of sectionPatterns) {
    for (const match of tenderText.matchAll(pattern)) {
      const label = (match[1] ?? match[0]).trim().slice(0, 80);
      if (label && !seen.has(label.toLowerCase())) {
        seen.add(label.toLowerCase());
        sections.push(label);
      }
    }
  }
  return sections.slice(0, 12);
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

  return generate(prompt, GENERATION_MODEL);
}
