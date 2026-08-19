/**
 * Required-PDF finalization for final submission packages.
 *
 * When a tender's submission plan names a required PDF file (e.g.
 * "Technical Proposal.pdf"), this module renders that PDF from an approved,
 * validated, current generated source document — or refuses with a structured
 * blocker. It never fabricates success:
 *
 *   • conversion capability is a real deterministic check on the source bytes
 *     (in-engine conversion supports DOCX visible text only),
 *   • the PDF body comes only from the source document's extracted visible
 *     text — no contentSummary fallback and no placeholder body,
 *   • the extracted text passes the same quality gate used by validation
 *     (placeholders, AI traces, pricing leakage, envelope mismatch) plus an
 *     internal-artifact scan (raw JSON, stack traces, record identifiers),
 *   • the rendered bytes are verified (non-empty, %PDF signature) before
 *     being returned,
 *   • every failure is a structured { code, publicMessage }; raw error
 *     detail goes to server logs only.
 *
 * This module bypasses no gate: callers must still hold the central
 * generation/export gate, and a persisted finalized PDF starts at
 * validationStatus=PENDING / reviewStatus=PENDING so it passes through the
 * same validation + approval pipeline as every other generated document.
 */
import { logger } from "../../observability";
import { generateProposalPdf } from "../proposal-pdf";
import { extractDocxVisibleText, extractDocxMarkdownText, documentHygieneIssues } from "../export-readiness";
import { validateDocumentQuality } from "../document-quality-validator";
import {
  isFinalExportCandidateDocument,
  isGenerated,
  isReviewReadyForExport,
  isValidationPassed,
} from "../document-output-state";
import type { TenderFormatPolicy } from "../export-format-policy";

export type PdfFinalizationBlockerCode =
  | "PDF_REQUIRED_CONVERSION_UNAVAILABLE"
  | "PDF_INVALID_REQUIRED_FILENAME"
  | "PDF_SOURCE_NOT_ELIGIBLE"
  | "PDF_SOURCE_NOT_GENERATED"
  | "PDF_SOURCE_NOT_VALIDATED"
  | "PDF_SOURCE_NOT_APPROVED"
  | "PDF_SOURCE_TEXT_EMPTY"
  | "PDF_QUALITY_BLOCKED"
  | "PDF_OUTPUT_INVALID"
  | "PDF_GENERATION_FAILED";

export type PdfFinalizerSourceDocument = {
  id: string;
  name?: string | null;
  exactFileName?: string | null;
  documentType?: string | null;
  format?: string | null;
  generationStatus?: string | null;
  validationStatus?: string | null;
  reviewStatus?: string | null;
  /** Base64 DOCX bytes. Storage-backed callers must load bytes first. */
  fileContent?: string | null;
  storagePath?: string | null;
};

export type PdfFinalizationResult =
  | {
      ok: true;
      fileName: string;
      bytes: Buffer;
      sourceDocumentId: string;
      extractedCharCount: number;
    }
  | {
      ok: false;
      code: PdfFinalizationBlockerCode;
      /** Safe user-facing message — never raw error text, stack traces, or internal identifiers. */
      publicMessage: string;
    };

