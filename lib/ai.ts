// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;

// Model priority for proposal generation (highest quality first).
// gemini-2.5-pro produces Claude-comparable reasoning depth for complex proposals.
// gemini-2.0-flash is the fast fallback for analysis/extraction and when 2.5-pro is unavailable.
const PRIMARY_MODEL = "gemini-2.0-flash";
const FALLBACK_MODEL = "gemini-1.5-pro";
const PROPOSAL_MODELS = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"];
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

// Try PROPOSAL_MODELS in order until one succeeds — gives the best available model for proposal writing.
async function generateWithBestModel(prompt: string): Promise<string> {
  const tryModel = async (name: string): Promise<string> => {
    const model = getModel(name);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    if (!text || text.trim().length === 0) throw new Error("Empty response from Gemini API");
    return text;
  };

  let lastError: unknown;
  for (const modelName of PROPOSAL_MODELS) {
    try {
      return await tryModel(modelName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) throw new Error("Gemini API rate limit reached — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
        throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
      // Model unavailable — try the next one in the chain
      if (msg.includes("404") || msg.includes("not found") || msg.includes("deprecated") || msg.includes("not supported") || msg.includes("invalid")) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("No Gemini model available for proposal generation");
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

  const prompt = `You are a 12-person senior bid team compressed into one expert proposal writer: bid director, sector technical lead, procurement compliance reviewer, evaluator, and persuasive senior writer. You have won competitive tenders for World Bank, UNDP, private-sector, and government clients. You think like the evaluator first and the writer second.

## YOUR TASK
Write a complete, winning-quality TECHNICAL PROPOSAL in markdown for the tender below. This is the final client submission document.

---

## STEP 1 — PRE-WRITING ANALYSIS (do this before writing a single word of the proposal)

Before writing, identify from the COMPANY EVIDENCE sections below:

**Strongest comparable projects (pick top 2):**
Scan the project evidence. Identify the two projects most directly comparable to this tender by sector, scope, and scale. Note their names, contract values, clients, countries, and exactly why each is relevant to THIS tender.

**Strongest proposed experts (pick top 2):**
Scan the expert evidence. Identify the two most relevant experts by discipline and comparable previous role. Note their names, titles, licences, and the specific previous project where they did comparable work.

**Top evaluation driver:**
What single criterion, if answered convincingly, wins this tender? (e.g., healthcare facility experience, team composition, technical methodology depth, donor compliance)

**Key differentiator:**
What one fact makes this firm clearly better than a generic competitor for this specific assignment?

Keep these four anchors in mind. They must appear — by name, value, and role — in: Cover Letter, Executive Summary, and Relevant Experience. This creates the "we have done this exact project before" narrative that wins competitive tenders.

---

## STEP 2 — WRITING QUALITY STANDARD

### EXAMPLES: Strong vs. Weak Proposal Writing

**WEAK (never write like this):**
> "Our company has extensive experience in healthcare facility design. We have successfully completed many hospital projects across the region. Our qualified team of professionals is ready to deliver quality results."

**STRONG (write like this):**
> "Hope Engineering's 2023 design of the St. Paul's Hospital Millennium Medical College specialist wing (ETB 312M, Addis Ababa) demonstrates our capacity for exactly this assignment — a multi-floor clinical facility with dedicated radiology, pharmacy, ICU, and full MEP integration, completed within a 14-month design programme. Dr. Almaz Tadesse (Lead Architect, EIASC Grade A), who led that project, is proposed as Principal Architect for this engagement. We are not learning on the client's time; we are repeating a proven delivery."

**WEAK:**
> "We are committed to delivering high-quality services that meet international standards and client expectations."

**STRONG:**
> "Our Quality Management Plan follows ISO 9001:2015 with four design-review gates — concept, schematic, detailed design, and pre-issue — each requiring sign-off from the Principal Architect and Technical Director before the next stage begins. On the Pharo Ethiopia Specialty Medical Center assignment, this staged process will catch clinical workflow conflicts and regulatory gaps before they reach the construction contractor."

**Rule:** Every paragraph must contain at least one specific, verifiable fact from the evidence — a project name, contract value, expert name + licence, or client reference. If no evidence exists, write a single "Bid-Team Action:" note and move on. Do not pad with vague language.

---

## STEP 3 — NON-NEGOTIABLE QUALITY RULES

1. **Evidence-first**: Every strong claim must cite a specific project name, ETB/contract value, expert name + licence, or client reference from the EVIDENCE sections. Never invent facts.
2. **Tender-specific structure**: Follow the exact sections required by the tender. Do not use a generic template.
3. **Client-value framing**: Every section must answer: "Why should we choose this firm over any other?" — answer with evidence, not intent.
4. **Expert-to-project mapping**: Each proposed expert must be linked to a specific previous comparable project and the role they performed on it. Produce a Team-to-Project table.
5. **Gap honesty**: Where evidence is missing, write one short "Bid-Team Action:" sentence. Do not pretend evidence exists.
6. **Financial rule**: ${noFinancial ? "TECHNICAL PROPOSAL ONLY — zero financial content. No rates, pricing, cost estimates, or financial offers anywhere in the document." : "Do not quote prices. Financial capacity statements (audited turnover, bank reference) are permitted if required by the evaluation criteria."}
7. **No AI traces**: Never write "As an AI", "Certainly!", "I cannot", "Please note", "[INSERT]", or any placeholder brackets.
8. **Narrative throughline**: The same two strongest project names MUST appear in the Cover Letter, Executive Summary, AND Section B. This is not optional.
9. **Proposal length and depth**: Write the full proposal. Do not truncate or summarise sections. Each section must be substantive — minimum 3 paragraphs for major sections.

---

## STEP 4 — FORBIDDEN PHRASES (auto-fail if present)
- "extensive experience" without a specific project name
- "committed to excellence / quality / delivering results"
- "leading firm in the region / country"
- "team of qualified professionals"
- "we look forward to the opportunity"
- "our company is pleased to submit"
- "we are confident that we can"
- Any text in [square brackets] as a placeholder
- Generic methodology steps like "Stage 1: Planning, Stage 2: Execution" without specific deliverables

---

## SUBMISSION DETAILS (embed in cover letter and cover page)
- Submit to emails: ${exactEmails || "see tender submission instructions"}
- Exact subject line: "${exactSubject}"
- Financial proposal excluded: ${noFinancial ? "YES — technical proposal only, confirmed" : "N/A"}

---

## MANDATORY PROPOSAL STRUCTURE
Write ALL of these in order:

### COVER LETTER
- Addressed to the client by name and position (if known)
- Subject line: exact tender reference and title
- **Opening paragraph (most important)**: cite the company's STRONGEST 1-2 specific projects comparable to this tender BY NAME and ETB/contract value — not generic capability statements
- Second paragraph: briefly introduce the proposed team lead(s) and their comparable previous role
- List the enclosed appendices by letter (Appendix A, B, C…)
- Confirm technical-only proposal if required
- Signed by the General Manager / Principal with name, title, and company

### COVER PAGE / TITLE PAGE
- Tender title and company name in bold
- Submitted to / Submitted by blocks
- Exact email recipients and subject line
- Submission date
- 3-5 headline facts (e.g., "2 Hospitals Designed | ETB 675M+ Healthcare Portfolio | 12-Expert Multidisciplinary Team | EIASC Grade A Licensed")

### TABLE OF CONTENTS
- All sections with sub-sections and approximate structure

### EXECUTIVE SUMMARY (3-4 strong paragraphs, no bullet lists)
- Lead sentence: "We have already delivered this assignment. [Company] designed / supervised / assessed [Project Name] (ETB X, Client Y) — a [parallel description]. The same team is available for this engagement."
- Second paragraph: address the top evaluation criterion directly with evidence
- Third paragraph: explain the technical approach at a high level — why it is the right approach for this specific scope and client
- Fourth paragraph: confirm compliance, team availability, and commitment

${sectionStructureGuidance}

### SECTION A: COMPANY PROFILE
A.1 Company Background — founding year, licence grade, registered address, staff headcount, total projects completed, key sectors, certifications
A.2 Corporate Information Table — legal name | registration no. | TIN/VAT | address | GM name | email | phone | website
A.3 Core Service Lines — bulleted disciplines directly relevant to this tender (not a generic list)
A.4 Proposed Project Team — table: Expert Name | Discipline & Licence | Years' Experience | Role on This Assignment | Comparable Previous Project
A.5 Team-to-Project Experience Mapping — table: Expert & Proposed Role | Previous Comparable Project | Role Previously Performed | Key Technical Contribution
A.6 Specialist Engagement Plan — if the tender requires a specialist (e.g., biomedical engineer) not in the core team, name the planned specialist and their integration role

### SECTION B: RELEVANT EXPERIENCE
B.1 Portfolio Overview — total projects, total healthcare/relevant sector value, geographic spread
B.2 Featured Project 1 (most comparable) — Name | Client | Country | Value | Year | Scope | Services Provided | Why this directly demonstrates capacity for this tender | Client contact for reference
B.3 Featured Project 2 (second most comparable) — same structure
B.4 Additional Projects — concise table with Name | Client | Country | Value | Sector | Key Services
B.5 Client References — confirmed client names and, if available, contact details for reference letters

### SECTION C: TECHNICAL APPROACH
C.1 Understanding of the Assignment — what the client needs, what the key technical challenges are, and what the winning proposal must demonstrate
C.2 Technical Methodology — numbered sub-sections matching the tender's scope items
${healthcareGuidance}
${facilityGuidance}
C.3 Work Plan and Deliverables — stages, deliverables, responsible experts, timelines
C.4 Quality Assurance — staged design review gates, independent technical review, document control, submission quality control

### SECTION D: ADDITIONAL INFORMATION
D.1 Value to the Client — specific, evidence-backed value propositions for THIS client (not marketing boilerplate)
D.2 In-House Capabilities Beyond Minimum Scope — what additional value the firm brings without extra cost
D.3 Professional Certifications and Affiliations — list ISO, donor compliance records, professional body memberships with registration numbers
D.4 Declaration of Eligibility — formal statement confirming the firm meets all eligibility requirements stated in the tender

### APPENDICES REGISTER
List appendices in the required format, e.g.:
- Appendix A: Company Registration Documents and Licences
- Appendix B: Audited Financial Statements
- Appendix C: Curricula Vitae of Proposed Experts
- Appendix D: Project References and Client Letters
- Appendix E: Project Photos, Drawings and Completion Evidence

---

## TENDER INFORMATION

TENDER TITLE: ${params.tenderTitle}
CLIENT: ${params.clientName}

TENDER TEXT / FULL SCOPE EXTRACT:
${params.tenderText.slice(0, 48_000)}

AI ANALYSIS SUMMARY:
${params.analysisSummary}

EVALUATION CRITERIA — answer each one explicitly in the proposal:
${params.evaluationMethodology}

SUBMISSION RULES:
${params.submissionNotes}

CONSOLIDATED REQUIREMENTS:
${params.requirements.slice(0, 20_000)}

---

## COMPANY EVIDENCE — USE THIS, DO NOT INVENT ANYTHING

COMPANY PROFILE:
${params.companyProfile.slice(0, 14_000)}

PROPOSED EXPERT EVIDENCE:
${params.experts.slice(0, 14_000)}

RELEVANT PROJECT EVIDENCE:
${params.projects.slice(0, 14_000)}

COMPLIANCE / GAPS / BID-TEAM ACTIONS:
${params.compliance.slice(0, 12_000)}

KEY DIFFERENTIATORS TO WEAVE INTO THE NARRATIVE:
${params.differentiators}

---

Now write the complete technical proposal. Start with the Cover Letter. The evaluator must feel — after the first two pages — that this firm has already delivered this exact project and is simply repeating a proven capability.`;

  return generateWithBestModel(prompt);
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
