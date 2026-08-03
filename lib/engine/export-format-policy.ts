/**
 * Tender-driven export-format and branding/signature/stamp policy.
 */
import { safeParseJsonArray } from "../safe-json";

/* ─── 1. FORMAT POLICY ───────────────────────────────────────────── */

export type RequiredExportFormat = "docx" | "pdf" | "xlsx";

export type TenderFormatPolicy = {
  requiredFormats: RequiredExportFormat[];
  requiresPdf: boolean;
  requiresDocx: boolean;
  requiresXlsx: boolean;
  perFile: Array<{ exactFileName: string; format: RequiredExportFormat }>;
};

type TenderLike = {
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  requirements?: Array<{ exactFileName?: string | null }>;
};

function collectExactFilenames(tender: TenderLike): string[] {
  const out = new Set<string>();
  for (const raw of [tender.exactFileNaming, tender.exactFileOrder]) {
    if (!raw || raw.trim() === "") continue;
    // Try JSON array first (canonical storage format).
    const parsed = safeParseJsonArray(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      for (const item of parsed) {
        if (typeof item === "string" && item.trim().length > 0) out.add(item.trim());
        // Object form: [{"name":"Technical Proposal.pdf"}] — the download
        // route's manifest parser accepts entry.name, so the format-coverage
        // gate must too. Ignoring object entries let a tender whose required
        // PDF was stored in object form bypass PDF_REQUIRED_CONVERSION_UNAVAILABLE.
        else if (item && typeof item === "object") {
          const objName = (item as { name?: unknown; exactFileName?: unknown }).name
            ?? (item as { name?: unknown; exactFileName?: unknown }).exactFileName;
          if (typeof objName === "string" && objName.trim().length > 0) out.add(objName.trim());
        }
      }
      continue;
    }
    // BUG FIX: Fall back to plain-text newline/comma-separated parsing.
    // Previously, if `exactFileNaming` was a plain string like
    // "Technical Proposal.pdf\nFinancial Proposal.xlsx" (not JSON),
    // safeParseJsonArray returned [] and zero filenames were collected.
    // This silently disabled the PDF/DOCX/XLSX format coverage check.
    // parseRequiredFileList in export-readiness.ts already handles this
    // fallback — now we match it here for consistency.
    if (!raw.trim().startsWith("[")) {
      for (const item of raw.split(/\n|,/)) {
        const s = item.trim();
        if (s.length > 0) out.add(s);
      }
    }
  }
  for (const req of tender.requirements ?? []) {
    const name = req.exactFileName?.trim();
    if (name && name.length > 0) out.add(name);
  }
  return Array.from(out);
}

function formatFromExtension(filename: string): RequiredExportFormat | null {
  const lower = filename.toLowerCase().trim();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  return null;
}

export function detectTenderFormatPolicy(tender: TenderLike): TenderFormatPolicy {
  const names = collectExactFilenames(tender);
  const perFile: Array<{ exactFileName: string; format: RequiredExportFormat }> = [];
  const formats = new Set<RequiredExportFormat>();
  for (const name of names) {
    const fmt = formatFromExtension(name);
    if (fmt) {
      perFile.push({ exactFileName: name, format: fmt });
      formats.add(fmt);
    }
  }
  return {
    requiredFormats: Array.from(formats),
    requiresPdf: formats.has("pdf"),
    requiresDocx: formats.has("docx"),
    requiresXlsx: formats.has("xlsx"),
    perFile,
  };
}

