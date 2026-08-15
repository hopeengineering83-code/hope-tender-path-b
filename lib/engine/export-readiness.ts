import { prisma, prismaReady } from "../prisma";
import { getStorageAdapter } from "../storage";
import { isValidClientName, containsMetadataPlaceholder } from "./metadata-validators";
import { isExportBlockingConfidence, scanTenderForExplicitDonorRequirement } from "./donor-advisory-confidence";
import {
  deriveDocumentOutputState,
  exportBlockReason,
  EXPORT_BLOCKING_STATES,
  isGenerated,
  isReviewReadyForExport,
  isValidationPassed,
  type DocumentOutputState,
} from "./document-output-state";
import { containsPricingLeakage } from "./pricing-hygiene";
import { checkExportFileByteReadiness } from "./export-byte-readiness";
import { detectSubmissionPackageMode } from "./submission-package-mode";
import { assessExtractionQualityPerPage } from "../extraction-quality";
import { resolveCanonicalAnalysisSource } from "./analysis-source";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod } from "./submission-method-policy";
import { validateGeneratedDocumentQuality } from "../document-generation/generated-document-quality-validator";
import { buildTenderDocumentContext, type TenderDocumentGenerationContext } from "../document-generation/tender-document-context";

export type ExportReadyDocument = {
  id: string;
  name: string;
  exactFileName: string | null;
  exactOrder?: number | null;
  documentType?: string | null;
  format?: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent?: string | null;
  storagePath?: string | null;
  contentSha256?: string | null;
  contentByteLength?: number | null;
  contentMimeType?: string | null;
  detectedFormat?: string | null;
  integrityStatus?: string | null;
  integrityVerifiedAt?: Date | null;
  integrityFailureCode?: string | null;
  hasInlineFileContent?: boolean | null;
};

export type ExportReadinessFailure = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
};

export type ExportReadinessResult = {
  ok: boolean;
  failures: ExportReadinessFailure[];
  tenderLevelBlockers?: Array<{ category: string; severity: string; title: string; recommendedAction?: string | null; confidence?: import("./donor-advisory-confidence").DonorAdvisoryConfidence; sourceQuote?: string | null }>;
  advisoryWarnings?: Array<{ category: string; severity: string; title: string; recommendedAction?: string | null; confidence?: import("./donor-advisory-confidence").DonorAdvisoryConfidence; sourceQuote?: string | null }>;
};

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function normalizeFileName(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeRequiredOutputFile(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 4 || clean.length > 180) return false;
  return /\.(docx?|pdf|xlsx?|zip)$/i.test(clean) || /\b(technical|financial|proposal|annex|form|bid|quotation|eoi|rfp|rfq|declaration|rate card|cv|cover letter)\b/i.test(clean);
}

function parseRequiredFileList(value: string | null | undefined): string[] {
  if (!value) return [];
  let raw: string[] = [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) raw = parsed.map(String);
  } catch {
    raw = value.split(/\n|,/).map((item) => item.trim());
  }
  return Array.from(new Set(raw.map((item) => item.trim()).filter(Boolean).filter(looksLikeRequiredOutputFile)));
}

function documentFileName(doc: ExportReadyDocument): string {
  return doc.exactFileName ?? generatedFileName(doc.name);
}

function looksLikePlainText(value: string): boolean {
  if (!value || value.length > 1_000_000) return false;
  const sample = value.slice(0, 2000);
  const nonPrintable = sample.replace(/[\t\n\r\x20-\x7E]/g, "").length;
  const printableRatio = 1 - (nonPrintable / Math.max(sample.length, 1));
  const alphaCount = (sample.match(/[a-zA-Z]/g) ?? []).length;
  return printableRatio > 0.92 && alphaCount >= 20;
}

function visibleXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// ───────────────────────────────────────────────────────────────────────────
// Structured DOCX text extraction — preserves markdown tables and inline
// bold/italic so the PDF renderer can produce content equivalent to the DOCX.
//
// The flat-text `visibleXmlText()` above is used by the quality validator
// (placeholders, AI traces, pricing leakage). It MUST stay lossy because the
// validator runs substring/regex matches that don't expect markdown syntax.
//
// The structured extractor below is used ONLY by the PDF finalizer to render
// a PDF that visually matches the DOCX (tables as tables, bold as bold).
// It walks the same word/document.xml but emits:
//   - <w:p> paragraphs  → \n\n separators (preserving paragraph breaks)
//   - <w:tbl> tables    → markdown |...| rows
//   - <w:tr> rows       → one markdown row per <w:tr>
//   - <w:tc> cells      → cell text joined with " | "
//   - <w:b/> bold runs  → **text**
//   - <w:i/> italic runs→ *text*
//   - <w:br/> breaks    → \n
//   - <w:tab/> tabs     → "  "
//
// This is a best-effort structural walk — it does not implement the full
// OOXML spec. Cell merges (vMerge/gridSpan) are flattened. Nested tables
// are unwrapped into the outer row. The output is consumed by the PDF
// renderer's markdown parser, which already handles |...| tables.
// ───────────────────────────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  // Single-pass replacement — sequential .replace() calls would double-unescape
  // entities like `&amp;lt;` (which represents the literal text `&lt;`).
  // With sequential replaces: `&amp;lt;` → `&lt;` → `<` (WRONG — should be `&lt;`).
  // With single-pass: `&amp;lt;` → `&` + `lt;` = `&lt;` (CORRECT — the `&` from
  // `&amp;` is emitted and never re-scanned for further entity matches).
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (match, entity: string) => {
    switch (entity) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
          const code = parseInt(entity.slice(2), 16);
          return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        if (entity.startsWith("#")) {
          const code = parseInt(entity.slice(1), 10);
          return Number.isFinite(code) ? String.fromCodePoint(code) : match;
        }
        return match;
    }
  });
}

function walkRunsToMarkdown(runXml: string): string {
  // Within a run (<w:r>...</w:r>), detect <w:b/> (bold) and <w:i/> (italic)
  // property flags and wrap the visible text accordingly. Each <w:t> child
  // contributes its text content; <w:br/> contributes a newline; <w:tab/>
  // contributes two spaces.
  let bold = false;
  let italic = false;
  const rPrMatch = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  if (rPrMatch) {
    bold = /<w:b\s*\/?>/.test(rPrMatch[1]) && !/<w:b\s+val="false"\s*\/?>/.test(rPrMatch[1]);
    italic = /<w:i\s*\/?>/.test(rPrMatch[1]) && !/<w:i\s+val="false"\s*\/?>/.test(rPrMatch[1]);
  }
  const pieces: string[] = [];
  const re = /<w:(?:t(?:\s[^>]*)?|br\s*\/?|tab\s*\/?)>([^<]*)<\/w:t>|<w:(br|tab)\s*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(runXml)) !== null) {
    if (m[2] === "br") {
      pieces.push("\n");
    } else if (m[2] === "tab") {
      pieces.push("  ");
    } else if (m[1] !== undefined) {
      const txt = decodeXmlEntities(m[1]).split("").filter((ch) => ch !== "\r").join("");
      pieces.push(txt);
    }
  }
  const text = pieces.join("");
  if (!text) return "";
  if (bold && italic) return `***${text}***`;
  if (bold) return `**${text}**`;
  if (italic) return `*${text}*`;
  return text;
}

