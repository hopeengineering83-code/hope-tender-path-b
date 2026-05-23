/**
 * Tender-driven export-format and branding/signature/stamp policy.
 *
 * Two responsibilities (related, both pure functions, both tested
 * in isolation, both consumed by the download route and the
 * export-readiness check):
 *
 *   1. FORMAT POLICY
 *      Detect whether the tender's submission plan requires PDF
 *      output (or DOCX, or both). Provide signature checks so the
 *      route can verify a file's binary actually matches its
 *      claimed extension — preventing the "DOCX renamed to .pdf"
 *      class of disqualifying submission errors.
 *
 *   2. BRANDING / SIGNATURE / STAMP POLICY
 *      Scan tender text for language that prohibits letterhead,
 *      logos, signatures, stamps, or any vendor-identifying
 *      branding ("anonymous submission", "unsigned", "template
 *      must not be modified"). Return a structured policy
 *      object that the export-readiness check uses to either
 *      strip those assets before final export or block when
 *      stripping is not safe.
 *
 * Original product rule (from the prompt): "Apply branding,
 * letterhead, signature, and stamp only where tender allows."
 * Pre-this-module, the engine had AppSettings toggles but no
 * tender-restriction detection — so a tender that said "submissions
 * must be unsigned" could still get a signature-stamped DOCX
 * exported.
 */

/* ─── 1. FORMAT POLICY ───────────────────────────────────────────── */

export type RequiredExportFormat = "docx" | "pdf";

export type TenderFormatPolicy = {
  /** All distinct formats the tender's submission plan demands. */
  requiredFormats: RequiredExportFormat[];
  /** True when at least one tender-required filename ends in .pdf. */
  requiresPdf: boolean;
  /** True when at least one tender-required filename ends in .docx (or no format is specified). */
  requiresDocx: boolean;
  /** Per-required-filename format demand. Used to validate a specific generated doc. */
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
    try {
      const parsed = JSON.parse(raw ?? "[]");
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim().length > 0) out.add(item.trim());
        }
      }
    } catch { /* malformed JSON — skip */ }
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
  return null;
}

/**
 * Inspect tender's submission plan and return the format policy.
 * When the tender declares no exact filenames at all, requiredFormats
 * is empty and requiresPdf/requiresDocx are both false (the engine
 * defaults to DOCX in that case — same as pre-this-module behaviour).
 */
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
    perFile,
  };
}

/**
 * Validate that a base64-encoded file's binary signature matches
 * its claimed extension. Catches the "DOCX renamed to .pdf" class
 * of submission errors that disqualify a bid.
 *
 * Returns:
 *   { ok: true, detected: "docx" | "pdf" }
 *   { ok: false, reason: string }
 *
 * Signatures:
 *   DOCX (and any Office Open XML / ZIP) — bytes 0,1 = 0x50 0x4B ("PK")
 *   PDF — bytes 0..3 = "%PDF" (0x25 0x50 0x44 0x46)
 */
