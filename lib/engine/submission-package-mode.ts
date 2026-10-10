export type SubmissionPackageMode =
  | "SINGLE_ZIP"
  | "SEPARATE_TECHNICAL_FINANCIAL"
  | "SINGLE_COMBINED_PDF"
  | "PORTAL_UPLOAD"
  | "EMAIL_ATTACHMENTS"
  | "UNKNOWN";

export type SubmissionPackageModeResult = {
  mode: SubmissionPackageMode;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  blockingForZip: boolean;
  reason: string;
  matchedSignals: string[];
};

type TenderPackageModeLike = {
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  analysisSummary?: string | null;
  evaluationMethodology?: string | null;
  notes?: string | null;
  requirements?: Array<{ title?: string | null; description?: string | null; requirementType?: string | null; restrictions?: string | null; exactFileName?: string | null }>;
  files?: Array<{ originalFileName?: string | null; extractedText?: string | null; classification?: string | null }>;
};

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseFileList(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
}

function collectText(tender: TenderPackageModeLike): string {
  const exactFiles = [...parseFileList(tender.exactFileNaming), ...parseFileList(tender.exactFileOrder)].join("\n");
  const reqs = (tender.requirements ?? []).map((r) => `${r.title ?? ""}\n${r.description ?? ""}\n${r.requirementType ?? ""}\n${r.restrictions ?? ""}\n${r.exactFileName ?? ""}`).join("\n\n");
  const files = (tender.files ?? []).map((f) => `${f.originalFileName ?? ""}\n${f.classification ?? ""}\n${(f.extractedText ?? "").slice(0, 6000)}`).join("\n\n");
  return compact(`${tender.submissionMethod ?? ""}\n${tender.submissionAddress ?? ""}\n${tender.submissionEmails ?? ""}\n${exactFiles}\n${tender.analysisSummary ?? ""}\n${tender.evaluationMethodology ?? ""}\n${tender.notes ?? ""}\n${reqs}\n${files}`).slice(0, 80_000);
}

function signals(patterns: RegExp[], text: string): string[] {
  const out: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) out.push(compact(match[0]).slice(0, 180));
  }
  return Array.from(new Set(out));
}

const SEPARATE_TECH_FIN: RegExp[] = [
  /\btechnical\s+(proposal|offer|envelope|file).*\bfinancial\s+(proposal|offer|envelope|file).*\bseparate/i,
  /\bfinancial\s+(proposal|offer|envelope|file).*\btechnical\s+(proposal|offer|envelope|file).*\bseparate/i,
  /\b(separate|two)\s+(sealed\s+)?(envelopes|files|packages)\b/i,
  /\btwo[-\s]?envelope\b/i,
  /\bdo\s+not\s+include\s+(price|financial|commercial)\s+in\s+(the\s+)?technical/i,
];

const PORTAL_UPLOAD: RegExp[] = [
  /\b(submit|upload|submission)\b.{0,80}\b(portal|e[-\s]?procurement|procurement\s+system|online\s+platform|supplier\s+portal|tender\s+portal)\b/i,
  /\bportal\s+upload\b/i,
  /\be[-\s]?tender(ing)?\b/i,
];

const SINGLE_COMBINED_PDF: RegExp[] = [
  /\b(single|one)\s+(combined|merged)\s+pdf\b/i,
  /\bcombine\s+all\s+documents\s+into\s+(one|a\s+single)\s+pdf\b/i,
  /\bsubmit\s+(one|a\s+single)\s+pdf\b/i,
];

const SINGLE_ZIP: RegExp[] = [
  /\b(single|one)\s+(zip|compressed)\s+(file|package|folder)\b/i,
  /\bsubmit\s+(as\s+)?(a\s+)?zip\b/i,
  /\.zip\b/i,
];

const EMAIL: RegExp[] = [
  /\bsubmit\s+by\s+email\b/i,
  /\b(email|e-mail)\s+(submission|attachments?)\b/i,
  /\battachments?\s+to\s+.*@/i,
];

export function detectSubmissionPackageMode(tender: TenderPackageModeLike): SubmissionPackageModeResult {
  const text = collectText(tender);
  if (!text) return { mode: "UNKNOWN", confidence: "LOW", blockingForZip: false, reason: "No submission/package instructions available.", matchedSignals: [] };

  const separate = signals(SEPARATE_TECH_FIN, text);
  if (separate.length > 0) {
    return { mode: "SEPARATE_TECHNICAL_FINANCIAL", confidence: "HIGH", blockingForZip: false, reason: "Tender requires separate technical and financial packages; the final download surface produces isolated Technical, Financial, and (when required) Admin ZIPs.", matchedSignals: separate };
  }

  const combinedPdf = signals(SINGLE_COMBINED_PDF, text);
  if (combinedPdf.length > 0) {
    return { mode: "SINGLE_COMBINED_PDF", confidence: "HIGH", blockingForZip: true, reason: "Tender appears to require one combined PDF, not the current ZIP package.", matchedSignals: combinedPdf };
  }

  const portal = signals(PORTAL_UPLOAD, text);
  if (portal.length > 0) {
    return { mode: "PORTAL_UPLOAD", confidence: "MEDIUM", blockingForZip: true, reason: "Tender appears to require portal/online upload; package structure must match the portal categories before using ZIP export.", matchedSignals: portal };
  }

  const zip = signals(SINGLE_ZIP, text);
  if (zip.length > 0) {
    return { mode: "SINGLE_ZIP", confidence: "HIGH", blockingForZip: false, reason: "Tender explicitly allows or requires a ZIP/compressed package.", matchedSignals: zip };
  }

  const email = signals(EMAIL, text);
  if (email.length > 0) {
    return { mode: "EMAIL_ATTACHMENTS", confidence: "MEDIUM", blockingForZip: false, reason: "Tender appears to allow email attachment submission; verify file names and attachment order before sending.", matchedSignals: email };
  }

  return { mode: "UNKNOWN", confidence: "LOW", blockingForZip: false, reason: "No explicit package mode was detected; use export-readiness and tender instructions to confirm final packaging.", matchedSignals: [] };
}