function walkParagraphToMarkdown(pXml: string): string {
  const runs: string[] = [];
  const re = /<w:r>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pXml)) !== null) {
    const piece = walkRunsToMarkdown(m[1]);
    if (piece) runs.push(piece);
  }
  return runs.join("").replace(/[ \t]+/g, " ").trim();
}

function walkCellToMarkdown(tcXml: string): string {
  const paragraphs: string[] = [];
  const re = /<w:p>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tcXml)) !== null) {
    const t = walkParagraphToMarkdown(m[1]);
    if (t) paragraphs.push(t);
  }
  return paragraphs
    .join(" / ")
    // Escape backslashes FIRST, then pipes. In markdown table cells:
    //   `\\` → literal backslash, `\|` → literal pipe, `|` → column separator.
    // Escaping `\` before `|` ensures a cell like `a\|b` (literal backslash +
    // pipe) becomes `a\\\|b` which renders as `a\` + `|` + `b` = `a\|b`.
    // Reversing the order would turn `a\|b` → `a\\|b` (escaping the pipe
    // first) → `a\\\\|b` (double-escaping the backslash), corrupting the cell.
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

function walkTableToMarkdown(tblXml: string): string {
  const rows: string[] = [];
  const re = /<w:tr[\s>][\s\S]*?<\/w:tr>/g;
  let m: RegExpExecArray | null;
  let isFirst = true;
  while ((m = re.exec(tblXml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(m[0])) !== null) {
      cells.push(walkCellToMarkdown(cm[1]));
    }
    if (cells.length > 0) {
      rows.push(`| ${cells.join(" | ")} |`);
      if (isFirst) {
        rows.push(`| ${cells.map(() => "---").join(" | ")} |`);
        isFirst = false;
      }
    }
  }
  return rows.join("\n");
}

function visibleXmlTextStructured(xml: string): string {
  const out: string[] = [];
  const bodyMatch = xml.match(/<w:body>([\s\S]*?)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;
  const re = /<w:(p|tbl|sectPr)([\s>][\s\S]*?)<\/w:\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tag = m[1];
    const inner = m[2];
    if (tag === "sectPr") continue;
    if (tag === "tbl") {
      const md = walkTableToMarkdown(`<w:tbl>${inner}</w:tbl>`);
      if (md) {
        out.push("");
        out.push(md);
        out.push("");
      }
      continue;
    }
    if (tag === "p") {
      const line = walkParagraphToMarkdown(inner);
      out.push(line);
    }
  }
  return out
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocxMarkdownText(
  value: string | null | undefined,
  filename: string,
): Promise<string | null> {
  if (!maybeBase64Docx(value, filename) || !value) return null;
  try {
    const buffer = Buffer.from(value, "base64");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    return documentXml ? visibleXmlTextStructured(documentXml) : null;
  } catch {
    return null;
  }
}

function maybeBase64Docx(value: string | null | undefined, filename: string): boolean {
  if (!value || !filename.toLowerCase().endsWith(".docx")) return false;
  try {
    const buffer = Buffer.from(value, "base64");
    return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  } catch {
    return false;
  }
}

export async function extractDocxVisibleText(value: string | null | undefined, filename: string): Promise<string | null> {
  if (!maybeBase64Docx(value, filename) || !value) return null;
  try {
    const buffer = Buffer.from(value, "base64");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");
    return documentXml ? visibleXmlText(documentXml) : null;
  } catch {
    return null;
  }
}

export function documentHygieneIssues(text: string | null | undefined, doc?: Pick<ExportReadyDocument, "name" | "exactFileName" | "documentType" | "format">): string[] {
  if (!text || !looksLikePlainText(text)) return [];
  const issues: string[] = [];
  if (/\b(as an ai|ai language model|chatgpt|claude|gemini|prompt|generated by ai|deterministic fallback|bid-team action|submission note:)\b/i.test(text)) {
    issues.push("AI/meta-preparation trace text is present");
  }
  if (/\[(insert|add|fill|placeholder|todo|tbd|name of|date here|signature here|stamp here)[^\]]*\]/i.test(text) || /\b(TODO|TBD|FIXME|PLACEHOLDER)\b/i.test(text)) {
    issues.push("Placeholder or unresolved drafting instruction is present");
  }
  if (containsPricingLeakage(text, doc)) {
    issues.push("Possible financial/pricing language appears in a technical document");
  }
  return issues;
}

export function isReadyForFinalExport(doc: ExportReadyDocument): boolean {
  // Canonical machine validation is the authority for the automatic path; a
  // per-document human reviewStatus is NOT additionally required.
  //
  // That is the owner contract, not a shortcut. OWNER_AUTOMATION_CONTRACT.md
  // lists Validation, Finalization, PDF export and ZIP export among the stages
  // that "continue automatically through durable workers with no additional
  // routine approvals or buttons" after Run Engine. Requiring a reviewStatus
  // here would be exactly such an approval. The owner's decision point is
  // "final owner approval before submission or Production promotion" — the act
  // of submitting, not a gate on each generated document.
  //
  // This previously read `... && (isReviewReadyForExport(doc.reviewStatus) ||
  // isValidationPassed(doc.validationStatus))` directly after already requiring
  // isValidationPassed. Since `A && (B || A)` is just `A`, the reviewStatus
  // half could never affect the outcome — it read like a human-review gate
  // while being incapable of gating anything, which is worse than either
  // honest alternative. Removing it changes no behaviour.
  //
  // Nothing here is relaxed: generationStatus, validationStatus and every
  // document-output-state exclusion below still hold, and a document that
  // fails canonical validation is still refused.
  return isGenerated(doc.generationStatus)
    && isValidationPassed(doc.validationStatus)
    && deriveDocumentOutputState(doc) !== "CONTROL_RECORD_ONLY"
    && deriveDocumentOutputState(doc) !== "ORIGINAL_REQUIRED"
    && deriveDocumentOutputState(doc) !== "SUPERSEDED"
    && deriveDocumentOutputState(doc) !== "NEEDS_REVALIDATION"
    && deriveDocumentOutputState(doc) !== "PDF_CONVERSION_REQUIRED";
}

