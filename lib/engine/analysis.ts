import type { AnalysisResult, RequirementDraft, TenderWithFiles } from "./types";

const sentenceSplit = /\n+|(?<=[.!?])\s+/g;
const MAX_REQUIREMENTS = 180;
const MAX_ITEMS_PER_STRATEGIC_GROUP = 18;

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

function cleanWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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

function isNoiseLine(text: string): boolean {
  const clean = cleanWhitespace(text);
  if (clean.length < 12) return true;
  if (/^(page|table of contents|contents|confidential|copyright|annexes?)$/i.test(clean)) return true;
  if (/^\d{1,4}$/.test(clean)) return true;
  if (/\.{6,}/.test(clean) && !/(shall|must|required|submit|include|provide|expert|project|financial|technical|methodology|declaration|certificate|registration)/i.test(clean)) return true;
  if ((clean.match(/\./g) ?? []).length > clean.length / 4) return true;
  if (/^[A-Z0-9 ._\-–—()]+\s+\d{1,4}$/.test(clean) && !/(shall|must|required|submit|include|provide)/i.test(clean)) return true;
  if (/^(chapter|section|part|volume)\s+\d+/i.test(clean) && clean.length < 40) return true;
  return false;
}

function normalizeRequirement(line: string, index: number): RequirementDraft | null {
  const text = line.trim().replace(/^[-*\d.)\s]+/, "");
  if (isNoiseLine(text)) return null;

  const type = inferType(text);
  const priority = inferPriority(text);
  const quantity = inferQuantity(text);
  const exactFileName = inferFileName(text);
  const pageLimit = inferPageLimit(text);
  const exactOrder = inferOrder(line) ?? index + 1;
  const restrictions = /(page limit|font|signature|stamp|letterhead|branding|logo|file name|separate|combined|pdf|docx|zip|cover page|template|format)/i.test(text) ? text : null;

  return {
    title: extractMeaningfulTitle(text, type),
    description: cleanWhitespace(text),
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
    if (isNoiseLine(line)) continue;
    if (/^(?:\d{1,2}|[A-Z])[.)-]\s+/.test(line) && /(submit|proposal|form|annex|appendix|cv|expert|project|financial|technical|declaration|schedule|profile|certificate|registration|methodology|file|pdf|docx|zip)/i.test(line)) out.push(line);
    if (/(attachment|annex|appendix|file|document)\s*(?:no\.?|#)?\s*\d{1,2}/i.test(line)) out.push(line);
  }
  return out.slice(0, 80);
}

function strategicFamily(req: RequirementDraft): string {
  const text = `${req.title} ${req.description}`.toLowerCase();
  if (req.exactFileName) return `FILE:${req.exactFileName.toLowerCase()}`;
  if (req.requirementType === "EXPERT") {
    if (/team\s*leader|project\s*manager|coordinator/.test(text)) return "EXPERT:TEAM_LEADER";
    if (/water|sanitary|hydraulic|pump|borehole|drilling|pipe|irrigation/.test(text)) return "EXPERT:WATER_SANITARY";
    if (/electrical|mechanical|solar|power|pump/.test(text)) return "EXPERT:ELECTRO_MECHANICAL";
    if (/civil|structural|road|infrastructure/.test(text)) return "EXPERT:CIVIL_STRUCTURAL";
    if (/environment|social|safeguard|climate/.test(text)) return "EXPERT:ENVIRONMENTAL_SOCIAL";
    if (/geotech|soil|geology|hydrogeology/.test(text)) return "EXPERT:GEOTECHNICAL";
    return "EXPERT:CORE_TEAM";
  }
  if (req.requirementType === "PROJECT_EXPERIENCE") {
    if (/water|sanitary|hydraulic|pump|borehole|drilling|pipe|irrigation|solar/.test(text)) return "PROJECT:WATER_INFRASTRUCTURE";
    if (/design|feasibility|fsdd|study|supervision|consultancy/.test(text)) return "PROJECT:DESIGN_SUPERVISION";
    if (/urban|municipal|planning|infrastructure/.test(text)) return "PROJECT:URBAN_INFRASTRUCTURE";
    return "PROJECT:SIMILAR_ASSIGNMENT";
  }
  if (["LEGAL", "ELIGIBILITY", "REGISTRATION"].includes(req.requirementType)) return "ELIGIBILITY:LEGAL_REGISTRATION";
  if (["FINANCIAL", "FINANCIAL_CAPACITY"].includes(req.requirementType)) return "FINANCIAL:CAPACITY";
  if (["DECLARATION", "COMPLIANCE", "CERTIFICATION"].includes(req.requirementType)) return "COMPLIANCE:DECLARATIONS_CERTIFICATES";
  if (["FORMAT", "SUBMISSION_RULE", "FORM", "ANNEX", "SCHEDULE"].includes(req.requirementType)) return `SUBMISSION:${req.requirementType}`;
  if (req.requirementType === "METHODOLOGY") return "TECHNICAL:METHODOLOGY_WORKPLAN";
  if (req.requirementType === "COMPANY_PROFILE") return "COMPANY:PROFILE";
  if (/water|sanitary|hydraulic|pump|borehole|drilling|pipe|irrigation|solar/.test(text)) return "TECHNICAL:WATER_SOLAR_INFRASTRUCTURE";
  if (/design|feasibility|fsdd|study|supervision|consultancy/.test(text)) return "TECHNICAL:DESIGN_SUPERVISION";
  return `TECHNICAL:${req.requirementType}`;
}

