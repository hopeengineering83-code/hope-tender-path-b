import type { AnalysisResult, RequirementDraft, TenderWithFiles } from "./types";

const sentenceSplit = /\n+|(?<=[.!?])\s+/g;

function inferPriority(text: string): string {
  return /(must|mandatory|required|shall|attach|exact|compulsory|obligatory)/i.test(text)
    ? "MANDATORY"
    : /(score|weighted|points|evaluation|preferred|desirable)/i.test(text)
      ? "SCORED"
      : "INFORMATIONAL";
}

function inferType(text: string): string {
  if (/expert|key personnel|team leader|specialist|cv|curriculum vitae|staff/i.test(text)) return "EXPERT";
  if (/project reference|similar experience|completed project|experience|portfolio/i.test(text)) return "PROJECT_EXPERIENCE";
  if (/declaration|undertaking|statement|sworn|notari/i.test(text)) return "DECLARATION";
  if (/annex/i.test(text)) return "ANNEX";
  if (/schedule/i.test(text)) return "SCHEDULE";
  if (/form|template|fill|complete the/i.test(text)) return "FORM";
  if (/financial|turnover|audit|balance sheet|revenue/i.test(text)) return "FINANCIAL";
  if (/eligib|registration|certificate|license|accreditation|permit/i.test(text)) return "ELIGIBILITY";
  if (/company profile|firm profile|about us/i.test(text)) return "COMPANY_PROFILE";
  if (/page limit|font|format|pdf|docx|naming|order|size|margin/i.test(text)) return "FORMAT";
  if (/submission|upload|portal|deadline|sealed|deliver/i.test(text)) return "SUBMISSION_RULE";
  if (/methodology|approach|work plan|execution plan|technical approach/i.test(text)) return "METHODOLOGY";
  return "TECHNICAL";
}

function inferQuantity(text: string) {
  const match = text.match(/(\d+)\s+(experts?|specialists?|projects?|references?|forms?|annexes?|copies|sets)/i);
  return match ? Number(match[1]) : null;
}

function inferFileName(text: string) {
  const quoted = text.match(/[""](.+?)[""]/);
  if (quoted) return quoted[1];
  const explicit = text.match(/file name\s*[:\-]\s*([A-Za-z0-9 _.\-]+)/i);
  return explicit ? explicit[1].trim() : null;
}

function inferPageLimit(text: string) {
  const match = text.match(/(\d+)\s*pages?/i);
  return match ? Number(match[1]) : null;
}

function normalizeRequirement(line: string, index: number): RequirementDraft | null {
  const text = line.trim().replace(/^[-*\d.)\s]+/, "");
  if (text.length < 12) return null;

  const type = inferType(text);
  const priority = inferPriority(text);
  const quantity = inferQuantity(text);
  const exactFileName = inferFileName(text);
  const pageLimit = inferPageLimit(text);

  const typePrefix: Record<string, string> = {
    EXPERT: "Expert Requirement",
    PROJECT_EXPERIENCE: "Project Experience",
    DECLARATION: "Declaration",
    ANNEX: "Annex",
    SCHEDULE: "Schedule",
    FORM: "Form",
    FINANCIAL: "Financial Requirement",
    ELIGIBILITY: "Eligibility Criterion",
    COMPANY_PROFILE: "Company Profile",
    FORMAT: "Format Rule",
    SUBMISSION_RULE: "Submission Rule",
    METHODOLOGY: "Methodology",
    TECHNICAL: "Technical Requirement",
  };

  return {
    title: `${typePrefix[type] ?? "Requirement"} ${index + 1}`,
    description: text,
    requirementType: type,
    priority,
    requiredQuantity: quantity,
    exactFileName,
    pageLimit,
    restrictions: /(page limit|font|signature|stamp|letterhead|branding|logo)/i.test(text) ? text : null,
  };
}

export function analyzeTender(tender: TenderWithFiles): AnalysisResult {
  // Use extractedText from uploaded files (real document content) as priority source
  const fileTexts = tender.files
    .map((f) => f.extractedText ?? `${f.originalFileName} ${f.classification ?? ""}`)
    .join("\n");

  const rawSource = [
    tender.intakeSummary,
    tender.description,
    fileTexts,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = rawSource
    .split(sentenceSplit)
    .map((part) => part.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const requirements: RequirementDraft[] = [];
  let idx = 0;
  for (const line of lines) {
    const req = normalizeRequirement(line, idx);
    if (!req) continue;
    const key = req.requirementType + "::" + req.description.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push(req);
    idx++;
  }

  const exactFileNaming = requirements
    .map((req) => req.exactFileName)
    .filter((value): value is string => Boolean(value));

  const exactFileOrder = [...exactFileNaming];

  const fileSource = tender.files.some((f) => f.extractedText && f.extractedText.length > 50)
    ? "actual uploaded tender documents"
    : "tender intake summary and metadata";

  const summary = requirements.length > 0
    ? `Extracted ${requirements.length} structured requirements from ${fileSource}. ` +
      `Mandatory: ${requirements.filter((r) => r.priority === "MANDATORY").length}, ` +
      `Scored: ${requirements.filter((r) => r.priority === "SCORED").length}.`
    : "Could not derive requirements yet. Upload tender documents or add detail to the intake summary.";

  return { summary, requirements, exactFileNaming, exactFileOrder };
}