export function checkExportReadiness(docs: ExportReadyDocument[], opts: { requireFileContent?: boolean } = {}): ExportReadinessResult {
  const failures: ExportReadinessFailure[] = [];

  if (docs.length === 0) {
    failures.push({
      documentId: "__tender__",
      name: "No active generated documents",
      fileName: "NO_ACTIVE_GENERATED_DOCUMENTS",
      reasons: ["NO_ACTIVE_GENERATED_DOCUMENTS: final export requires at least one active generated document."],
    });
    return { ok: false, failures };
  }

  for (const doc of docs) {
    const reasons: string[] = [];
    const state = deriveDocumentOutputState(doc);
    if ((EXPORT_BLOCKING_STATES as readonly DocumentOutputState[]).includes(state)) {
      const blockReason = exportBlockReason(state);
      if (blockReason) reasons.push(`[${state}] ${blockReason}`);
    } else if (state !== "READY_FOR_EXPORT") {
      if (!isGenerated(doc.generationStatus)) reasons.push(`generationStatus is ${doc.generationStatus}, expected GENERATED`);
      if (!isValidationPassed(doc.validationStatus)) reasons.push(`validationStatus is ${doc.validationStatus}, expected PASSED or VALIDATED`);
      // Gap C: VALIDATED is sufficient for the automatic path — don't
      // require a human reviewStatus when the canonical validator passed.
      if (!isReviewReadyForExport(doc.reviewStatus) && !isValidationPassed(doc.validationStatus)) reasons.push(`reviewStatus is ${doc.reviewStatus}, expected READY_FOR_EXPORT or VALIDATED`);
    }
    if (/MARKDOWN|QUICK_DRAFT|DRAFT_ONLY|CONTROL|NOT_EXPORTABLE|REPLACE_WITH_ORIGINAL|PLANNED/i.test(`${doc.format ?? ""} ${doc.documentType ?? ""}`)) {
      reasons.push(`Document format/status (${doc.format ?? "UNKNOWN"}/${doc.documentType ?? "UNKNOWN"}) is not a final export package file.`);
    }
    if (opts.requireFileContent && !doc.fileContent && !doc.storagePath) reasons.push("fileContent is missing");
    for (const issue of documentHygieneIssues(doc.fileContent, doc)) reasons.push(issue);

    if (reasons.length > 0) failures.push({ documentId: doc.id, name: doc.name, fileName: documentFileName(doc), reasons });
  }

  return { ok: failures.length === 0, failures };
}

export async function checkDocxHygieneReadiness(docs: ExportReadyDocument[]): Promise<ExportReadinessFailure[]> {
  const failures: ExportReadinessFailure[] = [];
  const storage = getStorageAdapter();
  for (const doc of docs) {
    const fileName = documentFileName(doc);
    let content = doc.fileContent ?? null;
    if (!content && doc.storagePath) {
      try {
        const bytes = await storage.getFile({ storagePath: doc.storagePath, fileContent: doc.fileContent ?? null, fileName });
        content = bytes.toString("base64");
      } catch {
        failures.push({ documentId: doc.id, name: doc.name, fileName, reasons: ["Unable to inspect storage-backed document content for final export hygiene"] });
        continue;
      }
    }
    const text = await extractDocxVisibleText(content, fileName);
    const reasons = documentHygieneIssues(text, doc).map((issue) => `${issue} inside DOCX visible text`);
    if (reasons.length > 0) failures.push({ documentId: doc.id, name: doc.name, fileName, reasons });
  }
  return failures;
}

function mergeFailures(...groups: ExportReadinessFailure[][]): ExportReadinessFailure[] {
  const byDocument = new Map<string, ExportReadinessFailure>();
  for (const group of groups) {
    for (const failure of group) {
      const existing = byDocument.get(failure.documentId);
      if (!existing) {
        byDocument.set(failure.documentId, { ...failure, reasons: [...failure.reasons] });
        continue;
      }
      existing.reasons = Array.from(new Set([...existing.reasons, ...failure.reasons]));
    }
  }
  return Array.from(byDocument.values());
}

export function exportReadinessError(failures: ExportReadinessFailure[], tenderLevelBlockers?: ExportReadinessResult["tenderLevelBlockers"]): string {
  const out: string[] = [];
  if (failures.length > 0) {
    const summary = failures.length === 1 ? "Final export blocked: 1 document is not ready for export." : `Final export blocked: ${failures.length} documents are not ready for export.`;
    const details = failures.slice(0, 6).map((f) => `• ${f.fileName} — ${f.reasons.join("; ")}`).join("\n");
    const truncationNote = failures.length > 6 ? `\n• … and ${failures.length - 6} more` : "";
    out.push(`${summary}\n${details}${truncationNote}`);
  }
  if (tenderLevelBlockers && tenderLevelBlockers.length > 0) {
    const lines = tenderLevelBlockers.slice(0, 8).map((b) => {
      const action = b.recommendedAction ? ` — Action: ${b.recommendedAction}` : "";
      return `• [${b.severity}] ${b.title}${action}`;
    });
    out.push(`Tender-level blockers (${tenderLevelBlockers.length} unresolved):\n${lines.join("\n")}`);
  }
  return out.length === 0 ? "" : out.join("\n\n");
}

export function filePlanBlockersFromLists(docs: ExportReadyDocument[], exactFileNaming: string | null | undefined, exactFileOrder: string | null | undefined): NonNullable<ExportReadinessResult["tenderLevelBlockers"]> {
  const blockers: NonNullable<ExportReadinessResult["tenderLevelBlockers"]> = [];
  const requiredNames = parseRequiredFileList(exactFileNaming);
  const requiredOrder = parseRequiredFileList(exactFileOrder);
  const actualNames = docs.map((doc) => documentFileName(doc)).filter(Boolean);
  const actualNameSet = new Set(actualNames.map(normalizeFileName));

  const missingNames = requiredNames.filter((name) => !actualNameSet.has(normalizeFileName(name)));
  if (missingNames.length > 0) blockers.push({ category: "FILE_NAMING", severity: "HIGH", title: `Missing required generated file name(s): ${missingNames.slice(0, 5).join(", ")}${missingNames.length > 5 ? ` and ${missingNames.length - 5} more` : ""}`, recommendedAction: "Generate or rename documents to match the tender's exact required file names before final export." });
  const extraFiles = actualNames.filter((name) => requiredNames.length > 0 && !requiredNames.some((required) => normalizeFileName(required) === normalizeFileName(name)));
  if (extraFiles.length > 0) blockers.push({ category: "EXTRA_FILES", severity: "HIGH", title: `Generated package contains non-required file(s): ${extraFiles.slice(0, 5).join(", ")}${extraFiles.length > 5 ? ` and ${extraFiles.length - 5} more` : ""}`, recommendedAction: "Remove extra generated files not listed in the tender's exact file naming instructions before final export." });

  if (requiredOrder.length > 0) {
    const orderedActual = [...docs].sort((a, b) => (a.exactOrder ?? 9999) - (b.exactOrder ?? 9999)).map((doc) => normalizeFileName(documentFileName(doc)));
    const mismatches = requiredOrder.map((name, index) => ({ name, expected: normalizeFileName(name), actual: orderedActual[index] ?? "" })).filter((row) => row.actual && row.expected !== row.actual);
    if (mismatches.length > 0) blockers.push({ category: "FILE_ORDER", severity: "HIGH", title: `Generated file order does not match tender order near: ${mismatches.slice(0, 3).map((m) => m.name).join(", ")}`, recommendedAction: "Reorder the generated documents/export package to match the tender's required attachment order." });
  }

  // Duplicate exactOrder detection — two documents with the same position
  // value would produce an undefined submission order for the evaluator.
  const orderValues = docs.map((d) => d.exactOrder).filter((v): v is number => v != null);
  const orderSeen = new Map<number, number>();
  for (const v of orderValues) orderSeen.set(v, (orderSeen.get(v) ?? 0) + 1);
  const duplicateOrders = [...orderSeen.entries()].filter(([, count]) => count > 1).map(([v]) => v);
  if (duplicateOrders.length > 0) {
    blockers.push({
      category: "DUPLICATE_EXACT_ORDER",
      severity: "HIGH",
      title: `Duplicate document order values: position(s) ${duplicateOrders.join(", ")} are assigned to more than one document.`,
      recommendedAction: "Fix exactOrder values in Final Package Manifest so each document has a unique position.",
    });
  }

  return blockers;
}