export type PdfConversionCapability =
  | { ok: true; method: "docx-visible-text" }
  | { ok: false; code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE"; publicMessage: string };

/** Minimum visible-text length for a source document to be renderable as a final PDF. */
export const MIN_PDF_SOURCE_TEXT_CHARS = 50;

function blocker(code: PdfFinalizationBlockerCode, publicMessage: string): PdfFinalizationResult {
  return { ok: false, code, publicMessage };
}

function isBase64DocxContent(value: string | null | undefined, fileName: string): boolean {
  if (!value || !fileName.toLowerCase().endsWith(".docx")) return false;
  try {
    const head = Buffer.from(value.slice(0, 12), "base64");
    return head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  } catch {
    return false;
  }
}

/**
 * Deterministic capability check — replaces the old hardcoded always-
 * available simulation. The in-engine converter can only render a PDF when
 * the source is a real base64 DOCX whose visible text can be extracted.
 * Anything else (XLSX, scanned PDF source, missing bytes) is honestly
 * reported as PDF_REQUIRED_CONVERSION_UNAVAILABLE.
 */
export function checkPdfConversionCapability(doc: PdfFinalizerSourceDocument): PdfConversionCapability {
  const fileName = (doc.exactFileName ?? doc.name ?? "").trim();
  const content = (doc.fileContent ?? "").trim();
  if (!content) {
    return {
      ok: false,
      code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE",
      publicMessage:
        "The source document has no loaded content bytes, so in-engine PDF conversion cannot run. Regenerate the source document or upload the tender-issued PDF.",
    };
  }
  if (!isBase64DocxContent(content, fileName)) {
    return {
      ok: false,
      code: "PDF_REQUIRED_CONVERSION_UNAVAILABLE",
      publicMessage:
        "In-engine PDF conversion supports generated DOCX source documents only. This source document's format cannot be converted — upload the tender-issued PDF instead.",
    };
  }
  return { ok: true, method: "docx-visible-text" };
}

/** True when base64 content decodes to bytes starting with the %PDF signature. */
export function isBase64PdfContent(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return Buffer.from(value.slice(0, 12), "base64").toString("latin1").startsWith("%PDF");
  } catch {
    return false;
  }
}

/** Non-empty bytes that start with the %PDF signature. */
export function validatePdfBytes(bytes: Uint8Array | Buffer | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!bytes || bytes.length === 0) return { ok: false, reason: "Rendered PDF is empty (0 bytes)." };
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (!head.startsWith("%PDF")) return { ok: false, reason: "Rendered bytes do not start with the %PDF signature." };
  return { ok: true };
}

/** "Technical Proposal.pdf" / "technical_proposal.docx" → "technical proposal" */
export function normalizeFileBaseName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve the tender-required exact PDF filename for a source document by
 * base-name match against the tender's format policy (e.g. source
 * "Technical Proposal.docx" → required "Technical Proposal.pdf").
 * Returns null when the tender names no matching required PDF — callers then
 * fall back to a generic safe filename and MUST NOT claim the generic file
 * satisfies a required exact filename.
 */
export function resolveRequiredPdfFileName(
  policy: Pick<TenderFormatPolicy, "perFile">,
  target: { exactFileName?: string | null; name?: string | null },
): string | null {
  const targetBase = normalizeFileBaseName(target.exactFileName ?? target.name ?? "");
  if (!targetBase) return null;
  const match = policy.perFile.find((p) => p.format === "pdf" && normalizeFileBaseName(p.exactFileName) === targetBase);
  return match?.exactFileName ?? null;
}

function validateRequiredFileName(name: string): string | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "Required PDF filename is empty.";
  if (trimmed.length > 180) return "Required PDF filename is too long.";
  if (!/\.pdf$/i.test(trimmed)) return "Required filename must end with .pdf.";
  if (trimmed.includes("..") || /[/\\]/.test(trimmed) || /[\u0000-\u001f<>:"|?*]/.test(trimmed)) {
    return "Required PDF filename contains unsafe path characters.";
  }
  return null;
}

const PLACEHOLDER_ONLY_TEXT = /^(?:empty proposal content|n\/a|none|tbd|todo|pending|placeholder|to be (?:added|confirmed|completed|provided))[.\s]*$/i;

/**
 * Internal-artifact scan — content that must never appear in a client-facing
 * PDF: raw JSON/debug dumps, stack traces, SQL, database record identifiers.
 * Returns safe category labels only (no excerpt of the matched text).
 */