export function validateFileSignature(
  filename: string,
  base64Content: string,
): { ok: true; detected: RequiredExportFormat } | { ok: false; reason: string } {
  const expected = formatFromExtension(filename);
  if (!expected && /\.[a-z0-9]{2,8}$/i.test(filename.trim())) {
    return { ok: false, reason: `Unsupported extension on "${filename}"; expected .docx, .pdf, or .xlsx.` };
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Content, "base64");
  } catch (err) {
    return { ok: false, reason: `Cannot decode base64 content: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (buffer.length < 4) return { ok: false, reason: "File is smaller than 4 bytes — cannot validate signature." };
  const isPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  const isOle = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (!expected) {
    // Tender-required filenames may legitimately carry no extension. There is
    // no extension label for the bytes to contradict, so the bytes must stand
    // on their own signature; unrecognizable bytes still fail closed.
    if (isPdf) return { ok: true, detected: "pdf" };
    if (isPk || isOle) return { ok: true, detected: "docx" };
    return { ok: false, reason: `"${filename}" has no extension and its bytes match no supported signature (PDF/Office).` };
  }
  if (expected === "docx" && !isPk && !isOle) return { ok: false, reason: `"${filename}" has Word extension but is not a valid DOC/DOCX signature.` };
  if (expected === "pdf" && !isPdf) return { ok: false, reason: `"${filename}" has .pdf extension but is not a valid PDF (%PDF signature missing). Likely a DOCX renamed to .pdf.` };
  if (expected === "xlsx" && !isPk && !isOle) return { ok: false, reason: `"${filename}" has Excel extension but is not a valid XLS/XLSX signature.` };
  return { ok: true, detected: expected };
}

export type PdfRequirementCheck =
  | { ok: true; warnings?: string[] }
  | { ok: false; code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE"; missing: string[]; reason: string }
  | { ok: false; code: "DOCX_REQUIRED_BUT_MISSING"; missing: string[]; reason: string }
  | { ok: false; code: "XLSX_REQUIRED_BUT_MISSING"; missing: string[]; reason: string };

export function checkTenderFormatCoverage(
  policy: TenderFormatPolicy,
  generatedExtensions: ReadonlyArray<string>,
): PdfRequirementCheck {
  const have = new Set(generatedExtensions.map((e) => e.toLowerCase().replace(/^\.+/, "")));
  const missingFormats: RequiredExportFormat[] = [];
  if (policy.requiresPdf && !have.has("pdf")) missingFormats.push("pdf");
  if (policy.requiresDocx && !have.has("docx") && !have.has("doc")) missingFormats.push("docx");
  if (policy.requiresXlsx && !have.has("xlsx") && !have.has("xls")) missingFormats.push("xlsx");

  if (missingFormats.includes("pdf")) {
    return {
      ok: false,
      code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE",
      missing: policy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName),
      reason: `Tender requires PDF output (${policy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName).join(", ")}) but no generated PDF file exists. Finalize the required PDF from the approved source document (Finalize PDF), or upload the tender-issued PDF, before final export.`,
    };
  }
  if (missingFormats.includes("docx")) {
    return { ok: false, code: "DOCX_REQUIRED_BUT_MISSING", missing: policy.perFile.filter((p) => p.format === "docx").map((p) => p.exactFileName), reason: "Tender requires DOCX output but the generated set has no DOCX file." };
  }
  if (missingFormats.includes("xlsx")) {
    return { ok: false, code: "XLSX_REQUIRED_BUT_MISSING", missing: policy.perFile.filter((p) => p.format === "xlsx").map((p) => p.exactFileName), reason: "Tender requires an Excel workbook. Upload the complete tender package containing the required XLS/XLSX file." };
  }
  return { ok: true };
}

/* ─── 2. BRANDING / SIGNATURE / STAMP POLICY ─────────────────────── */

export type BrandingPolicy = {
  brandingAllowed: boolean;
  signatureAllowed: boolean;
  stampAllowed: boolean;
  blockers: Array<{ kind: "branding" | "signature" | "stamp" | "anonymous"; sourcePhrase: string }>;
};

const BRANDING_PROHIBITION_PATTERNS: RegExp[] = [
  /(?:no|without|do\s+not\s+(?:use|apply|add)|must\s+not\s+(?:contain|include|use))\s+(?:any\s+)?(?:branding|logo|letterhead|company\s+(?:logo|colours?|colors?))/i,
  /\b(?:branding|logo|letterhead)s?\s+(?:are|is|will\s+be|shall\s+be)\s+(?:not\s+(?:allowed|permitted|accepted)|forbidden|prohibited)/i,
  /(?:template|format)\s+must\s+not\s+be\s+(?:modified|altered|changed|customi[sz]ed)/i,
  /standardi[sz]ed\s+(?:template|format)\s+(?:only|required|mandatory)/i,
];

const SIGNATURE_PROHIBITION_PATTERNS: RegExp[] = [
  /(?:no|without|must\s+not\s+(?:contain|include|add|apply))\s+(?:any\s+)?(?:signature|wet\s+signature|hand[\s-]?written\s+signature|ink\s+signature)/i,
  /\bsignatures?\s+(?:are|is|will\s+be|shall\s+be)\s+(?:not\s+(?:allowed|permitted|accepted|required)|forbidden|prohibited)/i,
  /unsigned\s+(?:submission|bid|proposal)\s+(?:required|only|mandatory)/i,
  /submissions?\s+must\s+be\s+unsigned/i,
];

const STAMP_PROHIBITION_PATTERNS: RegExp[] = [
  /(?:no|without|must\s+not\s+(?:contain|include|use|apply))\s+(?:any\s+)?(?:stamp|seal|company\s+stamp|official\s+seal)/i,
  /\bstamps?\s+(?:are|is|will\s+be|shall\s+be)\s+(?:not\s+(?:allowed|permitted|accepted|required)|forbidden|prohibited)/i,
];

const ANONYMOUS_SUBMISSION_PATTERNS: RegExp[] = [
  /\banonymous\s+(?:submission|bid|proposal|review)/i,
  /(?:blind|double[-\s]?blind)\s+(?:review|evaluation|submission)/i,
  /bidder\s+identity\s+(?:must\s+be|shall\s+be)\s+(?:masked|hidden|withheld|removed)/i,
];

export function detectBrandingPolicy(tenderText: string): BrandingPolicy {
  const blockers: BrandingPolicy["blockers"] = [];
  const safeText = (tenderText ?? "").slice(0, 200_000);
  for (const re of BRANDING_PROHIBITION_PATTERNS) { const m = safeText.match(re); if (m) blockers.push({ kind: "branding", sourcePhrase: m[0].slice(0, 200) }); }
  for (const re of SIGNATURE_PROHIBITION_PATTERNS) { const m = safeText.match(re); if (m) blockers.push({ kind: "signature", sourcePhrase: m[0].slice(0, 200) }); }
  for (const re of STAMP_PROHIBITION_PATTERNS) { const m = safeText.match(re); if (m) blockers.push({ kind: "stamp", sourcePhrase: m[0].slice(0, 200) }); }
  for (const re of ANONYMOUS_SUBMISSION_PATTERNS) { const m = safeText.match(re); if (m) blockers.push({ kind: "anonymous", sourcePhrase: m[0].slice(0, 200) }); }
  const anonymous = blockers.some((b) => b.kind === "anonymous");
  return { brandingAllowed: !anonymous && !blockers.some((b) => b.kind === "branding"), signatureAllowed: !anonymous && !blockers.some((b) => b.kind === "signature"), stampAllowed: !anonymous && !blockers.some((b) => b.kind === "stamp"), blockers };
}

export type ExportAssetStatus = {
  brandingAllowed: boolean;
  brandingApplied: boolean;
  signatureAllowed: boolean;
  signatureApplied: boolean;
  stampAllowed: boolean;
  stampApplied: boolean;
  policyBlockers: Array<{ kind: "branding" | "signature" | "stamp" | "anonymous"; sourcePhrase: string }>;
};

export function resolveExportAssetStatus(
  tenderPolicy: BrandingPolicy,
  appSettings: { allowBrandingDefault?: boolean | null; allowSignatureDefault?: boolean | null; allowStampDefault?: boolean | null },
): ExportAssetStatus {
  const settingBranding = appSettings.allowBrandingDefault !== false;
  const settingSignature = appSettings.allowSignatureDefault !== false;
  const settingStamp = appSettings.allowStampDefault !== false;
  return { brandingAllowed: tenderPolicy.brandingAllowed, brandingApplied: tenderPolicy.brandingAllowed && settingBranding, signatureAllowed: tenderPolicy.signatureAllowed, signatureApplied: tenderPolicy.signatureAllowed && settingSignature, stampAllowed: tenderPolicy.stampAllowed, stampApplied: tenderPolicy.stampAllowed && settingStamp, policyBlockers: tenderPolicy.blockers };
}

export const __testing__ = { BRANDING_PROHIBITION_PATTERNS, SIGNATURE_PROHIBITION_PATTERNS, STAMP_PROHIBITION_PATTERNS, ANONYMOUS_SUBMISSION_PATTERNS, collectExactFilenames, formatFromExtension };