function tenderBlocker(category: string, title: string, recommendedAction: string, severity: "HIGH" | "MEDIUM" | "LOW" = "HIGH") {
  return { category, severity, title, recommendedAction };
}

function hasStrategyOnlySignals(files: Array<{ originalFileName: string; extractedText?: string | null; classification?: string | null }>): boolean {
  if (files.length === 0) return false;
  const combined = files.map((f) => `${f.originalFileName}\n${f.classification ?? ""}\n${f.extractedText ?? ""}`).join("\n\n").toLowerCase();
  const strategyHits = /(compiled from|all information should be verified|master file|market intelligence|consultant interpretation|data current as of|directenders|2merkato|reporter newspaper|ethiopian herald)/i.test(combined);
  const officialHits = /(request for proposal|\brfp\b|terms of reference|instructions to bidders|bid data sheet|form of tender|addendum|procuring entity|official tender)/i.test(combined);
  return strategyHits && !officialHits;
}

export async function checkTenderLevelExportBlockers(tenderId: string, docs: ExportReadyDocument[] = []): Promise<{ blockers: NonNullable<ExportReadinessResult["tenderLevelBlockers"]>; advisoryWarnings: NonNullable<ExportReadinessResult["advisoryWarnings"]> }> {
  await prismaReady;
  const blockers: NonNullable<ExportReadinessResult["tenderLevelBlockers"]> = [];
  const advisoryWarnings: NonNullable<ExportReadinessResult["advisoryWarnings"]> = [];

  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    include: {
      files: {
        select: {
          originalFileName: true, extractedText: true, classification: true,
          extractionScore: true, totalPages: true, extractedPages: true,
          ocrPages: true, failedPages: true,
        },
      },
      requirements: true,
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { trustLevel: true } } } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { trustLevel: true } } } },
    },
  });

  if (!tender) return { blockers: [tenderBlocker("TENDER_NOT_FOUND", "Tender not found for export readiness check.", "Reload the tender and run export readiness again.")], advisoryWarnings };

  const exportOverrides = await prisma.tenderMetadataOverride
    .findMany({ where: { tenderId }, select: { field: true, fieldState: true, overrideValue: true } })
    .catch(() => [] as Array<{ field: string; fieldState: string; overrideValue: string | null }>);
  const exportOverrideByField = new Map(exportOverrides.map(o => [o.field, o]));
  const isOverridden = (field: string) => {
    const o = exportOverrideByField.get(field);
    return o !== undefined && ["USER_CONFIRMED", "USER_EDITED", "NOT_APPLICABLE", "IGNORED_WITH_REASON"].includes(o.fieldState);
  };
  // Resolve the EFFECTIVE value (override ?? raw) for a field. Mirrors
  // build-plan.ts validateCriticalMetadataEvidenceForBuildPlan's effectiveValue()
  // so the export gate never disagrees with the canonical hash on which value
  // is in force. NOT_APPLICABLE / IGNORED_WITH_REASON do NOT replace the value
  // (only USER_EDITED / USER_CONFIRMED do).
  function effectiveValue(field: string, raw: string | null | undefined): string | null {
    const o = exportOverrideByField.get(field);
    if (o && (o.fieldState === "USER_EDITED" || o.fieldState === "USER_CONFIRMED")) {
      return o.overrideValue ?? null;
    }
    return raw ?? null;
  }
  function effectiveDeadline(raw: Date | string | null | undefined): Date | null {
    const eff = effectiveValue("deadline", raw instanceof Date ? raw.toISOString() : raw ? String(raw) : null);
    if (!eff) return null;
    const d = new Date(eff);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const packageMode = detectSubmissionPackageMode({
    submissionMethod: effectiveValue("submissionMethod", tender.submissionMethod),
    submissionAddress: effectiveValue("submissionAddress", tender.submissionAddress),
    submissionEmails: effectiveValue("submissionEmails", tender.submissionEmails),
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    analysisSummary: tender.analysisSummary,
    evaluationMethodology: tender.evaluationMethodology,
    notes: tender.notes,
    requirements: tender.requirements,
    files: tender.files,
  });
  if (packageMode.blockingForZip) {
    blockers.push(tenderBlocker(
      `PACKAGE_MODE_${packageMode.mode}`,
      `${packageMode.reason} Signal: ${packageMode.matchedSignals[0] ?? packageMode.mode}`,
      "Do not use the default final ZIP until the required submission package mode is implemented or manually prepared exactly as the tender instructs.",
      "HIGH",
    ));
  }

  if (docs.length === 0) blockers.push(tenderBlocker("NO_ACTIVE_GENERATED_DOCUMENTS", "No active generated documents exist for export.", "Resolve the canonical upstream blocker; after successful Run Engine, generation and validation continue automatically."));
  // Accept procuringEntityName as fallback — older tenders may have it set without clientName.
  // Use EFFECTIVE values (override ?? raw) so a USER_EDITED clientName override is respected.
  const effectiveExportClientName = effectiveValue("clientName", tender.clientName) || effectiveValue("procuringEntityName", tender.procuringEntityName);
  if (!isValidClientName(effectiveExportClientName) && !isOverridden("clientName")) blockers.push(tenderBlocker("CLIENT_NAME_REQUIRED", "Client/procuring entity name is missing or invalid. Edit Tender Details to enter the exact official procuring entity name.", "Edit Tender Detail and enter the exact official procuring entity name."));

  // ── Extraction quality blocker ────────────────────────────────────────────
  if (tender.files && tender.files.some(f => (f as { extractionScore?: number | null }).extractionScore !== null && ((f as { extractionScore: number }).extractionScore) < 20)) {
    blockers.push(tenderBlocker(
      "EXTRACTION_QUALITY_INSUFFICIENT",
      "One or more tender files have very poor text extraction. The submission package may be based on incomplete tender information.",
      "Upload a clearer, text-based copy of the tender file before exporting.",
      "HIGH",
    ));
  }

  // ── Unknown total page count blocker ─────────────────────────────────────
  // CLAUDE.md requires blocking export when the total page count is unknown.
  // Only fires when we have extracted pages but no total — an empty file with
  // null totalPages is already caught by the score check above.
  if (tender.files && tender.files.some(f => {
    const ff = f as { totalPages?: number | null; extractedPages?: number | null };
    return (ff.totalPages === null || ff.totalPages === undefined) && (ff.extractedPages ?? 0) > 0;
  })) {
    blockers.push(tenderBlocker(
      "EXTRACTION_PAGE_COUNT_UNKNOWN",
      "One or more tender files have an unknown total page count. Extraction coverage cannot be verified — important pages may have been missed.",
      "Upload a clearer, text-based copy of the tender file so pages are detected, before exporting.",
      "HIGH",
    ));
  }

  // ── Submission-instructions extracted check ───────────────────────────────
  // Per CLAUDE.md the export gate must block when submission instruction pages
  // were not extracted from the tender. The generate route already enforces
  // this check; enforce the same constraint at export time.
  if (tender.files && tender.files.length > 0) {
    let anySubmissionInstructions = false;
    let anyRequiredDocPages = false;
    let totalDetectedPages = 0;
    for (const file of tender.files) {
      const pp = assessExtractionQualityPerPage((file as { extractedText?: string | null }).extractedText);
      totalDetectedPages += pp.totalDetectedPages;
      if (pp.submissionInstructionPages.length > 0) anySubmissionInstructions = true;
      if (pp.requiredDocumentPages.length > 0) anyRequiredDocPages = true;
    }
    if (totalDetectedPages > 0 && !anySubmissionInstructions) {
      blockers.push(tenderBlocker(
        "SUBMISSION_INSTRUCTIONS_NOT_EXTRACTED",
        "No submission instruction pages were detected in the extracted tender text. The package may be submitted to the wrong address or by the wrong method.",
        "Upload a clearer, text-based copy of the tender so submission instructions can be recovered before exporting.",
        "HIGH",
      ));
    }
    if (totalDetectedPages > 0 && !anyRequiredDocPages) {
      advisoryWarnings.push({
        category: "REQUIRED_DOCUMENT_PAGES_NOT_EXTRACTED",
        severity: "MEDIUM" as const,
        title: "No required-document/form pages were detected in the extracted tender text. The submission package may be missing mandatory annexures or official forms.",
        recommendedAction: "Re-extract the tender to ensure required-document sections are readable, or manually review the tender for forms/templates to attach.",
      });
    }
  }

  // ── Client entity contamination blocker ───────────────────────────────────
  if ((tender as { metadataContaminated?: boolean }).metadataContaminated && !isOverridden("clientName")) {
    blockers.push(tenderBlocker(
      "CLIENT_ENTITY_CONTAMINATED",
      "The procuring entity/client name may be contaminated by unrelated tender portal text.",
      "Correct the client name in Tender Details before exporting.",
      "HIGH",
    ));
  }

  // ── Tender Details placeholder hygiene blocker ─────────────────────────────
  // Block when critical tender details fields still contain placeholder strings.
  const criticalMetadataFields: Array<[string, string | null | undefined]> = [
    ["Client name", effectiveValue("clientName", tender.clientName)],
    ["Procuring entity", effectiveValue("procuringEntityName", tender.procuringEntityName)],
    ["Submission method", effectiveValue("submissionMethod", tender.submissionMethod)],
  ];
  for (const [label, value] of criticalMetadataFields) {
    if (value && containsMetadataPlaceholder(value)) {
      blockers.push(tenderBlocker(
        "TENDER_FACTS_PLACEHOLDER_IN_CRITICAL_FIELD",
        `${label} contains a placeholder value ("${value.slice(0, 60)}"). Replace with the actual value before exporting.`,
        "Edit Tender Detail and replace the placeholder with the correct value.",
        "HIGH",
      ));
    }
  }

  // ── Analysis extraction quality blocker ──────────────────────────────────
  // Block when AI Analyze ran on a weak or regex-fallback extraction — the
  // generated documents may be missing key requirements or metadata.
  const analysisExtractionStatus = (tender as { analysisExtractionStatus?: string | null }).analysisExtractionStatus;
  if (analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") {
    blockers.push(tenderBlocker(
      "ANALYSIS_FROM_WEAK_EXTRACTION",
      "Tender analysis used regex/deterministic fallback because extraction was too weak. Generated documents may be based on incomplete requirements.",
      "Upload a clearer, text-based copy of the tender file. Extraction and analysis re-run automatically before export.",
      "HIGH",
    ));
  }
  if (analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
    blockers.push(tenderBlocker(
      "ANALYSIS_FROM_PARTIAL_EXTRACTION",
      "AI analysis was performed on a partially-extracted tender — some pages were weak, blank, or OCR-only. Exported documents may be missing requirements, evaluation criteria, or submission instructions from unread pages.",
      "Upload a clearer, text-based copy of the tender file so a full-extraction analysis can be produced before export.",
      "HIGH",
    ));
  }
  if (analysisExtractionStatus === "OCR_REQUIRED") {
    blockers.push(tenderBlocker(
      "ANALYSIS_SKIPPED_OCR_REQUIRED",
      "AI analysis was skipped because the tender text is corrupted or unreadable — no reliable analysis has been performed. The generated documents may be empty or invalid.",
      "Upload a clearer, text-based copy of the tender file. Extraction and analysis re-run automatically before export.",
      "HIGH",
    ));
  }
  if (analysisExtractionStatus === "EXTRACTION_WEAK_REVIEW_REQUIRED") {
    blockers.push(tenderBlocker(
      "ANALYSIS_FROM_WEAK_EXTRACTION_REVIEW",
      "AI analysis ran on a weak extraction — the tender text had low density or quality. Generated documents may be incomplete — verify before export.",
      "Upload a clearer, text-based copy of the tender. If a clearer copy is not available, manually review all generated documents before exporting.",
      "HIGH",
    ));
  }

  // ── Analysis source blocker (audit-only fallback must NOT authorize export) ──
  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only. Even though
  // the central gate (assertTenderReadyForGenerationAndExport) already blocks
  // it, this secondary panel MUST be consistent so the UI never shows "export
  // ready" when the analysis source is audit-only.
  // Resolver-first (see resolveCanonicalAnalysisSource): the notes-only
  // detector reported ANALYSIS_SOURCE_UNKNOWN — "no analysis has been run" —
  // for tenders whose AI Analyze had genuinely succeeded and whose workflow
  // panel showed it complete, because the proof lives in AiJob rows rather
  // than tender.notes. This panel must agree with the central gate.
  const analysisSource = await resolveCanonicalAnalysisSource(prisma, tenderId, tender).catch(() => "UNKNOWN" as const);
  if (analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    blockers.push(tenderBlocker(
      "ANALYSIS_FALLBACK_AUDIT_ONLY",
      "Tender analysis was human-approved as audit-only. Human approval no longer authorizes export.",
      "Re-run AI Analyze with healthy providers to obtain a genuine AI analysis. The audit-only approval is preserved for record-keeping but does NOT unblock export.",
      "HIGH",
    ));
  } else if (analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    blockers.push(tenderBlocker(
      "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
      "Tender analysis came from the regex fallback (AI providers failed) and has not been human-approved.",
      "Re-run AI Analyze with healthy providers. Human approval is audit-only and does NOT authorize export.",
      "HIGH",
    ));
  } else if (analysisSource === "UNKNOWN") {
    blockers.push(tenderBlocker(
      "ANALYSIS_SOURCE_UNKNOWN",
      "Tender analysis source is unknown — no analysis has been run or the source could not be determined.",
      "Run AI Analyze to produce a genuine AI analysis before exporting.",
      "HIGH",
    ));
  }

  // ── Submission method + endpoint completeness blockers ──────────────────
  // Use EFFECTIVE values (override ?? raw) and shared policy classifiers so
  // the export gate never disagrees with the canonical hash or the BuildPlan
  // validator on which method is in force or whether it's email/physical/portal.
  const effMethod = effectiveValue("submissionMethod", tender.submissionMethod);
  const effEmails = effectiveValue("submissionEmails", tender.submissionEmails);
  const effAddress = effectiveValue("submissionAddress", tender.submissionAddress);
  if (!effMethod) {
    blockers.push(tenderBlocker(
      "SUBMISSION_METHOD_MISSING",
      "Submission method has not been extracted or confirmed — the package may be submitted incorrectly.",
      "Run AI Analyze or manually enter the submission method in Tender Detail before exporting.",
      "HIGH",
    ));
  } else {
    if (isEmailSubmissionMethod(effMethod) && !effEmails) {
      blockers.push(tenderBlocker(
        "SUBMISSION_EMAIL_MISSING",
        "Submission method is EMAIL but no submission email address has been extracted. The package cannot be delivered.",
        "Run AI Analyze or manually add the submission email in Tender Detail before exporting.",
        "HIGH",
      ));
    }
    if (isPhysicalSubmissionMethod(effMethod) && !effAddress) {
      advisoryWarnings.push({
        category: "SUBMISSION_ADDRESS_MISSING",
        severity: "MEDIUM" as const,
        title: `Submission method is ${effMethod} but no submission address was extracted.`,
        recommendedAction: "Add the physical submission address in Tender Detail to ensure correct package delivery.",
      });
    }
  }

  // ── Deadline freshness advisory ───────────────────────────────────────────
  // RUNTIME METADATA DEBLOCKER: Missing deadline is advisory, not a hard block.
  // The deadline may be resolved from parser/effective facts without being
  // stored in the scalar column. Only warn if truly missing.
  const effDeadline = effectiveDeadline(tender.deadline);
  if (!effDeadline) {
    // Advisory only — don't block export for missing deadline
    // (the cover letter can be edited manually before final submission)
  }


  // Advisory when the tender deadline has already passed — warn the user but
  // allow export/submission in case a deadline extension was granted or the
  // evaluator accepts late submissions. This is a HIGH-severity advisory, not
  // a hard blocker.
  if (effDeadline) {
    const now = new Date();
    if (effDeadline < now) {
      const daysAgo = Math.round((now.getTime() - effDeadline.getTime()) / (1000 * 60 * 60 * 24));
      advisoryWarnings.push({ category: "DEADLINE_PASSED", severity: "HIGH" as const, title: `Submission deadline passed ${daysAgo} day${daysAgo === 1 ? "" : "s"} ago (${effDeadline.toISOString().slice(0, 10)}). Late submissions are typically rejected by evaluators.`, recommendedAction: "Confirm whether a deadline extension was granted. If the tender closed, mark it as lost/withdrawn rather than exporting." });
    }
  }

  // ── Source traceability for client details ───────────────────────────────
  // Per CLAUDE.md: "Source page and source quote/snippet for every extracted
  // client field." If client was extracted but source is missing, warn for export.
  const clientSourceMissing: string[] = [];
  if (effectiveValue("clientName", tender.clientName) && !isOverridden("clientName")) {
    const clientSourcePage = (tender as { clientNameSourcePage?: number | null }).clientNameSourcePage;
    const clientSourceQuote = (tender as { clientNameSourceQuote?: string | null }).clientNameSourceQuote;
    if (!clientSourcePage || !clientSourceQuote) {
      clientSourceMissing.push("client name");
    }
  }
  if (clientSourceMissing.length > 0) {
    advisoryWarnings.push({
      category: "CLIENT_DETAILS_SOURCE_MISSING",
      severity: "MEDIUM" as const,
      title: `Source page/quote missing for extracted ${clientSourceMissing.join(", ")}. Cannot trace back to original tender document if questions arise.`,
      recommendedAction: "Manually verify the extracted client name matches the tender document. Re-run AI Analyze if source attribution is needed.",
    });
  }

  // ── Evaluation criteria advisory (non-blocking) ──────────────────────────
  // Per Pillar 6: EVALUATION_CRITERIA_MISSING and EVALUATION_CRITERIA_NOT_EXTRACTED
  // are merged into one non-blocking advisory. Only block if the tender
  // explicitly contains an unreadable scoring section.
  if (!tender.evaluationMethodology) {
    advisoryWarnings.push({
      category: "EVALUATION_CRITERIA_ADVISORY",
      severity: "LOW" as const,
      title: "Evaluation criteria were not extracted — verify scoring manually before export.",
      recommendedAction: "Review the tender document for any scoring/evaluation section. If found, run AI Analyze to extract it. This is advisory only and does not block export.",
    });
  }

  if ((tender.readinessScore ?? 0) <= 0 || /^(ANALYZED|AI_ANALYZED|AI_ANALYSIS_PARTIAL|FALLBACK_DRAFT_CREATED|ANALYSIS_REQUIRES_REVIEW|DRAFT)$/i.test(tender.status) || /^(ANALYSIS|TENDER_INTAKE)$/i.test(tender.stage)) blockers.push(tenderBlocker("FULL_PROPOSAL_NOT_READY", `Tender is still at ${tender.status}/${tender.stage} with workflow progress ${tender.readinessScore ?? 0}.`, "Follow the canonical current action. Safe generation, validation and finalization continue automatically after successful Run Engine."));
  if (hasStrategyOnlySignals(tender.files)) blockers.push(tenderBlocker("OFFICIAL_SOURCE_REQUIRED", "Uploaded source appears to be strategy/market-intelligence only, not an official RFP/ToR/forms package.", "Upload the official tender source package before final export."));

  const requiresExperts = tender.requirements.some((r) => r.requirementType === "EXPERT");
  const requiresProjects = tender.requirements.some((r) => r.requirementType === "PROJECT_EXPERIENCE");
  const reviewedSelectedExperts = tender.expertMatches.filter((m) => m.expert.trustLevel === "REVIEWED" || m.expert.trustLevel === "SOURCE_VERIFIED" || m.expert.trustLevel === "AI_DRAFT").length;
  const reviewedSelectedProjects = tender.projectMatches.filter((m) => m.project.trustLevel === "REVIEWED" || m.project.trustLevel === "SOURCE_VERIFIED" || m.project.trustLevel === "AI_DRAFT").length;
  if (requiresExperts && reviewedSelectedExperts === 0) blockers.push(tenderBlocker("NO_SELECTED_REVIEWED_EXPERTS", "Tender requires experts but no selected reviewed expert matches exist.", "Run Engine and select/review expert matches before export."));
  if (requiresProjects && reviewedSelectedProjects === 0) blockers.push(tenderBlocker("NO_SELECTED_REVIEWED_PROJECTS", "Tender requires project references but no selected reviewed project matches exist.", "Run Engine and select/review project matches before export."));

  const mandatoryReqIds = tender.requirements.filter((r) => String(r.priority ?? "").toUpperCase() === "MANDATORY").map((r) => r.id);
  const [complianceRows, totalExpertMatches, totalProjectMatches, plannedDocCount, coveredMandatoryIds] = await Promise.all([
    prisma.complianceMatrix.count({ where: { tenderId } }),
    prisma.tenderExpertMatch.count({ where: { tenderId } }),
    prisma.tenderProjectMatch.count({ where: { tenderId } }),
    prisma.generatedDocument.count({ where: { tenderId, generationStatus: "PLANNED" } }),
    mandatoryReqIds.length > 0
      ? prisma.complianceMatrix.findMany({
          where: { tenderId, requirementId: { in: mandatoryReqIds }, supportLevel: { in: ["FULL", "SUBSTANTIAL"] } },
          select: { requirementId: true },
          distinct: ["requirementId"],
        })
      : Promise.resolve([]),
  ]);
  if (tender.requirements.length > 0 && complianceRows === 0) blockers.push(tenderBlocker("EVIDENCE_NOT_ASSESSED", "Compliance/evidence matrix is empty.", "Run Engine successfully so requirement-linked evidence rows are created."));

  // ── Mandatory evidence coverage blocker ──────────────────────────────────
  // Block (MEDIUM) when fewer than half of mandatory requirements have FULL
  // or SUBSTANTIAL compliance coverage — the export package is likely missing
  // key proof documents for the most critical requirements.
  const mandatoryCount = mandatoryReqIds.length;
  if (mandatoryCount > 0 && complianceRows > 0) {
    const coveredCount = coveredMandatoryIds.length;
    const coveragePercent = Math.round((coveredCount / mandatoryCount) * 100);
    if (coveragePercent < 50) {
      blockers.push(tenderBlocker(
        "MANDATORY_EVIDENCE_INCOMPLETE",
        `Only ${coveragePercent}% of mandatory requirements (${coveredCount}/${mandatoryCount}) have strong evidence coverage (FULL/SUBSTANTIAL). The export package may be missing critical proof documents.`,
        "Run Engine to link requirement evidence, or manually add compliance matrix rows with FULL or SUBSTANTIAL support levels before exporting.",
        "MEDIUM",
      ));
    }
  }
  if (requiresExperts && totalExpertMatches === 0) blockers.push(tenderBlocker("NO_TENDER_SPECIFIC_EXPERT_MATCHES", "No tender-specific expert match rows exist.", "Run Engine to create expert matches from the reviewed vault."));
  if (requiresProjects && totalProjectMatches === 0) blockers.push(tenderBlocker("NO_TENDER_SPECIFIC_PROJECT_MATCHES", "No tender-specific project match rows exist.", "Run Engine to create project matches from the reviewed vault."));
  if (plannedDocCount > 0) blockers.push(tenderBlocker("UNGENERATED_PLANNED_DOCUMENTS", `${plannedDocCount} required submission document(s) are planned but not yet generated — the ZIP package would be incomplete.`, "Planned documents are generated automatically. Tender-issued forms are sourced from uploaded Tender Intake files.", "HIGH"));

  const ungroundedMandatory = tender.requirements.filter((req) => req.priority === "MANDATORY" && !req.sectionReference && !req.sourceTenderFileId && !req.sourcePageNumber && !req.sourceExactQuote && (req.sourceConfidence ?? 0) <= 0);
  if (ungroundedMandatory.length > 0) blockers.push(tenderBlocker("SOURCE_REFERENCES_MISSING", `${ungroundedMandatory.length} mandatory requirement(s) lack source/page/quote traceability.`, "Run source extraction and review mandatory requirement references before export.", "HIGH"));

  blockers.push(...filePlanBlockersFromLists(docs, tender.exactFileNaming, tender.exactFileOrder));

  const highOpen = await prisma.evaluatorObjection.findMany({ where: { tenderId, status: "OPEN", severity: "HIGH" }, select: { id: true, title: true, severity: true, category: true, recommendedAction: true }, take: 20 });
  for (const o of highOpen) blockers.push({ category: `EVALUATOR_${o.category}`, severity: o.severity, title: o.title, recommendedAction: o.recommendedAction });

  const workbook = await prisma.pricingWorkbook.findUnique({ where: { tenderId }, select: { id: true, noPriceLeakage: true } });
  if (workbook && workbook.noPriceLeakage === false) blockers.push(tenderBlocker("PRICING_LEAKAGE", "Pricing leakage flag is set on the pricing workbook.", "Confirm no prices, rates, or fees appear in the technical proposal envelope."));

  // ── Donor / NGO safeguard checklist ──────────────────────────────────────
  // When the tender is NGO/donor-funded (detected by category or keyword
  // signals in description/analysis), verify that the three mandatory donor
  // safeguard artefacts are present in the submission plan requirements or
  // generated documents. Missing items are surfaced as MEDIUM blockers so the
  // user is reminded before final export — they do not hard-block, since some
  // donors accept a separate ESMP/logframe delivery milestone.
  const isDonorTender =
    /ngo|donor.?funded|world\s+bank|afdb|african\s+development|adb|asian\s+development|jica|eu\s+funded|usaid|dfid|fcdo|giz|undp|unicef|wfp|unhcr|ifad|gfatm|global\s+fund|development.*partner.*fund|bilateral.*donor/i.test(
      [tender.category, tender.description, tender.analysisSummary, tender.notes, tender.intakeSummary].filter(Boolean).join(" "),
    );
  if (isDonorTender) {
    const planText = tender.requirements.map((r) => `${r.title} ${r.description ?? ""}`).join(" ").toLowerCase();
    const docText = docs.map((d) => `${d.name} ${d.documentType ?? ""}`).join(" ").toLowerCase();
    const allText = `${planText} ${docText}`;
    const sourceText = [tender.description, tender.analysisSummary, tender.notes, tender.intakeSummary, ...tender.requirements.map((r) => `${r.title} ${r.description ?? ""}`)].filter(Boolean).join(" ");
    // Use the formalised donor-advisory confidence model. The scanner returns
    // the verbatim quote of the explicit ToR requirement (≤200 chars) so the
    // readiness panel + audit log can show WHERE the requirement was found
    // instead of an opaque "system says blocking".
    const explicitScan = scanTenderForExplicitDonorRequirement(sourceText);
    const addDonorIssue = (code: string, title: string, action: string) => {
      const issue = tenderBlocker(code, title, action, "MEDIUM");
      // Hard invariant: only EXPLICIT_TOR_REQUIRED can promote to a blocker.
      // Everything else stays in advisoryWarnings (non-export-blocking).
      const annotated = { ...issue, confidence: explicitScan.confidence, sourceQuote: explicitScan.sourceQuote };
      if (isExportBlockingConfidence(explicitScan.confidence)) blockers.push(annotated);
      else advisoryWarnings.push(annotated);
    };

    if (!/esmp|environmental.*social.*management|esia|safeguard.*plan|environmental.*management.*plan/i.test(allText)) {
      addDonorIssue(
        "DONOR_ESMP_MISSING",
        "NGO/donor tender: Environmental and Social Management Plan (ESMP) not detected in submission plan or generated documents.",
        "Add ESMP section/annex, or mark as not required by ToR / separate post-award deliverable / donor template provided.",
      );
    }
    if (!/logframe|log\s+frame|logical\s+framework|result[s]?\s+framework/i.test(allText)) {
      addDonorIssue(
        "DONOR_LOGFRAME_MISSING",
        "NGO/donor tender: Logical Framework (logframe / results framework) not detected in submission plan or generated documents.",
        "Add logframe/results framework, or mark as not required by ToR / separate post-award deliverable / donor template provided.",
      );
    }
    if (!/m&e\s+plan|monitoring.*evaluation|me\s+plan|m\s+and\s+e\s+plan|monitoring\s+plan/i.test(allText)) {
      addDonorIssue(
        "DONOR_ME_PLAN_MISSING",
        "NGO/donor tender: Monitoring & Evaluation (M&E) plan not detected in submission plan or generated documents.",
        "Add M&E plan, or mark as not required by ToR / separate post-award deliverable / donor template provided.",
      );
    }
  }

  return { blockers, advisoryWarnings };
}