function strategicTitle(key: string, fallbackType: string): string {
  const labels: Record<string, string> = {
    "EXPERT:TEAM_LEADER": "Senior team leadership and coordination expertise",
    "EXPERT:WATER_SANITARY": "Water supply / sanitary engineering experts",
    "EXPERT:ELECTRO_MECHANICAL": "Electro-mechanical / solar pumping experts",
    "EXPERT:CIVIL_STRUCTURAL": "Civil / structural engineering experts",
    "EXPERT:ENVIRONMENTAL_SOCIAL": "Environmental and social safeguard experts",
    "EXPERT:GEOTECHNICAL": "Geotechnical / hydrogeology experts",
    "EXPERT:CORE_TEAM": "Core professional team and CV requirements",
    "PROJECT:WATER_INFRASTRUCTURE": "Similar water infrastructure project references",
    "PROJECT:DESIGN_SUPERVISION": "Relevant feasibility, design and supervision references",
    "PROJECT:URBAN_INFRASTRUCTURE": "Urban / municipal infrastructure experience",
    "PROJECT:SIMILAR_ASSIGNMENT": "Similar assignment and past performance references",
    "ELIGIBILITY:LEGAL_REGISTRATION": "Legal eligibility, registration and licensing evidence",
    "FINANCIAL:CAPACITY": "Financial capacity and audited statement evidence",
    "COMPLIANCE:DECLARATIONS_CERTIFICATES": "Declarations, certificates and compliance evidence",
    "SUBMISSION:FORMAT": "Submission formatting, file and packaging rules",
    "SUBMISSION:SUBMISSION_RULE": "Submission method, deadline and delivery rules",
    "SUBMISSION:FORM": "Tender forms and templates",
    "SUBMISSION:ANNEX": "Annex and appendix requirements",
    "SUBMISSION:SCHEDULE": "Schedules and programme requirements",
    "TECHNICAL:METHODOLOGY_WORKPLAN": "Methodology, work plan and technical approach",
    "TECHNICAL:WATER_SOLAR_INFRASTRUCTURE": "Water supply / solar pumping technical scope",
    "TECHNICAL:DESIGN_SUPERVISION": "Feasibility, design and supervision technical scope",
    "COMPANY:PROFILE": "Company profile and capability statement",
  };
  if (key.startsWith("FILE:")) return `Required output file: ${key.slice(5)}`;
  return labels[key] ?? `Strategic ${fallbackType.toLowerCase()} requirement`;
}

function priorityRank(priority: string): number {
  if (priority === "MANDATORY") return 3;
  if (priority === "SCORED") return 2;
  return 1;
}

function strongestPriority(a: string, b: string): string {
  return priorityRank(a) >= priorityRank(b) ? a : b;
}

export function normalizeStrategicRequirements(requirements: RequirementDraft[]): RequirementDraft[] {
  const grouped = new Map<string, RequirementDraft[]>();
  const orderedKeys: string[] = [];

  for (const req of requirements) {
    if (isNoiseLine(req.description)) continue;
    const key = strategicFamily(req);
    if (!grouped.has(key)) orderedKeys.push(key);
    grouped.set(key, [...(grouped.get(key) ?? []), req]);
  }

  const strategic: RequirementDraft[] = [];
  for (const key of orderedKeys) {
    const group = grouped.get(key) ?? [];
    if (group.length === 0) continue;
    const first = group[0];
    const priority = group.reduce((acc, item) => strongestPriority(acc, item.priority), first.priority);
    const quantity = Math.max(...group.map((item) => item.requiredQuantity ?? 0), 0) || null;
    const pageLimit = Math.max(...group.map((item) => item.pageLimit ?? 0), 0) || null;
    const exactOrder = Math.min(...group.map((item) => item.exactOrder ?? 9999));
    const samples = group
      .map((item) => item.description)
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .slice(0, MAX_ITEMS_PER_STRATEGIC_GROUP);
    const sourceCount = group.length;
    const description = sourceCount === 1
      ? samples[0]
      : `Senior-level requirement bundle consolidating ${sourceCount} extracted tender instruction(s). Key evidence interpreted: ${samples.join(" | ")}`;

    strategic.push({
      title: strategicTitle(key, first.requirementType),
      description: description.slice(0, 3500),
      requirementType: first.requirementType,
      priority,
      requiredQuantity: quantity,
      pageLimit,
      exactFileName: first.exactFileName ?? null,
      exactOrder: Number.isFinite(exactOrder) && exactOrder !== 9999 ? exactOrder : strategic.length + 1,
      restrictions: group.find((item) => item.restrictions)?.restrictions ?? null,
      sectionReference: group.find((item) => item.sectionReference)?.sectionReference ?? null,
    });
  }

  return strategic.slice(0, MAX_REQUIREMENTS);
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
    .filter((part) => !isNoiseLine(part))
    .filter((part) => /(must|shall|required|submit|include|provide|attach|form|annex|appendix|expert|cv|project|reference|financial|technical|methodology|declaration|certificate|registration|deadline|page|format|file|score|points|marks|evaluation|scope|work|services|deliverable|design|supervision|feasibility|water|pump|solar)/i.test(part));

  const seen = new Set<string>();
  const rawRequirements: RequirementDraft[] = [];
  let idx = 0;
  for (const line of lines) {
    const req = normalizeRequirement(line, idx);
    if (!req) continue;
    const key = `${req.requirementType}::${req.exactFileName ?? ""}::${req.description.slice(0, 180).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rawRequirements.push(req);
    idx++;
  }

  const requirements = normalizeStrategicRequirements(rawRequirements);

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
    ? `Senior consultant interpretation: consolidated ${rawRequirements.length} extracted tender instruction(s) into ${requirements.length} strategic requirement bundle(s) from ${fileSource}. Mandatory bundles: ${mandatory}, scored bundles: ${scored}, exact output files detected: ${outputFiles}.`
    : "Could not derive requirements yet. Upload tender documents or add detail to the intake summary.";

  return { summary, requirements, exactFileNaming, exactFileOrder };
}