export function validateFileSignature(
  filename: string,
  base64Content: string,
): { ok: true; detected: RequiredExportFormat } | { ok: false; reason: string } {
  const expected = formatFromExtension(filename);
  if (!expected) {
    return { ok: false, reason: `Unsupported extension on "${filename}"; expected .docx or .pdf.` };
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Content, "base64");
  } catch (err) {
    return { ok: false, reason: `Cannot decode base64 content: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (buffer.length < 4) {
    return { ok: false, reason: "File is smaller than 4 bytes — cannot validate signature." };
  }
  const isPk = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  if (expected === "docx" && !isPk) {
    return { ok: false, reason: `"${filename}" has .docx extension but is not a valid DOCX/ZIP (PK signature missing). Likely a renamed PDF.` };
  }
  if (expected === "pdf" && !isPdf) {
    return { ok: false, reason: `"${filename}" has .pdf extension but is not a valid PDF (%PDF signature missing). Likely a DOCX renamed to .pdf.` };
  }
  return { ok: true, detected: expected };
}

export type PdfRequirementCheck =
  | { ok: true; warnings?: string[] }
  | { ok: false; code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE"; missing: string[]; reason: string }
  | { ok: false; code: "DOCX_REQUIRED_BUT_MISSING"; missing: string[]; reason: string };

/**
 * Verify that the engine has produced every tender-required format.
 *
 * The PDF converter is not currently implemented inline; when a
 * tender requires PDF and the engine only stores DOCX, this returns
 * PDF_REQUIRED_CONVERSION_UNAVAILABLE so the route can block with a
 * clear error rather than silently shipping DOCX under a .pdf name.
 *
 * `generated` is the set of file extensions present (lowercase,
 * dot-stripped). The caller derives this from the generated docs
 * before calling.
 */
export function checkTenderFormatCoverage(
  policy: TenderFormatPolicy,
  generatedExtensions: ReadonlyArray<string>,
): PdfRequirementCheck {
  const have = new Set(generatedExtensions.map((e) => e.toLowerCase().replace(/^\.+/, "")));
  const missingFormats: RequiredExportFormat[] = [];
  if (policy.requiresPdf && !have.has("pdf")) missingFormats.push("pdf");
  if (policy.requiresDocx && !have.has("docx") && !have.has("doc")) missingFormats.push("docx");

  if (missingFormats.includes("pdf")) {
    return {
      ok: false,
      code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE",
      missing: policy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName),
      reason: `Tender requires PDF output (${policy.perFile.filter((p) => p.format === "pdf").map((p) => p.exactFileName).join(", ")}) but only DOCX files are generated. PDF conversion is not currently available — generate the PDF separately and upload it, or contact the maintainer to enable in-engine PDF rendering.`,
    };
  }
  if (missingFormats.includes("docx")) {
    return {
      ok: false,
      code: "DOCX_REQUIRED_BUT_MISSING",
      missing: policy.perFile.filter((p) => p.format === "docx").map((p) => p.exactFileName),
      reason: `Tender requires DOCX output but the generated set has no DOCX file.`,
    };
  }
  return { ok: true };
}

/* ─── 2. BRANDING / SIGNATURE / STAMP POLICY ─────────────────────── */

export type BrandingPolicy = {
  /** Tender DOES NOT prohibit branding/letterhead/logos. */
  brandingAllowed: boolean;
  /** Tender DOES NOT prohibit signatures. */
  signatureAllowed: boolean;
  /** Tender DOES NOT prohibit stamps. */
  stampAllowed: boolean;
  /** Specific verbatim sentences in the tender that triggered each restriction. */
  blockers: Array<{
    kind: "branding" | "signature" | "stamp" | "anonymous";
    sourcePhrase: string;
  }>;
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

/**
 * Scan the tender text and return the branding/signature/stamp
 * policy. Conservative by design: triggering any anonymous-
 * submission pattern blocks ALL THREE asset types (branding,
 * signature, stamp), because the canonical anonymous-bid rule is
 * "remove every vendor-identifying mark."
 *
 * Returns the structured policy; the caller (export-readiness or
 * the download route) decides what to do with it.
 */
export function detectBrandingPolicy(tenderText: string): BrandingPolicy {
  const blockers: BrandingPolicy["blockers"] = [];
  const safeText = (tenderText ?? "").slice(0, 200_000); // bounded scan

  for (const re of BRANDING_PROHIBITION_PATTERNS) {
    const m = safeText.match(re);
    if (m) blockers.push({ kind: "branding", sourcePhrase: m[0].slice(0, 200) });
  }
  for (const re of SIGNATURE_PROHIBITION_PATTERNS) {
    const m = safeText.match(re);
    if (m) blockers.push({ kind: "signature", sourcePhrase: m[0].slice(0, 200) });
  }
  for (const re of STAMP_PROHIBITION_PATTERNS) {
    const m = safeText.match(re);
    if (m) blockers.push({ kind: "stamp", sourcePhrase: m[0].slice(0, 200) });
  }
  for (const re of ANONYMOUS_SUBMISSION_PATTERNS) {
    const m = safeText.match(re);
    if (m) blockers.push({ kind: "anonymous", sourcePhrase: m[0].slice(0, 200) });
  }

  const anonymous = blockers.some((b) => b.kind === "anonymous");
  return {
    brandingAllowed: !anonymous && !blockers.some((b) => b.kind === "branding"),
    signatureAllowed: !anonymous && !blockers.some((b) => b.kind === "signature"),
    stampAllowed: !anonymous && !blockers.some((b) => b.kind === "stamp"),
    blockers,
  };
}

/**
 * Combine the tender policy with the firm's AppSettings toggles to
 * produce the FINAL applied-status for each asset.
 *
 * `appSettings` carries the firm-side defaults; tender restrictions
 * always override the firm's preference (the tender wins).
 */
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
  appSettings: {
    allowBrandingDefault?: boolean | null;
    allowSignatureDefault?: boolean | null;
    allowStampDefault?: boolean | null;
  },
): ExportAssetStatus {
  // appSettings null/undefined is treated as "no firm preference" →
  // default ON (matching pre-this-module behaviour when AppSettings
  // toggles aren't configured).
  const settingBranding = appSettings.allowBrandingDefault !== false;
  const settingSignature = appSettings.allowSignatureDefault !== false;
  const settingStamp = appSettings.allowStampDefault !== false;
  return {
    brandingAllowed: tenderPolicy.brandingAllowed,
    brandingApplied: tenderPolicy.brandingAllowed && settingBranding,
    signatureAllowed: tenderPolicy.signatureAllowed,
    signatureApplied: tenderPolicy.signatureAllowed && settingSignature,
    stampAllowed: tenderPolicy.stampAllowed,
    stampApplied: tenderPolicy.stampAllowed && settingStamp,
    policyBlockers: tenderPolicy.blockers,
  };
}

export const __testing__ = {
  BRANDING_PROHIBITION_PATTERNS,
  SIGNATURE_PROHIBITION_PATTERNS,
  STAMP_PROHIBITION_PATTERNS,
  ANONYMOUS_SUBMISSION_PATTERNS,
  collectExactFilenames,
  formatFromExtension,
};
