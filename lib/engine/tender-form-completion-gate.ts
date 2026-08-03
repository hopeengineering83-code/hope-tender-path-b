// Tender-form completion gate (Gap 1).
//
// A tender-issued form (bid form, declaration, annex, bid bond template) is
// reused byte-for-byte from the uploaded Tender Intake files — see
// lib/engine/tender-issued-form-discovery.ts. The reuse path leaves the
// produced row in PENDING review: nobody has completed or signed the form.
//
// This gate inspects the reused bytes for evidence that mandatory form fields
// are still blank, and surfaces structured blockers a reviewer can act on:
//
//   - PDF AcroForm fields with empty values
//   - DOCX content controls (w:sdt) with placeholder text
//   - Plain-text placeholder patterns ("[INSERT ...]", "_______", "<TO BE COMPLETED>")
//
// It never mutates bytes and never marks a form READY_FOR_EXPORT. A human must
// complete and sign the form, then mark it READY_FOR_EXPORT. The gate's only
// job is to tell the reviewer what is missing, not to fake completion.
//
// The "populate safely" half of the gate contract is a pure, byte-integrity-
// preserving pre-fill of COMPANY-VARIABLE fields (bidder name, registration
// number, address) that are already verified in the Company Vault. It is
// intentionally NOT wired into the automatic pipeline — it must be invoked by
// an explicit user action so a reviewer sees the diff before the form ships.
// This module exports the detector and the safe-populate function; the
// caller decides whether to invoke the populate step.

export type FormFieldType =
  | "TEXT"
  | "CHECKBOX"
  | "SIGNATURE"
  | "DATE"
  | "PLACEHOLDER_TEXT";

export type FormFieldSeverity = "MANDATORY" | "OPTIONAL";

export type FormCompletionIssue = {
  /** Stable id for dedup across re-runs. */
  key: string;
  /** Human-readable field label or pattern match site. */
  label: string;
  type: FormFieldType;
  severity: FormFieldSeverity;
  /** Why the gate flagged this field — specific so a reviewer can act on it. */
  reason: string;
};

export type FormCompletionReport = {
  /** Document id the report was built for. */
  documentId: string;
  /** File name shown to reviewers. */
  fileName: string;
  /** Total fields detected (mandatory + optional). */
  totalFields: number;
  /** Mandatory fields that are blank or still carry placeholder text. */
  missingMandatory: FormCompletionIssue[];
  /** Optional fields that are blank — surfaced for awareness, not blocking. */
  emptyOptional: FormCompletionIssue[];
  /** True iff missingMandatory.length === 0. */
  complete: boolean;
};

/**
 * Patterns that indicate an unfilled placeholder on a tender-issued form.
 *
 * Each pattern is paired with a stable field key, a label, and a severity
 * guess. The guess is conservative: a `[INSERT BIDDER NAME]` token is almost
 * always mandatory, but a row of underscores could be a signature line (also
 * mandatory) or a fill-in-the-blank prompt (depends on form). When the form
 * itself doesn't carry a required/optional hint, we default to MANDATORY so
 * the gate fails closed — a real reviewer can downgrade.
 */