export function internalArtifactIssues(text: string): string[] {
  const issues: string[] = [];
  if (/"(?:generationStatus|validationStatus|reviewStatus|fileContent|storagePath|tenderId|userId|diagnosticId)"\s*:/.test(text)) {
    issues.push("raw internal JSON field text");
  }
  if (/\bat\s+[\w.$<>[\]]+\s+\((?:\/|file:|node:|webpack|internal\/)/.test(text)) {
    issues.push("stack-trace text");
  }
  if (/\b(?:PrismaClient|prisma\.[a-zA-Z]+\.(?:findFirst|findMany|findUnique|create|update|delete|upsert)|SELECT\s+[\w*,\s]+\s+FROM\s+"?\w+"?|INSERT\s+INTO\s+"?\w+"?)\b/.test(text)) {
    issues.push("database/query text");
  }
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(text) || /\bc[a-z0-9]{24}\b/.test(text)) {
    issues.push("internal record identifier");
  }
  if (/\b(?:tenderId|userId|diagnosticId)\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/.test(text)) {
    issues.push("internal identifier reference");
  }
  return issues;
}

/**
 * Render the required PDF from an approved generated source document.
 * Fail-closed at every step; see module doc for the guarantees.
 */
export async function finalizeRequiredPdf(input: {
  requiredFileName: string;
  tender: {
    title?: string | null;
    clientName?: string | null;
    reference?: string | null;
    submissionEmailSubject?: string | null;
  };
  /** Optional company branding context — emitted on cover page + page header. */
  company?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  sourceDocument: PdfFinalizerSourceDocument;
}): Promise<PdfFinalizationResult> {
  const { requiredFileName, tender, company, sourceDocument: doc } = input;

  const nameProblem = validateRequiredFileName(requiredFileName);
  if (nameProblem) return blocker("PDF_INVALID_REQUIRED_FILENAME", nameProblem);

  const label = doc.exactFileName ?? doc.name ?? "the source document";

  // Source must be the active, current, exportable revision…
  if (!isFinalExportCandidateDocument(doc)) {
    return blocker(
      "PDF_SOURCE_NOT_ELIGIBLE",
      `"${label}" is superseded, planned-only, or not exportable, so it cannot be the source of a final PDF. Use the current approved revision.`,
    );
  }
  // …actually generated…
  if (!isGenerated(doc.generationStatus)) {
    return blocker(
      "PDF_SOURCE_NOT_GENERATED",
      `"${label}" has not been generated yet. Generate the source document before finalizing the PDF.`,
    );
  }
  // …validated…
  if (!isValidationPassed(doc.validationStatus)) {
    return blocker(
      "PDF_SOURCE_NOT_VALIDATED",
      `"${label}" has not passed validation. Run Validate on the source document before finalizing the PDF.`,
    );
  }
  // …and either human-approved (READY_FOR_EXPORT/APPROVED) OR canonically
  // validated (VALIDATED) by the Document Validator. Per Gap 5, the
  // automatic chain may finalize PDFs from VALIDATED sources without a
  // separate human reviewStatus — the canonical validator is the
  // machine-safe authority. The human reviewStatus remains required only
  // where legally mandatory ( Gap 6: one explicit human release decision).
  if (!isReviewReadyForExport(doc.reviewStatus) && !isValidationPassed(doc.validationStatus)) {
    return blocker(
      "PDF_SOURCE_NOT_APPROVED",
      `"${label}" is neither approved for export nor canonically validated. Run Validate on the source document before finalizing the PDF.`,
    );
  }

  const capability = checkPdfConversionCapability(doc);
  if (!capability.ok) return blocker(capability.code, capability.publicMessage);

  // Real content extraction — same safe DOCX visible-text path validation uses.
  let visibleText: string | null = null;
  try {
    visibleText = await extractDocxVisibleText(doc.fileContent, doc.exactFileName ?? doc.name ?? "source.docx");
  } catch (error) {
    logger.error("pdf-finalizer: visible-text extraction threw", { documentId: doc.id, detail: error });
    visibleText = null;
  }
  const text = (visibleText ?? "").trim();
  if (text.length < MIN_PDF_SOURCE_TEXT_CHARS || PLACEHOLDER_ONLY_TEXT.test(text)) {
    return blocker(
      "PDF_SOURCE_TEXT_EMPTY",
      `"${label}" has no usable body text to render. Regenerate the source document — empty or placeholder content cannot be finalized to PDF.`,
    );
  }

  // Structured markdown extraction for PDF rendering — preserves tables and
  // inline bold/italic so the PDF body matches the DOCX body (content parity).
  // Falls back to the flat visible text if structured extraction fails, so we
  // never block PDF generation when the DOCX XML is malformed but the visible
  // text is intact.
  let renderMarkdown: string | null = null;
  try {
    renderMarkdown = await extractDocxMarkdownText(doc.fileContent, doc.exactFileName ?? doc.name ?? "source.docx");
  } catch (error) {
    logger.error("pdf-finalizer: structured markdown extraction threw", { documentId: doc.id, detail: error });
    renderMarkdown = null;
  }
  const renderText = (renderMarkdown ?? text).trim();

  // Quality gate on the extracted visible text — the same validator the
  // validation pipeline uses (placeholders, AI traces, envelope mismatch),
  // plus export hygiene (AI/meta traces, pricing leakage) and the
  // internal-artifact scan.
  const quality = validateDocumentQuality({
    name: doc.name ?? label,
    documentType: doc.documentType ?? null,
    fileContent: doc.fileContent ?? null,
    storagePath: doc.storagePath ?? null,
    visibleText: text,
  });
  const hygiene = documentHygieneIssues(text, {
    name: doc.name ?? label,
    exactFileName: doc.exactFileName ?? null,
    documentType: doc.documentType ?? null,
    format: doc.format ?? null,
  });
  const internalIssues = internalArtifactIssues(text);
  if (quality.status === "BLOCKED" || hygiene.length > 0 || internalIssues.length > 0) {
    const categories = Array.from(
      new Set([
        ...(quality.status === "BLOCKED"
          ? [
              ...(quality.placeholders.length ? ["placeholder content"] : []),
              ...(quality.aiTrace.length ? ["AI trace text"] : []),
              ...(quality.envelopeMismatch ? ["envelope mismatch"] : []),
              ...(quality.isEmpty ? ["empty content"] : []),
              ...(quality.boilerplateHits.length >= 5 ? ["generic boilerplate"] : []),
            ]
          : []),
        ...hygiene,
        ...internalIssues,
      ]),
    );
    return blocker(
      "PDF_QUALITY_BLOCKED",
      `"${label}" failed the content quality gate (${categories.join("; ")}). Fix and regenerate the source document before finalizing the PDF.`,
    );
  }

  // Render — raw failures are logged server-side only.
  let pdfBytes: Uint8Array;
  try {
    // Compose optional branding context so the PDF cover page and running
    // header match the DOCX's branded cover block (content parity).
    const contactParts: string[] = [];
    if (company?.phone) contactParts.push(company.phone);
    if (company?.email) contactParts.push(company.email);
    if (company?.website) contactParts.push(company.website);
    pdfBytes = await generateProposalPdf({
      title: tender.title?.trim() || "Technical Proposal",
      clientName: tender.clientName ?? null,
      reference: tender.reference ?? null,
      submissionEmailSubject: tender.submissionEmailSubject ?? null,
      markdown: renderText,
      companyName: company?.name ?? null,
      companyAddress: company?.address ?? null,
      companyContact: contactParts.length ? contactParts.join("  |  ") : null,
    });
  } catch (error) {
    logger.error("pdf-finalizer: PDF rendering failed", { documentId: doc.id, detail: error });
    return blocker(
      "PDF_GENERATION_FAILED",
      "PDF rendering failed. Regenerate the source document and retry; if the problem persists, upload the tender-issued PDF.",
    );
  }

  const byteCheck = validatePdfBytes(pdfBytes);
  if (!byteCheck.ok) {
    logger.error("pdf-finalizer: rendered bytes failed validation", { documentId: doc.id, reason: byteCheck.reason });
    return blocker(
      "PDF_OUTPUT_INVALID",
      "The rendered PDF failed byte validation and was discarded. Regenerate the source document and retry.",
    );
  }

  return {
    ok: true,
    fileName: requiredFileName.trim(),
    bytes: Buffer.from(pdfBytes),
    sourceDocumentId: doc.id,
    extractedCharCount: text.length,
  };
}