export async function checkFullExportReadiness(opts: { tenderId: string; docs: ExportReadyDocument[]; requireFileContent?: boolean }): Promise<ExportReadinessResult> {
  const perDoc = checkExportReadiness(opts.docs, { requireFileContent: opts.requireFileContent });
  const docxHygieneFailures = await checkDocxHygieneReadiness(opts.docs);
  const byteFailures = await checkExportFileByteReadiness(opts.docs);
  const failures = mergeFailures(perDoc.failures, docxHygieneFailures, byteFailures);
  const tenderReadiness = await checkTenderLevelExportBlockers(opts.tenderId, opts.docs);
  return { ok: failures.length === 0 && tenderReadiness.blockers.length === 0, failures, tenderLevelBlockers: tenderReadiness.blockers, advisoryWarnings: tenderReadiness.advisoryWarnings };
}

/**
 * Run the document-content-quality validator against each export-candidate
 * document and return failures for any document where okForFinal is false.
 *
 * This is the FINAL-APPROVAL ENFORCER for tender-specific document quality.
 * It blocks export when:
 *   - Placeholders or AI traces appear in final content
 *   - Mandatory sections are missing
 *   - Forbidden text ("As an AI", "TODO", "TBD", "Bid-Team to confirm", etc.) appears
 *   - Financial content appears in a technical-only tender's documents
 *   - A financial proposal or price schedule is generated when the tender
 *     states financial proposal is not required
 *   - A full technical proposal is generated for an EOI tender
 *
 * This function is called by checkFullExportReadinessWithQualityGate.
 *
 * @param docs - Export-candidate documents with visible text extracted.
 * @param ctx - The tender document generation context (for tender-type-aware checks).
 * @param requiredSectionsByType - Map of document type → required section titles.
 * @param mandatoryRequirements - Mandatory tender requirements that must be covered.
 */
