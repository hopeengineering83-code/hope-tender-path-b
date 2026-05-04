// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGenerativeAI } = require("@google/generative-ai") as typeof import("@google/generative-ai");

const apiKey = process.env.GEMINI_API_KEY;
const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const FALLBACK_GEMINI_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash,gemini-2.0-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// Model chain for proposal generation — tried in order until one succeeds.
const PROPOSAL_MODELS = ["gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-pro"];

// Claude models in preference order. Claude is preferred over Gemini for
// proposal generation when ANTHROPIC_API_KEY is configured, because the
// benchmark used for the quality target is Claude-generated.
const CLAUDE_PROPOSAL_MODELS = (process.env.ANTHROPIC_PROPOSAL_MODELS || "claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function getClient() {
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  return new GoogleGenerativeAI(apiKey);
}

function getModel(modelName = DEFAULT_GEMINI_MODEL) {
  return getClient().getGenerativeModel({ model: modelName });
}

export function isAIEnabled() {
  return Boolean(apiKey || anthropicApiKey);
}

export function isClaudeEnabled() {
  return Boolean(anthropicApiKey);
}

// ─── Claude (Anthropic) provider ──────────────────────────────────────────────
// Lazy-loaded so the @anthropic-ai/sdk package is only required when the user
// has set ANTHROPIC_API_KEY. Falls back gracefully (returns null) when the
// SDK is not installed or the key is not configured.
//
// Claude is the preferred provider for proposal generation when configured —
// the reference benchmark used to design the prompt and table structure is
// itself Claude-generated, so Claude output is what the prompt is tuned for.
async function generateWithClaude(prompt: string): Promise<string | null> {
  if (!anthropicApiKey) return null;

  let Anthropic: { new (config: { apiKey: string }): unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch {
    console.warn("[ai] ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed — falling back to Gemini.");
    return null;
  }

  const client = new (Anthropic as new (config: { apiKey: string }) => {
    messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
  })({ apiKey: anthropicApiKey });

  const errors: string[] = [];
  for (const modelName of CLAUDE_PROPOSAL_MODELS) {
    try {
      const response = await client.messages.create({
        model: modelName,
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n")
        .trim();
      if (text.length === 0) {
        errors.push(`${modelName}: empty response`);
        continue;
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${modelName}: ${msg}`);
      // 401 / 403 — credentials are wrong, no point trying other models
      if (/401|403|invalid api key|authentication/i.test(msg)) {
        throw new Error(`Anthropic API key invalid — check ANTHROPIC_API_KEY in environment variables. (${msg})`);
      }
      // 429 — rate limit, retry with backoff
      if (/429|rate.?limit/i.test(msg)) {
        if (CLAUDE_PROPOSAL_MODELS.indexOf(modelName) < CLAUDE_PROPOSAL_MODELS.length - 1) continue;
        throw new Error(`Anthropic API rate limit reached — try again in a moment. (${msg})`);
      }
      // 404 / model not found — try next model
      if (/404|not.?found|model_not_found|invalid_request/i.test(msg)) continue;
      // Other errors — let the fallback to Gemini take over (return null)
      console.warn(`[ai] Claude generation failed (${modelName}): ${msg} — falling through to next model.`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[ai] All Claude models exhausted. Errors: ${errors.join(" | ")} — falling back to Gemini.`);
  }
  return null;
}

function isModelUnavailableError(message: string): boolean {
  return /404|not found|not supported for generateContent|models\//i.test(message);
}

function isRateLimitError(message: string): boolean {
  return /429|rate.?limit|quota.?exceed|resource.?exhausted/i.test(message);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg) && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        console.warn(`[ai] Rate limit hit (attempt ${attempt + 1}/${maxRetries}), retrying after ${delay}ms...`);
        await sleep(delay);
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

function uniqueModels(primary: string): string[] {
  return Array.from(new Set([primary, ...FALLBACK_GEMINI_MODELS]));
}

async function generate(prompt: string, modelName = DEFAULT_GEMINI_MODEL): Promise<string> {
  const errors: string[] = [];

  for (const candidate of uniqueModels(modelName || DEFAULT_GEMINI_MODEL)) {
    try {
      const text = await withRateLimitRetry(async () => {
        const model = getModel(candidate);
        const result = await model.generateContent(prompt);
        const t = result.response.text();
        if (!t || t.trim().length === 0) throw new Error(`Empty response from Gemini API using ${candidate}`);
        return t;
      });
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${candidate}: ${msg}`);
      if (isRateLimitError(msg)) throw new Error("Gemini API rate limit reached after retries — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
        throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
      if (!isModelUnavailableError(msg)) throw err;
    }
  }

  throw new Error(`Gemini model unavailable. Tried: ${uniqueModels(modelName || DEFAULT_GEMINI_MODEL).join(", ")}. Errors: ${errors.join(" | ")}`);
}

// Try PROPOSAL_MODELS in order until one succeeds — gives the best available model for proposal writing.
async function generateWithBestModel(prompt: string): Promise<string> {
  let lastError: unknown;
  for (const modelName of PROPOSAL_MODELS) {
    try {
      return await withRateLimitRetry(async () => {
        const model = getModel(modelName);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        if (!text || text.trim().length === 0) throw new Error("Empty response from Gemini API");
        return text;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRateLimitError(msg)) throw new Error("Gemini API rate limit reached after retries — try again in a moment");
      if (msg.includes("403") || msg.includes("API_KEY_INVALID") || msg.includes("API key not valid"))
        throw new Error("Gemini API key invalid or missing — check GEMINI_API_KEY in environment variables");
      // Model unavailable — try the next one in the chain
      if (isModelUnavailableError(msg) || msg.includes("deprecated") || msg.includes("invalid")) {
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

  const text = await generate(prompt, process.env.GEMINI_ANALYSIS_MODEL || DEFAULT_GEMINI_MODEL);
  // Strip markdown code fences if the model wrapped its JSON
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Gemini returned no JSON object for tender analysis");
  try {
    return JSON.parse(jsonMatch[0]) as AIAnalysisResult;
  } catch {
    // Try a second pass — take largest { ... } block in case of trailing noise
    const allMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
    for (const m of allMatches) {
      try { return JSON.parse(m[0]) as AIAnalysisResult; } catch { /* continue */ }
    }
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

/**
 * Targeted refinement pass: takes a generated proposal markdown, the quality
 * scorer's weak-axis list, and the original input parameters, and asks the AI
 * to rewrite the weak sections in place. Returns the refined markdown, or
 * null if no AI provider is available or refinement fails.
 *
 * This is the multi-pass quality lift: the first pass produces a complete
 * proposal; the scorer identifies weak axes; this pass targets them
 * specifically, instructing the AI to keep the existing structure and tables
 * intact and only rewrite the prose that's weak.
 */
export async function refineProposalWithAI(input: {
  currentMarkdown: string;
  weakAxes: string[];
  tenderTitle: string;
  clientName: string;
  primarySector: string;
  topProjectNames: string[];
  topExpertNames: string[];
}): Promise<string | null> {
  if (input.weakAxes.length === 0) return null;
  if (!isAIEnabled()) return null;

  const axisDirectives: Record<string, string> = {
    structureCompleteness: "Add any missing canonical sections (Cover Letter, Executive Summary, Section A/B/C/D, Declaration). Do NOT delete existing sections; only add what is missing.",
    evidenceDensity: "Rewrite generic paragraphs (without project names, ETB values, license numbers, dates, or named clients) so each substantive paragraph carries at least one specific evidence anchor drawn from the existing project / expert references in the document. Keep all tables intact.",
    tableCoverage: "Where a section refers to data that should be tabular (project portfolio, team, risks, work plan, value framework), convert prose lists to Markdown tables matching the structures already used elsewhere in the document.",
    sectorVocabulary: `Strengthen the Section C technical methodology with sector-specific vocabulary appropriate to ${input.primarySector}. Use terms in context, not as a glossary list.`,
    throughlineConsistency: `Ensure these specific projects appear by name in the Cover Letter, Executive Summary, AND Section B Relevant Experience: ${input.topProjectNames.join("; ") || "the strongest comparable projects available in the document"}.`,
    aiTraceFreedom: `Remove any AI-trace phrases ("As an AI", "Certainly!", "Please note", "[INSERT]", any [square bracket] placeholders, "we look forward to the opportunity", "committed to excellence", "team of qualified professionals"). Replace with substantive content.`,
  };

  const directives = input.weakAxes.map((axis) => `- **${axis}**: ${axisDirectives[axis] ?? "Strengthen this axis using the evidence already in the document."}`).join("\n");

  const prompt = `You are refining an existing technical proposal for tender "${input.tenderTitle}" submitted to ${input.clientName} (sector: ${input.primarySector}).

Below is the current full proposal markdown. A deterministic quality scorer flagged these weak axes:

${directives}

## YOUR TASK

Return the COMPLETE refined proposal markdown. Keep:
- All existing section headings
- All existing tables (do not break Markdown table syntax)
- All existing factual claims (project names, ETB values, license numbers, dates, client names)
- All existing appendix references

Only rewrite the prose to address the weak axes above. The output must be the FULL document, not a diff. Do NOT add explanations or commentary outside the markdown.

## EXISTING PROPOSAL

${input.currentMarkdown.slice(0, 80_000)}

## REFINED PROPOSAL (return the complete document)
`;

  try {
    if (isClaudeEnabled()) {
      const claudeResult = await generateWithClaude(prompt);
      if (claudeResult) return claudeResult;
    }
    if (apiKey) return await generateWithBestModel(prompt);
  } catch (err) {
    console.warn(`[ai] refineProposalWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  return null;
}

export async function generateBenchmarkProposalWithAI(params: AIBidWriterInput): Promise<string> {
  const noFinancial = /technical proposal only|no financial|financial.*not required|financial proposal.*not/i.test(
    params.submissionNotes + params.tenderText,
  );

  const allText = params.tenderText + params.analysisSummary;

  // Universal sector detection — multiple sectors can be active simultaneously
  const isHealthcare = /health|hospital|medical|clinic|pharma|radiology|laboratory|biomedical/i.test(allText);
  const isFacilityAssessment = /facility identification|shortlisted propert|site assessment|suitable.*propert|premises|renovation.*exist/i.test(params.tenderText);
  const isWater = /water supply|borehole.*water|pump.*station|hydraulic.*design|irrigation.*scheme|WASH|sanitation.*project|water.*scheme|water.*network|reservoir.*design|water.*treatment|wastewater/i.test(allText);
  const isRoadBridge = /road.*design|road.*rehab|bridge.*design|highway.*design|pavement.*design|transport.*infrastructure|culvert|road.*supervision|road.*project|road.*construction/i.test(allText);
  const isBuilding = !isHealthcare && /architectural.*design|building.*design|structural.*design|construction.*supervision|commercial.*building|school.*building|office.*design|factory.*design|warehouse.*design/i.test(allText);
  const isUrban = /urban.*plan|master.*plan|land.*use.*plan|municipal.*develop|spatial.*plan|eco.?park|city.*development|public.*space.*design|settlement.*plan/i.test(allText);
  const isEnvironmental = /ESIA|ESMP|environmental.*impact.*assess|social.*safeguard|environmental.*management.*plan|EHS|climate.*risk.*assess|biodiversity.*assess|resettlement.*action|environmental.*screen/i.test(allText);
  const isICT = /ICT.*system|information.*system.*develop|software.*develop|digital.*platform|database.*system|MIS.*develop|ERP.*implement|network.*design|cyber.*security.*consult|data.*management.*system/i.test(allText);
  const isEducation = !isHealthcare && /school.*design|university.*design|campus.*develop|education.*facilit|training.*cent.*design|vocational.*training.*facilit/i.test(allText);
  const isDonor = /World Bank|UNDP|USAID|GIZ|EU.*fund|AfDB|ADB|JICA|donor.*fund|development.*partner.*fund|bilateral.*donor/i.test(allText);

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

  // Sector-specific proposal guidance blocks — injected verbatim into the prompt only when detected
  const healthcareGuidance = isHealthcare
    ? `
HEALTHCARE-SPECIFIC PROPOSAL GUIDANCE (mandatory for this tender):
- Cover letter MUST cite the company's specific hospital project experience by name and ETB/contract value from the evidence.
- Executive Summary must lead with: "We have already delivered this assignment" framing if hospital evidence exists.
- Team section must show each expert's ROLE on a PREVIOUS HOSPITAL PROJECT — not just qualifications.
- Include a Team-to-Project Experience Mapping section showing expert → previous hospital project → role performed.
- Technical Approach must address: clinical zone segregation (Emergency/OPD/In-patient/Laboratory/Imaging/Pharmacy), patient-staff-supply flow, IPC compliance, radiation shielding for imaging, medical gas coordination, accessible design.
- MEP section must cover: medical-grade electrical load planning, UPS/generator backup for life-critical loads, ICT/nurse call/BMS/fire alarm, medical gas, clinical waste stream segregation.
- Regulatory: Ethiopian Health Authority licensing, EBCS compliance, World Bank ESF documentation (if applicable).
- Biomedical engineering integration must be addressed even if naming a specialist-to-be-engaged.
- QA: staged design review (conceptual → schematic → detailed → construction documents).`
    : "";

  const facilityGuidance = isFacilityAssessment
    ? `
FACILITY IDENTIFICATION SCOPE GUIDANCE:
- "Facility Identification and Technical Assessment" section must describe the assessment matrix: structural adequacy, spatial feasibility, utility availability, regulatory compliance, accessibility, patient flow potential, safety, expansion possibilities.
- Must offer written technical recommendation methodology for shortlisted properties with a clear recommended/not-recommended conclusion per site.`
    : "";

  const waterGuidance = isWater
    ? `
WATER/SANITATION/HYDRAULICS GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest specific water supply or sanitation project by name, client, and capacity/contract value from the evidence.
- Technical Approach must address: source investigation (borehole siting, geophysical survey, or surface intake), demand projection methodology, hydraulic modelling (WaterCAD/EPANET or equivalent), pipe network sizing, pump station design (head, flow, power/solar), storage reservoir sizing, water quality/treatment design.
- BOQ and specifications must be directly linked to hydraulic design outputs — not generic quantities.
- Include: borehole drilling supervision protocol, pump testing/yield assessment, chlorination/disinfection design, sanitary protection zone.
- Construction supervision: field engineer duties, pipe pressure testing, concrete testing, commissioning checklist, as-built documentation.
- Deliverables: O&M manual, community water management training, performance handover certificate.
- WASH component (if applicable): sanitation facility design standard (pupil/patient ratio compliance), hygiene promotion approach.`
    : "";

  const roadBridgeGuidance = isRoadBridge
    ? `
ROAD/BRIDGE/TRANSPORT INFRASTRUCTURE GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest road/bridge project by name, client, length/value, and country from the evidence.
- Technical Approach must address: route survey and alignment, topographic survey control, geotechnical investigation (CBR, proctor, borehole/test pit), traffic count and design traffic (AADT, ESAL), road design standard (ERA design manual, AASHTO, or applicable), pavement design layers and thicknesses, drainage design (culverts, side drains, retention ponds), bridge/structure design (if applicable), road safety audit, environmental and social controls.
- Construction supervision: engineer's representative duties, materials testing programme (CBR, compaction, aggregate quality), progress reporting format, variation/claim management, interim payment certification, defects liability monitoring.
- BOQ: earthworks quantities, surfacing, drainage structures, bridges — all linked to design drawings.
- Handover: as-built drawings, maintenance manual, performance monitoring framework, road authority acceptance.`
    : "";

  const buildingGuidance = isBuilding
    ? `
BUILDING/ARCHITECTURE/SUPERVISION GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable building project by name, client, and ETB/contract value from the evidence.
- Technical Approach must address: functional brief and space schedule, site analysis, architectural concept, structural system selection, MEP coordination (electrical, mechanical, plumbing), accessibility (Universal Design), life safety (fire egress, smoke control, emergency lighting), building permit documentation.
- Design stages: concept → schematic → design development → detailed design/working drawings → construction documents.
- Construction supervision: site inspection regime, material/shop drawing approval workflow, progress certification, variation control, quality testing (concrete cube, rebar, welding), defects register.
- BOQ/cost: elemental cost plan at design development; detailed BOQ at working drawings stage.
- Handover: as-built documentation, O&M manuals, warranties, regulatory sign-off, completion certificate.`
    : "";

  const urbanGuidance = isUrban
    ? `
URBAN/MASTER PLANNING GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable urban planning or master plan project by name, scale (hectares/population), and client from the evidence.
- Technical Approach must address: baseline studies (GIS-based land use mapping, demographic analysis, infrastructure inventory), land-use zoning scenario development, infrastructure demand assessment (transport, water, utilities, green space), environmental and social screening, phasing and priority project identification, stakeholder consultation framework.
- Master Plan deliverables: vision, objectives, strategic land-use map, infrastructure plan, phasing, implementation roadmap, regulatory alignment checklist, investment framework summary.
- Community/authority engagement: workshop design, survey methodology, consultation record, public disclosure, conflict/grievance management.
- GIS: spatial data collection methodology, layer management, map production standards, dataset handover format.
- Implementation: capacity building plan for municipal counterpart, M&E framework, indicator set.`
    : "";

  const environmentalGuidance = isEnvironmental
    ? `
ENVIRONMENTAL/SOCIAL IMPACT ASSESSMENT GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable ESIA/ESMP report by name, donor/client, and country from the evidence.
- Technical Approach must address: baseline data collection methodology (physical environment, biological survey, socioeconomic survey), legal and regulatory framework review (national law + donor safeguards), impact identification using structured matrices (Leopold or equivalent), mitigation hierarchy (avoid → minimise → restore → offset → compensate).
- ESMP: management measures per impact, monitoring indicators, responsibilities, reporting schedule, budget estimate, grievance mechanism design.
- Stakeholder engagement plan: consultation event design, disclosure requirements, feedback incorporation, vulnerable group inclusion.
- Donor alignment: World Bank ESF standards (ESS1–10) or equivalent; project screening/categorisation; ESMP format; PAP census and livelihood restoration plan (if applicable).
- Reporting: ESIA/ESMP report structure, regulatory submission package, monitoring-ready annexes, public disclosure draft.`
    : "";

  const ictGuidance = isICT
    ? `
ICT/DIGITAL SYSTEMS GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable system deployment by name, client, user count, and delivery period from the evidence.
- Technical Approach must address: requirements analysis and business process review, functional and technical specification, system architecture (application, database, network/hosting layers), data security controls (access management, encryption, audit trail, backup/disaster recovery), integrations with existing systems (APIs, data migration plan).
- Implementation methodology: phased delivery approach (agile sprints or structured phases), acceptance testing plan (unit, integration, UAT), training programme (train-the-trainer, user manuals), change management and adoption strategy.
- Go-live: deployment checklist, parallel-run strategy, cutover plan, data validation and reconciliation protocol.
- Post-deployment: SLA definition, help desk/support model, patch/update management plan, full documentation set, source code and data handover.`
    : "";

  const donorGuidance = isDonor
    ? `
DONOR-FUNDED PROJECT COMPLIANCE GUIDANCE:
- Explicitly name the donor/funder and confirm compliance with their procurement and quality standards in the Executive Summary and Technical Approach.
- Reference the applicable conditions of contract (FIDIC, UNCITRAL, or donor-specific) and state key contract administration obligations.
- Donor reporting: M&E framework (output/outcome/impact indicators with baselines), progress report format and frequency, financial accountability requirements.
- Environmental and social screening: applicable safeguard standards (World Bank ESF/IFC PS, UNDP SES, or other), screening category, identified E&S risks and mitigation approach.
- Quality Management Plan: ISO 9001:2015-aligned, document control system, design review gate protocol, independent peer review.`
    : "";

  const educationGuidance = isEducation
    ? `
EDUCATION FACILITY DESIGN GUIDANCE (mandatory for this tender):
- Cover letter and Executive Summary MUST cite the company's strongest comparable school/university project by name, client, and ETB/contract value from the evidence.
- Technical Approach must address: functional brief and space schedule (classrooms, laboratories, library, administration, sanitation, sports), accessible and inclusive design (ramps, accessible toilets, wayfinding for all users), climate-responsive design (natural ventilation, shading, daylighting, thermal comfort), structural adequacy for assembly occupancy.
- MEP: power supply, backup generator/solar, water supply and sanitation (pupil-to-toilet ratio compliance with national standards), ICT cabling and display systems, fire detection and emergency systems.
- Site design: boundary security, vehicular/pedestrian separation, outdoor learning and recreation areas.
- Regulatory: building permit, education authority functional approval, fire certificate.
- Supervision: standard materials testing programme, progress reporting, defects register, handover documentation.`
    : "";

  // Combine all active sector guidance blocks for injection into Section C
  const allSectorGuidance = [
    healthcareGuidance, facilityGuidance, waterGuidance, roadBridgeGuidance,
    buildingGuidance, urbanGuidance, environmentalGuidance, ictGuidance,
    donorGuidance, educationGuidance,
  ].filter(Boolean).join("\n\n");

  // Dynamic cover page headline facts calibrated to detected sector
  const coverPageExample = isHealthcare
    ? `"2 Hospitals Designed | ETB 675M+ Healthcare Portfolio | 12-Expert Multidisciplinary Team | EIASC Grade A Licensed"`
    : isWater
    ? `"5 Water Supply Schemes Delivered | Hydraulic Modelling In-house | FIDIC-Compliant Supervision | 12+ Boreholes Supervised"`
    : isRoadBridge
    ? `"8 Road Projects Supervised | 150km+ Roads Designed | Bridge Engineering Capability | ERA/MoT-Compliant Methodology"`
    : isUrban
    ? `"12 Master Plans Delivered | GIS Spatial Analysis In-house | Multi-Stakeholder Consultation | Municipal Planning Specialists"`
    : isEnvironmental
    ? `"15 ESIA/ESMP Reports Accepted | World Bank ESF Compliant | Licensed Environmental Practitioners | Stakeholder Engagement Specialists"`
    : isICT
    ? `"6 Enterprise Systems Deployed | 150+ Users Trained | Secure Cloud Architecture | Full Source Code Handover"`
    : isEducation
    ? `"3 School Campuses Designed | Accessible & Climate-Responsive Design | Full MEP Integration | Building Permit Support"`
    : isDonor
    ? `"10+ Donor-Funded Projects Delivered | World Bank / UNDP Track Record | ISO-Aligned Quality System | FIDIC-Compliant Contract Administration"`
    : `"10+ Major Projects Delivered | Multidisciplinary Expert Team | Evidence-Backed Technical Approach | ISO-Aligned Quality System"`;

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

## STEP 5 — TABLE FORMAT (use these exact Markdown table shapes)

Tables are mandatory for the sections marked TABLE below. Use standard Markdown table syntax. Cells must contain real, evidence-grounded values from the EVIDENCE sections — never placeholders.

**A.4 Proposed Project Team — TABLE (one row per expert):**
\`\`\`
| # | Expert & Position | Qualifications & Licenses | Comparable Sector Experience | Role on This Assignment |
|---|---|---|---|---|
| 1 | Eng. Ahmed Kebede, Project Principal | B.Sc. Civil (AAIT 2015), PPE Structural IPSTE/6884 valid 2030 | G+6 Hospital (ETB 550M); Eco-Park (ETB 27.5B WB ESF) | Project leadership, client liaison, final design sign-off |
| 2 | … | … | … | … |
\`\`\`

**A.5 Team-to-Project Experience Mapping — TABLE:**
\`\`\`
| Expert & Role on This Project | Role Previously Performed | Previous Comparable Project | Key Technical Contribution |
|---|---|---|---|
| Daniel Getachew, MEP Lead | Lead Electrical Engineer | Dr. Abdul Seid Hospital (ETB 550M) | Medical-grade power, UPS for life-critical loads, imaging room power |
\`\`\`

**B.2 / B.3 Featured Project Cards — TABLE per project (2-column metadata):**
\`\`\`
### G+6 General Hospital, Dr. Abdul Seid

| Field | Detail |
|---|---|
| Client | Gimba City Administration, South Wollo Zone |
| Location & Scale | South Wollo, Ethiopia — 7,000 m² built-up |
| Duration | 2015–2018 (Completed) |
| Contract Value | ETB 550,074,678 |
| Testimony Reference | Ref ጂ/ከ/መ/ል/1591/18, dated 19/01/2018 E.C. — Tariku Abebaw, Building Officer |
| Services Provided | Feasibility, geotechnical, full architectural/structural/MEP design, BOQ, supervision |
| Relevance to This Assignment | All six clinical departments required by this tender were included; same proposed team |
\`\`\`

**C.4 Three-Stage Quality Review — TABLE:**
\`\`\`
| Stage | Milestone | Review Authority and Required Action |
|---|---|---|
| Stage 1 | 30% Schematic Design | Senior Engineer + QA Manager. Sector-protocol gate-check. Written sign-off required. |
| Stage 2 | 60% Developed Design | Deputy GM. Regulatory pre-check. Written approval required. |
| Stage 3 | 100% Pre-Issue Final Package | General Manager / Principal. Final sign-off. All review comments resolved. |
\`\`\`

For any tender involving site selection, premises identification, beneficiary selection, or asset assessment, also include a **Weighted Assessment Matrix** table with columns: Criterion | Weight | What Is Evaluated. Each criterion gets a percentage weight totalling 100%.

**B.1 Client References — TABLE (place BEFORE B.2 Project Portfolio):**
\`\`\`
| Project / Client | Reference Contact & Title | Contact Details & Reference | Contract Value |
|---|---|---|---|
| G+6 Dr. Abdul Seid Hospital — Gimba City Administration | Tariku Abebaw, Building Officer | South Wollo, Ref ጂ/ከ/መ/ል/1591/18 dated 19/01/2018 E.C. | ETB 550,074,678 |
\`\`\`

**A.6 Specialist Engagement Plan — only emit when the tender requires a discipline NOT covered by the proposed core team (e.g., biomedical engineer, telecoms specialist, QHSE auditor):**
- One paragraph (50–80 words) on scope of services with named deliverables
- Bulleted **Integration Plan** with 4 timeline phases (assessment / design development / detailed design / commissioning)
- Closing sentence confirming requirements are embedded from schematic stage, not retrospectively

**D.1 Value Framework — TABLE (4–6 evaluator-facing benefit pillars):**
\`\`\`
## D.1 Value Framework — What [Client Name] Gains

| Framework Pillar | What This Engagement Delivers |
|---|---|
| Facility Intelligence | [Client] identifies the right premises with confidence. Weighted site assessment scores each shortlisted property against five sector-specific criteria. In-house geotechnical capability delivers subsurface findings within days, protecting acquisition timelines. |
| Workflow Engineering | Patients experience shorter waiting times and staff cover less unnecessary distance. … |
\`\`\`

**D.4 Declaration of Eligibility — formal language with named GM and license:**
"We, [Company], hereby declare that this Technical Proposal has been prepared specifically in response to [Tender Title] for [Client]. All information provided is accurate and supported by documentary evidence available on request. The firm meets all eligibility requirements stated in the tender …
Signed: [GM Name], License [License Number], on behalf of [Company]."

**Rule:** If you cannot fill a table cell from the EVIDENCE sections, write a single short "Bid-Team Action: confirm X before submission." cell — do NOT fabricate data and do NOT leave the cell empty.

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
- 3-5 headline facts drawn from the evidence library — number of comparable projects delivered, total portfolio value, team size/disciplines, key licence/certification held. Use sector-appropriate language: (e.g., ${coverPageExample})

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
${allSectorGuidance}
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
${params.companyProfile.slice(0, 16_000)}

PROPOSED EXPERT EVIDENCE:
${params.experts.slice(0, 18_000)}

RELEVANT PROJECT EVIDENCE:
${params.projects.slice(0, 18_000)}

COMPLIANCE / GAPS / BID-TEAM ACTIONS:
${params.compliance.slice(0, 14_000)}

KEY DIFFERENTIATORS TO WEAVE INTO THE NARRATIVE:
${params.differentiators}

---

Now write the complete technical proposal. Start with the Cover Letter. The evaluator must feel — after the first two pages — that this firm has already delivered this exact project and is simply repeating a proven capability.`;

  // Claude is the preferred provider when configured — the reference benchmark
  // is Claude-generated, so the prompt is tuned for Claude's strengths. Falls
  // back to Gemini when Claude fails or returns null. Falls back to the
  // deterministic engine path when both fail (handled in generateTenderDocuments).
  if (isClaudeEnabled()) {
    const claudeResult = await generateWithClaude(prompt);
    if (claudeResult) return claudeResult;
  }
  if (apiKey) return generateWithBestModel(prompt);
  throw new Error("No AI provider configured — set ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY in environment variables.");
}

function extractTenderSections(tenderText: string): string[] {
  const sectionPatterns = [
    /^(?:SECTION\s+[A-Z0-9]+|Section\s+[A-Z0-9]+)\s*[:\-–]\s*(.+)$/gm,
    /^([A-Z]\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Proposed Team|Financial Information|Methodology|Team Composition|Understanding of Assignment|Project Experience|Evaluation Criteria|Value[- ]Added)[^\n]*)$/gm,
    /^(\d+\.\s+(?:Company Profile|Relevant Experience|Technical Approach|Additional Information|Executive Summary|Introduction|Methodology|Team|Understanding|Background|Evaluation)[^\n]*)$/gm,
    /^((?:Executive Summary|Company Profile|Proposed Team|Relevant Experience|Technical Approach|Additional Information|Compliance|Declaration)\b[^\n]{0,60})$/gm,
  ];
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const pattern of sectionPatterns) {
    for (const match of tenderText.matchAll(pattern)) {
      const label = (match[1] ?? match[0]).trim().slice(0, 80);
      if (label && !seen.has(label.toLowerCase()) && label.length > 4) {
        seen.add(label.toLowerCase());
        sections.push(label);
      }
    }
  }
  return sections.slice(0, 12);
}