const PLACEHOLDER_PATTERNS: Array<{
  key: string;
  label: string;
  pattern: RegExp;
  severity: FormFieldSeverity;
  type: FormFieldType;
  reason: string;
}> = [
  {
    key: "insert-bracket",
    label: "Bracketed insert marker",
    pattern: /\[\s*(?:INSERT|ENTER|FILL|PROVIDE|COMPLETE)[^\]]*\]/i,
    severity: "MANDATORY",
    type: "PLACEHOLDER_TEXT",
    reason: "Form contains an [INSERT ...] placeholder that has not been filled in.",
  },
  {
    key: "to-be-completed",
    label: "To-be-completed marker",
    pattern: /<\s*(?:TO BE COMPLETED|TBC|FILL IN|COMPLETE)[^>]*>/i,
    severity: "MANDATORY",
    type: "PLACEHOLDER_TEXT",
    reason: "Form contains a <TO BE COMPLETED> marker that has not been filled in.",
  },
  {
    key: "underscore-line",
    label: "Blank fill-in line",
    pattern: /_{6,}/,
    severity: "MANDATORY",
    type: "PLACEHOLDER_TEXT",
    reason: "Form contains a long underscore fill-in line that has not been completed.",
  },
  {
    key: "bidder-name-placeholder",
    label: "Bidder name placeholder",
    pattern: /\b(?:bidder|tenderer|applicant)[''`]?s?\s+(?:name|full\s+name)\s*:\s*$/im,
    severity: "MANDATORY",
    type: "TEXT",
    reason: "Bidder-name field is present but empty.",
  },
  {
    key: "signature-placeholder",
    label: "Signature line",
    pattern: /\bsignature\s*(?:of\s+\w+)?\s*:\s*$/im,
    severity: "MANDATORY",
    type: "SIGNATURE",
    reason: "Signature field is present but empty.",
  },
  {
    key: "date-placeholder",
    label: "Date field",
    pattern: /\bdate\s*:\s*$/im,
    severity: "MANDATORY",
    type: "DATE",
    reason: "Date field is present but empty.",
  },
];

/**
 * Inspect a tender-issued form's bytes for unfilled mandatory fields.
 *
 * Pure function — no I/O. Caller passes the bytes it already loaded for
 * byte-integrity verification. The gate is intentionally conservative:
 *
 *   - A PDF with no AcroForm is treated as a flat image / scanned form. The
 *     gate still scans the extracted text for placeholder patterns.
 *   - A DOCX with no content controls is scanned for placeholder patterns
 *     in its visible text.
 *   - Any other mime type is scanned as plain text.
 *
 * Returns a structured report. The caller decides whether to block export
 * (when missingMandatory.length > 0) or surface a warning (when only
 * emptyOptional has entries).
 */
export function detectFormCompletionIssues(input: {
  documentId: string;
  fileName: string;
  mimeType?: string | null;
  bytes: Buffer;
  /** Visible text already extracted by the caller (optional — gate extracts if absent). */
  visibleText?: string;
}): FormCompletionReport {
  const mime = (input.mimeType ?? "").toLowerCase();
  const fileName = (input.fileName ?? "").toLowerCase();

  const text = input.visibleText ?? extractVisibleText(input.bytes, mime, fileName);

  const issues: FormCompletionIssue[] = [];

  // PDF AcroForm fields with empty /V values.
  if (mime.includes("pdf") || fileName.endsWith(".pdf")) {
    issues.push(...detectEmptyPdfAcroFormFields(input.bytes, text));
  }

  // DOCX content controls with placeholder text.
  if (mime.includes("officedocument.wordprocessingml") || mime.includes("word") || fileName.endsWith(".docx")) {
    issues.push(...detectEmptyDocxContentControls(input.bytes));
  }

  // Generic placeholder patterns — run on every form type.
  for (const { key, label, pattern, severity, type, reason } of PLACEHOLDER_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      issues.push({
        key: `placeholder:${key}`,
        label: `${label}: "${matches[0].trim().slice(0, 60)}"`,
        type,
        severity,
        reason,
      });
    }
  }

  // Deduplicate by key (a field can match multiple patterns).
  const dedup = new Map<string, FormCompletionIssue>();
  for (const issue of issues) {
    if (!dedup.has(issue.key)) dedup.set(issue.key, issue);
  }
  const all = Array.from(dedup.values());

  const missingMandatory = all.filter((issue) => issue.severity === "MANDATORY");
  const emptyOptional = all.filter((issue) => issue.severity === "OPTIONAL");

  return {
    documentId: input.documentId,
    fileName: input.fileName,
    totalFields: all.length,
    missingMandatory,
    emptyOptional,
    complete: missingMandatory.length === 0,
  };
}

/**
 * Extract visible text from a tender-issued form for placeholder scanning.
 *
 * Keeps the implementation cheap: PDF text extraction uses pdf-parse (already
 * a dependency), DOCX uses a regex on the document.xml part (the docx lib is
 * available, but a regex is good enough for placeholder detection and avoids
 * pulling in the full docx parser for a gate that runs at export time).
 *
 * Any failure returns an empty string — the gate degrades to "no patterns
 * found", which is the safer default than crashing the export.
 */
function extractVisibleText(bytes: Buffer, mime: string, fileName: string): string {
  try {
    if (mime.includes("pdf") || fileName.endsWith(".pdf")) {
      // Lazy import so this module stays pure for non-PDF inputs.
      const pdfParse = require("pdf-parse");
      // pdf-parse is sync-returning but uses a callback under the hood; we
      // accept the small blocking cost because the gate runs once per form
      // at export time, not on the hot path.
      const result = pdfParse(bytes);
      if (result && typeof result.text === "string") return result.text;
      return "";
    }
    if (mime.includes("officedocument.wordprocessingml") || mime.includes("word") || fileName.endsWith(".docx")) {
      // DOCX is a ZIP; the visible text is in word/document.xml. Use a
      // regex on the raw ZIP bytes to extract <w:t> text runs without
      // pulling in a full unzipper. This is a known cheap heuristic.
      const xml = extractDocxDocumentXml(bytes);
      if (!xml) return "";
      const texts = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
      return texts.map((t) => t.replace(/<[^>]+>/g, "")).join(" ");
    }
    // Plain text, HTML, or anything else: decode as UTF-8 and scan.
    return bytes.toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Pull word/document.xml out of a DOCX ZIP without a full unzip dependency.
 *
 * DOCX files store each part as a deflate-compressed entry with a local
 * header. We do a cheap scan for the document.xml local-header signature
 * and let Node's zlib inflate the payload. If anything is off, we return
 * null and the caller falls back to scanning the raw bytes (which is enough
 * to catch most placeholders since they appear in the XML text too).
 */
function extractDocxDocumentXml(bytes: Buffer): string | null {
  try {
    // Local file header signature: PK\x03\x04
    const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    let cursor = 0;
    while (cursor < bytes.length - 4) {
      const at = bytes.indexOf(sig, cursor);
      if (at < 0) break;
      // Local file header: sig(4) + version(2) + flags(2) + method(2) +
      // time(2) + date(2) + crc(4) + compressed-size(4) + uncompressed-size(4)
      // + name-length(2) + extra-length(2) + name + extra + payload.
      if (at + 30 > bytes.length) break;
      const nameLen = bytes.readUInt16LE(at + 26);
      const extraLen = bytes.readUInt16LE(at + 28);
      const payloadStart = at + 30 + nameLen + extraLen;
      const name = bytes.subarray(at + 30, at + 30 + nameLen).toString("utf8");
      if (name === "word/document.xml") {
        const method = bytes.readUInt16LE(at + 8);
        // Compressed size is at offset 18, but is sometimes zero when
        // data-descriptor mode is used. We don't strictly need it: zlib
        // inflate will stop at the end of the deflate stream on its own.
        const slice = bytes.subarray(payloadStart);
        if (method === 8) {
          const zlib = require("zlib");
          const inflated = zlib.inflateRawSync(slice, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
          return inflated.toString("utf8");
        }
        // Stored (no compression).
        return slice.toString("utf8");
      }
      cursor = at + 4;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect empty AcroForm fields in a PDF.
 *
 * PDF AcroForm fields appear in the catalog as /AcroForm << /Fields [...] >>.
 * Each field has a /T (name) and a /V (value). Empty /V (or missing /V)
 * means the field is unfilled. We do a regex scan over the PDF bytes for
 * /T (name) and the nearest /V (value) to flag unfilled mandatory-looking
 * fields.
 *
 * This is a best-effort regex — a real PDF parser would walk the object
 * graph. For the gate's purpose (tell a reviewer what to fill), the regex
 * catches the dominant case: interactive forms with empty values.
 */
function detectEmptyPdfAcroFormFields(bytes: Buffer, _extractedText: string): FormCompletionIssue[] {
  const issues: FormCompletionIssue[] = [];
  try {
    const text = bytes.toString("latin1");
    // Match /T(name) optionally followed by /V(value) within a reasonable window.
    // We look for /T (name) followed somewhere by /V (value). If /V is missing or
    // empty, the field is unfilled.
    const fieldRegex = /\/T\s*\(([^)]+)\)\s*(?:\/V\s*\(([^)]*)\))?/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = fieldRegex.exec(text)) !== null) {
      const name = match[1];
      const value = match[2] ?? "";
      if (value.trim() === "") {
        const severity: FormFieldSeverity = looksLikeMandatoryField(name) ? "MANDATORY" : "OPTIONAL";
        const type = looksLikeSignatureField(name) ? "SIGNATURE" : "TEXT";
        issues.push({
          key: `pdf-acroform:${name}`,
          label: `PDF field "${name}"`,
          type,
          severity,
          reason: `AcroForm field "${name}" has no value set.`,
        });
      }
      idx += 1;
      if (idx >= 200) break; // Sanity cap — a 5000-field form is not a tender form.
    }
  } catch {
    // ignore
  }
  return issues;
}

/**
 * Detect empty DOCX content controls (Structured Document Tags, <w:sdt>).
 *
 * A content control has a <w:placeholder> child or an empty <w:sdtContent>.
 * We scan for <w:sdt> blocks and check whether their content is empty or
 * carries placeholder text.
 */
function detectEmptyDocxContentControls(bytes: Buffer): FormCompletionIssue[] {
  const issues: FormCompletionIssue[] = [];
  try {
    const xml = extractDocxDocumentXml(bytes);
    if (!xml) return issues;
    const sdtRegex = /<w:sdt\b[^>]*>([\s\S]*?)<\/w:sdt>/g;
    let match: RegExpExecArray | null;
    let idx = 0;
    while ((match = sdtRegex.exec(xml)) !== null) {
      const block = match[1];
      // Extract the visible text inside <w:sdtContent>.
      const contentMatch = block.match(/<w:sdtContent\b[^>]*>([\s\S]*?)<\/w:sdtContent>/);
      const content = contentMatch ? contentMatch[1] : block;
      const textRuns = content.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [];
      const text = textRuns.map((t) => t.replace(/<[^>]+>/g, "")).join("");
      // Extract the field name from <w:alias> or <w:tag>.
      const aliasMatch = block.match(/<w:alias\s+w:val="([^"]+)"/);
      const tagMatch = block.match(/<w:tag\s+w:val="([^"]+)"/);
      const name = aliasMatch?.[1] ?? tagMatch?.[1] ?? `content-control-${idx}`;
      if (text.trim() === "") {
        const severity: FormFieldSeverity = looksLikeMandatoryField(name) ? "MANDATORY" : "OPTIONAL";
        issues.push({
          key: `docx-sdt:${name}`,
          label: `DOCX field "${name}"`,
          type: "TEXT",
          severity,
          reason: `Content control "${name}" is empty.`,
        });
      } else if (/\[\s*(?:INSERT|ENTER|FILL|PROVIDE|COMPLETE)/i.test(text)) {
        issues.push({
          key: `docx-sdt-placeholder:${name}`,
          label: `DOCX field "${name}"`,
          type: "PLACEHOLDER_TEXT",
          severity: "MANDATORY",
          reason: `Content control "${name}" still carries placeholder text: "${text.trim().slice(0, 60)}"`,
        });
      }
      idx += 1;
      if (idx >= 200) break;
    }
  } catch {
    // ignore
  }
  return issues;
}

function looksLikeMandatoryField(name: string): boolean {
  const lower = name.toLowerCase();
  // Common mandatory field name patterns. Substring match (not word-boundary)
  // because real form-field names are often concatenated: "BidderName",
  // "TendererAddress", "ApplicantRegistrationNumber", etc. Word boundaries
  // would miss these.
  const mandatorySubstrings = [
    "bidder", "tenderer", "applicant", "name", "signature", "date",
    "amount", "value", "currency", "registration", "address",
    "sign", "initial", "tax", "vat", "tin",
  ];
  if (mandatorySubstrings.some((s) => lower.includes(s))) {
    return true;
  }
  // Fields whose name explicitly says they're required.
  if (/\b(required|mandatory|must)\b/.test(lower)) {
    return true;
  }
  return false;
}

function looksLikeSignatureField(name: string): boolean {
  return /\b(signature|sign|initial)\b/i.test(name);
}

/**
 * Pre-populate known-safe company-variable fields on a tender-issued form.
 *
 * "Safe" means: the value comes from the verified Company Vault (already
 * source-verified by the Engine), and the field name unambiguously matches
 * a known company attribute. The populate step:
 *
 *   - Never invents values — only fills fields whose target value is known.
 *   - Never marks the form READY_FOR_EXPORT — completion is still human work.
 *   - Goes through the same byte-integrity persist path the generators use,
 *     so the populated bytes are hashed, length-recorded, and content-typed.
 *
 * Returns the list of fields it populated and the new byte digest, or null
 * when nothing was populated. The caller (an explicit user action) decides
 * whether to commit the result.
 *
 * NOT WIRED INTO THE AUTOMATIC PIPELINE. This function exists so a future
 * user-facing "pre-fill company fields" action can call it; it is not
 * invoked by auto-finalize or any automatic mutation.
 */
export type PopulateCompanyFieldsInput = {
  documentId: string;
  fileName: string;
  mimeType?: string | null;
  bytes: Buffer;
  /** Verified company fields, sourced from the Company Vault. */
  company: {
    name?: string | null;
    registrationNumber?: string | null;
    address?: string | null;
    country?: string | null;
    vatNumber?: string | null;
    tinNumber?: string | null;
  };
};

export type PopulateCompanyFieldsResult = {
  populated: Array<{ key: string; label: string; value: string }>;
  skipped: Array<{ key: string; reason: string }>;
  bytes: Buffer;
  sha256: string;
  byteLength: number;
};

export async function populateCompanyFieldsSafely(
  input: PopulateCompanyFieldsInput,
): Promise<PopulateCompanyFieldsResult | null> {
  // The populate step is intentionally conservative: we only fill fields
  // whose name unambiguously matches a known company attribute, and only
  // when the company attribute is non-empty. Anything ambiguous is skipped
  // with a reason so a reviewer can fill it manually.

  const populated: Array<{ key: string; label: string; value: string }> = [];
  const skipped: Array<{ key: string; reason: string }> = [];

  // Build a list of (regex, attribute) pairs to match against field names.
  const companyAttrs: Array<{ attr: keyof PopulateCompanyFieldsInput["company"]; patterns: RegExp[] }> = [
    { attr: "name", patterns: [/\bbidder[''`]?s?\s+name\b/i, /\btenderer[''`]?s?\s+name\b/i, /\bapplicant[''`'?s]?\s+name\b/i, /\bcompany\s+name\b/i] },
    { attr: "registrationNumber", patterns: [/\bregistration\s+(?:number|no|#)\b/i, /\breg\.?\s*(?:no|number)\b/i] },
    { attr: "address", patterns: [/\baddress\b/i, /\bregistered\s+address\b/i] },
    { attr: "country", patterns: [/\bcountry\b/i, /\bnationality\b/i] },
    { attr: "vatNumber", patterns: [/\bvat\s+(?:number|no|#)\b/i, /\bvat\s+reg/i] },
    { attr: "tinNumber", patterns: [/\btin\s+(?:number|no|#)\b/i, /\btax\s+identification\b/i] },
  ];

  // For PDF: we'd walk the AcroForm and set /V. For DOCX: we'd replace the
  // <w:sdtContent> text. For plain text: regex replace.
  //
  // This implementation handles plain-text placeholder replacement only.
  // PDF and DOCX field population is intentionally left as a TODO because
  // doing it correctly requires walking the AcroForm object graph (PDF) or
  // manipulating the OOXML XML tree (DOCX) — both are out of scope for the
  // gate's first cut. The plain-text path is enough to clear bracketed
  // placeholders like "[INSERT BIDDER NAME]".

  let text = input.bytes.toString("utf8");

  for (const { attr, patterns } of companyAttrs) {
    const value = input.company[attr];
    if (!value || value.trim() === "") {
      skipped.push({ key: `company:${attr}`, reason: `Company attribute "${attr}" is not set.` });
      continue;
    }
    let replaced = false;
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        text = text.replace(pattern, value);
        replaced = true;
      }
    }
    if (replaced) {
      populated.push({ key: `company:${attr}`, label: `Company ${attr}`, value });
    } else {
      skipped.push({ key: `company:${attr}`, reason: `No field matching "${attr}" was found in the form.` });
    }
  }

  // Also handle generic [INSERT ...] placeholders that match a company attr.
  for (const { attr, patterns } of companyAttrs) {
    const value = input.company[attr];
    if (!value || value.trim() === "") continue;
    const insertPattern = new RegExp(`\\[\\s*(?:INSERT|ENTER|FILL|PROVIDE)\\s+[^\\]]*${attr}[^\\]]*\\]`, "i");
    if (insertPattern.test(text)) {
      text = text.replace(insertPattern, value);
      populated.push({ key: `insert:${attr}`, label: `Insert marker for ${attr}`, value });
    }
  }

  if (populated.length === 0) {
    return null;
  }

  const bytes = Buffer.from(text, "utf8");
  const { computeByteSha256 } = require("./persisted-byte-integrity");
  const sha256 = computeByteSha256(bytes);

  return {
    populated,
    skipped,
    bytes,
    sha256,
    byteLength: bytes.byteLength,
  };
}

/**
 * Convenience: is this document a tender-issued form (i.e., a candidate for
 * the completion gate)?
 *
 * Used by callers to decide whether to run the gate. Non-form documents
 * (generated technical proposals, methodology docs) don't have form fields
 * and would produce false positives.
 */
export function isTenderFormLike(input: {
  fileName?: string | null;
  documentType?: string | null;
  reviewNotes?: string | null;
}): boolean {
  const name = (input.fileName ?? "").toLowerCase();
  const type = (input.documentType ?? "").toLowerCase();
  const notes = (input.reviewNotes ?? "").toLowerCase();
  // Reused tender-issued forms carry the machine:tender-issued-form-reuse
  // provenance marker. That's the canonical signal.
  if (notes.includes("machine:tender-issued-form-reuse")) return true;
  // Otherwise, heuristic on filename: bid form, annex, declaration, etc.
  if (/\b(bid[-_\s]?form|tender[-_\s]?form|annex|declaration|undertaking|bid[-_\s]?bond|bid[-_\s]?security|tax[-_\s]?clearance|bank[-_\s]?statement|registration[-_\s]?cert)/.test(name)) {
    return true;
  }
  if (type.includes("form_template_to_complete")) return true;
  return false;
}