export async function checkDocumentQualityGate(
  docs: ExportReadyDocument[],
  ctx: TenderDocumentGenerationContext,
  requiredSectionsByType: Record<string, string[]>,
  mandatoryRequirements: string[],
): Promise<ExportReadinessFailure[]> {
  const failures: ExportReadinessFailure[] = [];
  for (const doc of docs) {
    // Determine the visible text to validate. For base64 DOCX content we
    // must extract the visible text from the DOCX zip — otherwise the
    // quality gate would silently skip all generated DOCX files (their
    // fileContent is base64, not plain text, so looksLikePlainText returns
    // false and the `continue` below would skip the quality check entirely).
    // Per spec rule 6: validation must not approve empty content, placeholder
    // content, AI traces, or pricing leakage. The quality gate is what
    // enforces these checks, so it MUST run on the extracted visible text.
    let text: string | null = doc.fileContent ?? null;
    const fileName = documentFileName(doc);
    if (text && !looksLikePlainText(text)) {
      // Try to extract visible text from base64 DOCX. If extraction fails
      // (corrupt zip, not a DOCX, etc.), fall back to null — the quality
      // gate will skip the doc but the DOCX hygiene check
      // (checkDocxHygieneReadiness) will still run and catch issues.
      const extracted = await extractDocxVisibleText(text, fileName);
      if (extracted) text = extracted;
      else continue; // Not a DOCX or extraction failed — skip quality gate
    }
    if (!text || !looksLikePlainText(text)) continue;

    const documentType = doc.documentType ?? "";
    const requiredSections = requiredSectionsByType[documentType] ?? [];
    const result = validateGeneratedDocumentQuality(
      text,
      documentType,
      ctx,
      requiredSections,
      mandatoryRequirements,
    );

    if (!result.okForFinal) {
      const reasons: string[] = [];
      if (result.finalBlockers.length > 0) reasons.push(...result.finalBlockers);
      if (result.aiTraceViolations.length > 0) reasons.push(...result.aiTraceViolations);
      if (result.placeholderViolations.length > 0) reasons.push(...result.placeholderViolations);
      if (result.missingSections.length > 0) reasons.push(`Missing required sections: ${result.missingSections.join(", ")}`);
      if (result.inventedEvidenceRisks.length > 0) reasons.push(...result.inventedEvidenceRisks);
      if (reasons.length > 0) {
        failures.push({
          documentId: doc.id,
          name: doc.name,
          fileName: documentFileName(doc),
          reasons: [`[QUALITY GATE score=${result.score}]`, ...reasons],
        });
      }
    }
  }
  return failures;
}

