export type TenderMetadataDraft = {
  title: string;
  reference: string | null;
  clientName: string | null;
  country: string | null;
  category: string;
  deadline: Date | null;
  submissionMethod: string | null;
  submissionAddress: string | null;
  description: string | null;
  intakeSummary: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return clean(match[1]).replace(/[.;,]+$/, "").slice(0, 240);
  }
  return null;
}

function inferTitle(text: string, fallbackFileName: string): string {
  const title = firstMatch(text, [
    /(?:request\s+for\s+proposals?|rfp|expression\s+of\s+interest|eoi|terms\s+of\s+reference|tor)\s*(?:for|:|-)?\s*([^\n\r]{10,180})/i,
    /(?:project\s+title|assignment\s+title|tender\s+title|procurement\s+title|contract\s+title)\s*[:\-]?\s*([^\n\r]{8,180})/i,
    /(?:consultancy\s+services\s+for|services\s+for)\s*([^\n\r]{10,180})/i,
  ]);
  if (title) return title;

  const meaningfulLine = text
    .split(/\n|\r/)
    .map(clean)
    .find((line) => line.length >= 12 && line.length <= 160 && /(tender|proposal|consultancy|service|design|supervision|project|procurement|construction|planning)/i.test(line));
  if (meaningfulLine) return meaningfulLine;

  return fallbackFileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Uploaded Tender";
}

function inferReference(text: string): string | null {
  return firstMatch(text, [
    /(?:reference\s*(?:no\.?|number)?|ref\.?\s*no\.?|rfp\s*no\.?|tender\s*no\.?|bid\s*no\.?|procurement\s*no\.?)\s*[:\-]?\s*([A-Z0-9\-/_.]{3,80})/i,
    /\b((?:RFP|EOI|TOR|RFQ|NCB|ICB|BID|RFx)[\-/_. ]?[A-Z0-9\-/_.]{3,80})\b/i,
  ]);
}

function inferClient(text: string): string | null {
  return firstMatch(text, [
    /(?:client|procuring\s+entity|procurement\s+entity|employer|owner|contracting\s+authority|beneficiary)\s*[:\-]?\s*([^\n\r]{3,160})/i,
    /(?:issued\s+by|prepared\s+by|invitation\s+by)\s*[:\-]?\s*([^\n\r]{3,160})/i,
  ]);
}

function inferCountry(text: string): string | null {
  const country = firstMatch(text, [
    /(?:country|location)\s*[:\-]?\s*([A-Za-z ]{3,80})/i,
  ]);
  if (country) return country;
  const known = ["Ethiopia", "Kenya", "Nigeria", "South Sudan", "Uganda", "Tanzania", "Rwanda", "Somalia", "Djibouti", "Sudan"];
  return known.find((name) => new RegExp(`\\b${name}\\b`, "i").test(text)) ?? null;
}

function inferCategory(text: string): string {
  if (/urban|master\s*plan|planning/i.test(text)) return "Urban Planning";
  if (/road|bridge|infrastructure|transport/i.test(text)) return "Infrastructure";
  if (/hospital|health|clinic/i.test(text)) return "Healthcare";
  if (/school|education|university/i.test(text)) return "Education";
  if (/environment|eia|esmp/i.test(text)) return "Environmental";
  if (/construction|supervision|design|architect|engineering|consultancy|consultant/i.test(text)) return "Consulting";
  if (/supply|goods|equipment/i.test(text)) return "Supply";
  if (/software|it|information\s+technology/i.test(text)) return "IT";
  return "General";
}

function parseDateValue(raw: string | null): Date | null {
  if (!raw) return null;
  const cleaned = raw.replace(/(at|before|no later than|local time|hrs?|hours?).*$/i, "").trim();
  const date = new Date(cleaned);
  if (!Number.isNaN(date.getTime())) return date;

  const dmy = cleaned.match(/(\d{1,2})[\-/\.](\d{1,2})[\-/\.](\d{2,4})/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]) - 1;
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const alt = new Date(year, month, day);
    if (!Number.isNaN(alt.getTime())) return alt;
  }
  return null;
}

function inferDeadline(text: string): Date | null {
  const raw = firstMatch(text, [
    /(?:deadline|submission\s+deadline|closing\s+date|bid\s+closing\s+date|proposal\s+submission\s+date)\s*[:\-]?\s*([^\n\r]{6,100})/i,
    /(?:submitted\s+no\s+later\s+than|submit\s+.*?by)\s*([^\n\r]{6,100})/i,
  ]);
  return parseDateValue(raw);
}

function inferSubmissionMethod(text: string): string | null {
  if (/e-?mail|email/i.test(text)) return "Email";
  if (/portal|e-procurement|electronic\s+procurement|online/i.test(text)) return "Portal";
  if (/hard\s+copy|sealed\s+envelope|physical\s+submission|deliver\s+to/i.test(text)) return "Hard copy";
  return firstMatch(text, [/submission\s+method\s*[:\-]?\s*([^\n\r]{3,120})/i]);
}

function inferSubmissionAddress(text: string): string | null {
  return firstMatch(text, [
    /(?:submission\s+address|delivery\s+address|submit\s+to|portal|email)\s*[:\-]?\s*([^\n\r]{6,180})/i,
    /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
    /(https?:\/\/[^\s)]+|www\.[^\s)]+)/i,
  ]);
}

function summaryFromText(text: string): string | null {
  const useful = text
    .split(/\n+|(?<=[.!?])\s+/)
    .map(clean)
    .filter((line) => line.length > 25)
    .filter((line) => /(scope|require|shall|must|expert|personnel|project|experience|methodology|evaluation|technical|financial|submission|form|annex|appendix|deadline|file|proposal)/i.test(line))
    .slice(0, 50)
    .join("\n");
  return useful || null;
}

export function inferTenderMetadata(extractedText: string, fallbackFileName: string): TenderMetadataDraft {
  const text = extractedText.slice(0, 250_000);
  const title = inferTitle(text, fallbackFileName);
  const reference = inferReference(text);
  const clientName = inferClient(text);
  const country = inferCountry(text);
  const category = inferCategory(text);
  const deadline = inferDeadline(text);
  const submissionMethod = inferSubmissionMethod(text);
  const submissionAddress = inferSubmissionAddress(text);
  const intakeSummary = summaryFromText(text);
  const description = intakeSummary?.slice(0, 1200) ?? `Tender created from uploaded document: ${fallbackFileName}`;

  return { title, reference, clientName, country, category, deadline, submissionMethod, submissionAddress, description, intakeSummary };
}
