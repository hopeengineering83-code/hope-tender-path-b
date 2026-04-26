import type { AnalysisResult, RequirementDraft, TenderWithFiles } from "./types";

const sentenceSplit = /\n+|(?<=[.!?])\s+/g;
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
};

function inferPriority(text: string): string {
  return /(must|mandatory|required|shall|attach|exact|compulsory|obligatory|non\s*-?responsive|disqualified|minimum requirement|eligibility)/i.test(text)
    ? "MANDATORY"
    : /(score|scored|weighted|points?|marks?|evaluation|preferred|desirable|advantage|methodology|technical merit)/i.test(text)
      ? "SCORED"
      : "INFORMATIONAL";
}

function inferType(text: string): string {
  if (/expert|key personnel|team leader|specialist|cv|curriculum vitae|staff|personnel/i.test(text)) return "EXPERT";
  if (/project reference|similar experience|completed project|experience|portfolio|past performance|assignment reference/i.test(text)) return "PROJECT_EXPERIENCE";
  if (/declaration|undertaking|statement|sworn|notari|conflict of interest|anti\s*-?corruption/i.test(text)) return "DECLARATION";
  if (/annex|appendix/i.test(text)) return "ANNEX";
  if (/schedule/i.test(text)) return "SCHEDULE";
  if (/form|template|fill|complete the|bid form|submission form/i.test(text)) return "FORM";
  if (/financial|turnover|audit|audited|balance sheet|revenue|tax clearance|bank statement/i.test(text)) return "FINANCIAL";
  if (/eligib|registration|certificate|license|licence|accreditation|permit|legal|business registration/i.test(text)) return "ELIGIBILITY";
  if (/company profile|firm profile|about us|organization profile/i.test(text)) return "COMPANY_PROFILE";
  if (/page limit|font|format|pdf|docx|naming|file name|order|size|margin|separate file|combined file|zip/i.test(text)) return "FORMAT";
  if (/submission|upload|portal|deadline|sealed|deliver|electronic submission|hard copy|envelope/i.test(text)) return "SUBMISSION_RULE";
  if (/methodology|approach|work plan|execution plan|technical approach|understanding of tor|work programme/i.test(text)) return "METHODOLOGY";
  return "TECHNICAL";
}

function numberFromText(value: string): number | null {
  const digit = value.match(/\b(\d{1,3})\b/);
  if (digit) return Number(digit[1]);
  const word = value.toLowerCase().match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b/);
  return word ? WORD_NUMBERS[word[1]] ?? null : null;
}

function inferQuantity(text: string) {
  const numeric = text.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\s+(?:key\s+)?(experts?|specialists?|personnel|staff|projects?|references?|assignments?|forms?|annexes?|appendices|copies|sets|files|documents)\b/i);
  if (numeric) return numberFromText(numeric[1]);
  const atLeast = text.match(/(?:at\s+least|minimum\s+of|not\s+less\s+than)\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)/i);
  if (atLeast) return numberFromText(atLeast[1]);
  return null;
}

function inferFileName(text: string) {
  const quoted = text.match(/["“”']([^"“”']+\.(?:docx?|pdf|xlsx?|zip|csv|txt))["“”']/i);
  if (quoted) return quoted[1].trim();
  const explicit = text.match(/(?:file\s*name|named|save\s+as)\s*[:\-]?\s*([A-Za-z0-9 _.,()\-]+\.(?:docx?|pdf|xlsx?|zip|csv|txt))/i);
  return explicit ? explicit[1].trim().replace(/[.,;:]+$/, "") : null;
}

function inferOrder(text: string): number | null {
  const order = text.match(/(?:order|sequence|attachment|annex|appendix|file)\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{1,2})/i);
  if (order) return Number(order[1]);
  const leading = text.match(/^\s*(\d{1,2})[.)-]\s+/);
  return leading ? Number(leading[1]) : null;
}

function inferPageLimit(text: string) {
  const exact = text.match(/(?:maximum|max\.?|not\s+exceed|within|limited\s+to)?\s*(\d{1,3})\s*pages?/i);
  return exact ? Number(exact[1]) : null;
}

function sectionReference(text: string): string | null {
  const match = text.match(/(?:section|clause|article|item|para(?:graph)?|annex|appendix)\s+([A-Z0-9_.-]+)/i);
  return match ? match[0] : null;
}