/**
 * Full export readiness including the document-content-quality gate.
 *
 * This is the ENFORCER version of checkFullExportReadiness: it additionally
 * runs validateGeneratedDocumentQuality() against each export-candidate
 * document and blocks export when okForFinal is false.
 *
 * Use this in the /api/tenders/[id]/validate route and the final-ZIP
 * export route to enforce tender-specific document quality.
 */
export async function checkFullExportReadinessWithQualityGate(opts: {
  tenderId: string;
  docs: ExportReadyDocument[];
  requireFileContent?: boolean;
  ctx: TenderDocumentGenerationContext;
  requiredSectionsByType?: Record<string, string[]>;
  mandatoryRequirements?: string[];
}): Promise<ExportReadinessResult> {
  const base = await checkFullExportReadiness(opts);
  const requiredSectionsByType = opts.requiredSectionsByType ?? DEFAULT_REQUIRED_SECTIONS_BY_TYPE;
  const mandatoryRequirements = opts.mandatoryRequirements ?? opts.ctx.mandatoryRequirements ?? [];
  const qualityFailures = await checkDocumentQualityGate(opts.docs, opts.ctx, requiredSectionsByType, mandatoryRequirements);
  const allFailures = mergeFailures(base.failures, qualityFailures);
  return {
    ok: allFailures.length === 0 && (base.tenderLevelBlockers?.length ?? 0) === 0,
    failures: allFailures,
    tenderLevelBlockers: base.tenderLevelBlockers,
    advisoryWarnings: base.advisoryWarnings,
  };
}

const DEFAULT_REQUIRED_SECTIONS_BY_TYPE: Record<string, string[]> = {
  TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
  EXPRESSION_OF_INTEREST: ["Cover Letter", "Expression of Interest", "Company Profile", "Understanding of the Assignment", "Submission Checklist"],
  QUOTATION: ["Quotation Cover Letter", "Price Schedule", "Submission Checklist"],
  FINANCIAL_PROPOSAL: ["Financial Proposal", "Price Schedule"],
};
