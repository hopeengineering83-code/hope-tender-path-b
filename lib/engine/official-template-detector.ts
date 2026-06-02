export type OfficialTemplateDetection = {
  required: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string | null;
  matchedSignals: string[];
};

const HIGH_SIGNALS: RegExp[] = [
  /\b(must|shall|required|mandatory)\s+(use|complete|fill|submit)\s+(the\s+)?(attached|provided|prescribed|standard|official|tender[-\s]?issued)\s+(form|template|annex|schedule|format|excel|workbook)/i,
  /\b(use|complete|fill|submit)\s+(the\s+)?(attached|provided|prescribed|standard|official|tender[-\s]?issued)\s+(form|template|annex|schedule|format|excel|workbook)/i,
  /\b(do\s+not|must\s+not|shall\s+not)\s+(modify|alter|change|reformat|retype)\s+(the\s+)?(form|template|annex|schedule|format)/i,
  /\b(rate\s+card|price\s+schedule|financial\s+schedule|boq|bill\s+of\s+quantities)\b.{0,80}\b(attached|provided|template|excel|workbook|format)\b/i,
];

const MEDIUM_SIGNALS: RegExp[] = [
  /\b(annex|annexure|appendix|attachment)\s*[a-z0-9-]*\b/i,
  /\b(bid\s+form|vendor\s+registration\s+form|declaration\s+form|rate\s+card|boq|bill\s+of\s+quantities)\b/i,
  /\b(form|template|schedule|declaration|annex|rate\s+card|boq)\b/i,
  /\.(xls|xlsx|pdf)\b/i,
];

const COMPANY_PRODUCED: RegExp[] = [
  /\btechnical\s+proposal\b(?!\s+(form|template|format))/i,
  /\bmethodology\b/i,
  /\bwork\s+plan\b/i,
  /\bcompany\s+profile\b/i,
  /\bproject\s+(experience|reference|portfolio)\b/i,
  /\bexpert\s+cvs?\b/i,
  /\bcurriculum\s+vitae\b/i,
];

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function matches(patterns: RegExp[], text: string): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) out.push(compact(match[0]).slice(0, 160));
  }
  return Array.from(new Set(out));
}

export function detectOfficialTemplateRequirement(input: {
  exactFileName?: string | null;
  title?: string | null;
  description?: string | null;
  restrictions?: string | null;
  documentType?: string | null;
  format?: string | null;
}): OfficialTemplateDetection {
  const text = compact(`${input.exactFileName ?? ""} ${input.title ?? ""} ${input.description ?? ""} ${input.restrictions ?? ""} ${input.documentType ?? ""} ${input.format ?? ""}`);
  if (!text) return { required: false, confidence: "LOW", reason: null, matchedSignals: [] };

  const high = matches(HIGH_SIGNALS, text);
  if (high.length > 0) return { required: true, confidence: "HIGH", reason: `Official tender-issued form/template likely required: ${high[0]}`, matchedSignals: high };

  const medium = matches(MEDIUM_SIGNALS, text);
  const companyProduced = COMPANY_PRODUCED.some((pattern) => pattern.test(text));
  if (medium.length > 0 && !companyProduced) return { required: true, confidence: "MEDIUM", reason: `Possible official form/template detected: ${medium[0]}`, matchedSignals: medium };

  return { required: false, confidence: "LOW", reason: null, matchedSignals: medium };
}