function extractMeaningfulTitle(text: string, type: string): string {
  const explicit = text.match(/^(?:\d+[.)-]\s*)?([A-Z][A-Za-z0-9 /&()\-]{4,80})\s*[:–-]/);
  if (explicit) return explicit[1].trim().slice(0, 80);
  const typePrefix: Record<string, string> = {
    EXPERT: "Expert Requirement",
    PROJECT_EXPERIENCE: "Project Experience Requirement",
    DECLARATION: "Declaration Requirement",
    ANNEX: "Annex Requirement",
    SCHEDULE: "Schedule Requirement",
    FORM: "Form Requirement",
    FINANCIAL: "Financial Requirement",
    ELIGIBILITY: "Eligibility Requirement",
    COMPANY_PROFILE: "Company Profile Requirement",
    FORMAT: "Format Rule",
    SUBMISSION_RULE: "Submission Rule",
    METHODOLOGY: "Methodology Requirement",
    TECHNICAL: "Technical Requirement",
  };
  const prefix = typePrefix[type] ?? "Requirement";
  const clean = text.replace(/[^a-zA-Z0-9 /&()-]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter((w) => w.length > 1);
  if (words.length >= 3) {
    const phrase = words.slice(0, 9).join(" ");
    return phrase.length > 76 ? `${phrase.slice(0, 73)}…` : phrase;
  }
  return prefix;
}

function normalizeRequirement(line: string, index: number): RequirementDraft | null {
  const text = line.trim().replace(/^[-*\d.)\s]+/, "");
  if (text.length < 12) return null;
  if (/^(page|table of contents|confidential|copyright)$/i.test(text)) return null;

  const type = inferType(text);
  const priority = inferPriority(text);
  const quantity = inferQuantity(text);
  const exactFileName = inferFileName(text);
  const pageLimit = inferPageLimit(text);
  const exactOrder = inferOrder(line) ?? index + 1;
  const restrictions = /(page limit|font|signature|stamp|letterhead|branding|logo|file name|separate|combined|pdf|docx|zip|cover page|template|format)/i.test(text) ? text : null;

  return {
    title: extractMeaningfulTitle(text, type),
    description: text,
    requirementType: type,
    priority,
    requiredQuantity: quantity,
    exactFileName,
    exactOrder,
    pageLimit,
    restrictions,
    sectionReference: sectionReference(text),
  };
}

function extractAttachmentLines(text: string): string[] {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^(?:\d{1,2}|[A-Z])[.)-]\s+/.test(line) && /(submit|proposal|form|annex|appendix|cv|expert|project|financial|technical|declaration|schedule|profile|certificate|registration|methodology|file|pdf|docx|zip)/i.test(line)) out.push(line);
    if (/(attachment|annex|appendix|file|document)\s*(?:no\.?|#)?\s*\d{1,2}/i.test(line)) out.push(line);
  }
  return out.slice(0, 80);
}

export function analyzeTender(tender: TenderWithFiles): AnalysisResult {
  const fileTexts = tender.files
    .map((f) => f.extractedText ?? `${f.originalFileName} ${f.classification ?? ""}`)
    .join("\n");

  const rawSource = [tender.intakeSummary, tender.description, fileTexts].filter(Boolean).join("\n");
  const lines = [
    ...rawSource.split(sentenceSplit),
    ...extractAttachmentLines(rawSource),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => /(must|shall|required|submit|include|provide|attach|form|annex|appendix|expert|cv|project|reference|financial|technical|methodology|declaration|certificate|registration|deadline|page|format|file|score|points|marks|evaluation)/i.test(part));

  const seen = new Set<string>();
  const requirements: RequirementDraft[] = [];
  let idx = 0;
  for (const line of lines) {
    const req = normalizeRequirement(line, idx);
    if (!req) continue;
    const key = `${req.requirementType}::${req.exactFileName ?? ""}::${req.description.slice(0, 100).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push(req);
    idx++;
  }

  const exactFileNaming = requirements
    .map((req) => req.exactFileName)
    .filter((value): value is string => Boolean(value));

  const exactFileOrder = requirements
    .filter((req) => req.exactFileName)
    .sort((a, b) => (a.exactOrder ?? 999) - (b.exactOrder ?? 999))
    .map((req) => req.exactFileName!)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  const fileSource = tender.files.some((f) => f.extractedText && f.extractedText.length > 50)
    ? "actual uploaded tender documents"
    : "tender intake summary and metadata";

  const mandatory = requirements.filter((r) => r.priority === "MANDATORY").length;
  const scored = requirements.filter((r) => r.priority === "SCORED").length;
  const outputFiles = exactFileOrder.length || exactFileNaming.length;

  const summary = requirements.length > 0
    ? `Extracted ${requirements.length} structured requirements from ${fileSource}. Mandatory: ${mandatory}, scored: ${scored}, exact output files detected: ${outputFiles}.`
    : "Could not derive requirements yet. Upload tender documents or add detail to the intake summary.";

  return { summary, requirements, exactFileNaming, exactFileOrder };
}
