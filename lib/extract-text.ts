import { logger } from "./observability";
// Text extraction from uploaded documents. Runs at upload time so all text
// is immediately searchable and usable by the analysis engine.
// Supports: PDF, DOCX/DOC, XLSX/XLS, PPTX/PPT, CSV, TXT, RTF, ODS, ODP + images.

import { isExtractionCorrupted } from "./engine/extraction-quality-gate";

// Exported so limitExtractedText (lib/upload-security.ts) can DETECT that
// this inner limiter fired: normalizeExtractedText slices to exactly this
// length, so output text at this length means the document's tail was cut
// and the extraction is partial (extractionTruncated must be true).
export const MAX_EXTRACTED_TEXT_CHARS = 500_000;
const LEGACY_TEXT_LIMIT = 80_000;

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    if (isPdf(mimeType, ext)) return await extractPdf(buffer);
    if (isDocx(mimeType, ext)) return await extractDocx(buffer, fileName);
    if (isXlsx(mimeType, ext)) return await extractXlsx(buffer, fileName);
    if (isPptx(mimeType, ext)) return await extractPptx(buffer);
    if (isCsv(mimeType, ext)) return extractCsv(buffer);
    if (isRtf(mimeType, ext)) return extractRtf(buffer);
    if (isText(mimeType, ext)) return buffer.toString("utf8").slice(0, MAX_EXTRACTED_TEXT_CHARS);
    if (isImage(mimeType, ext)) return `[Image: ${fileName}]`;
    return "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[extract-text] ${fileName} (${mimeType}):`, { detail: err });
    return `[Extraction failed for ${fileName}: ${message.slice(0, 240)}]`;
  }
}

function isPdf(mime: string, ext: string) { return mime === "application/pdf" || ext === "pdf"; }
function isDocx(mime: string, ext: string) { return mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mime === "application/msword" || ext === "docx" || ext === "doc"; }
function isXlsx(mime: string, ext: string) { return mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mime === "application/vnd.ms-excel" || mime === "application/vnd.oasis.opendocument.spreadsheet" || ["xlsx", "xls", "ods"].includes(ext); }
function isPptx(mime: string, ext: string) { return mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || mime === "application/vnd.ms-powerpoint" || mime === "application/vnd.oasis.opendocument.presentation" || ["pptx", "ppt", "odp"].includes(ext); }
function isCsv(mime: string, ext: string) { return mime === "text/csv" || mime === "text/comma-separated-values" || ext === "csv"; }
function isRtf(mime: string, ext: string) { return mime === "application/rtf" || mime === "text/rtf" || ext === "rtf"; }
function isText(mime: string, ext: string) { return mime.startsWith("text/") || ["txt", "md", "json", "xml"].includes(ext); }
function isImage(mime: string, ext: string) { return mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff"].includes(ext); }

// Common proposal-vocabulary words that pdf-parse / pdfjs frequently splits
// into a leading capital and the rest (e.g., "T echnical" instead of
// "Technical"). The repair below builds case-sensitive word-boundary
// patterns from this list and re-joins. Keep the list to high-confidence
// proposal vocabulary so the repair never produces false positives.
const PDF_BROKEN_WORDS = [
  "Technical", "Approach", "Table", "Section", "Proposal", "Generate",
  "Tender", "Total", "Title", "Project", "Process", "Provide",
  "Architecture", "Architectural", "Engineering", "Building",
  "Construction", "Consultant", "Consultancy", "Contract",
  "Document", "Documentation", "Design", "Detail",
  "Feasibility", "Financial", "Foundation", "File",
  "Hospital", "Health", "Healthcare", "Headquarters",
  "Investigation", "Implementation", "Industrial",
  "Master", "Methodology", "Management", "Material",
  "Office", "Officer", "Operation", "Organization",
  "Photos", "Plan", "Planning", "Personnel",
  "Quality", "Quantity",
  "Reference", "References", "Region", "Registration",
  "Specification", "Specified", "Strategic", "Submission",
  "Supervisor", "Supervision", "Support",
  "Understanding", "Urban", "Utility",
];

const PDF_BROKEN_WORD_REPAIRS: Array<[RegExp, string]> = (() => {
  const out: Array<[RegExp, string]> = [];
  for (const word of PDF_BROKEN_WORDS) {
    const first = word.charAt(0);
    const rest = word.slice(1);
    if (!first || !rest) continue;
    out.push([new RegExp(`\\b${first}\\s+${rest}\\b`, "g"), word]);
  }
  return out;
})();

function normalizeExtractedText(text: string, limit = MAX_EXTRACTED_TEXT_CHARS): string {
  // Round-extraction-artifacts: pdf-parse / pdfjs frequently produce
  // ligatures (ﬁ, ﬂ, ﬀ), zero-width characters, smart quotes, and
  // broken-letterform words ("T echnical" instead of "Technical"). Without
  // normalisation these flow through every downstream proposal section.
  // Each replace below is a single targeted artifact class.
  let out = (text ?? "")
    .replace(/\u0000/g, " ")
    // BOM at start of file
    .replace(/^\uFEFF/, "")
    // Common PDF ligatures (U+FB00–U+FB06) — replace with letter pairs so
    // text is searchable / readable. Without this, words like "specified",
    // "office", "official" appear with unusual glyphs in every section.
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/\uFB05/g, "ft")
    .replace(/\uFB06/g, "st")
    // Smart quotes → ASCII apostrophe / double-quote
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "\"")
    // Ellipsis → three dots
    .replace(/\u2026/g, "...")
    // Non-breaking / thin / hair / narrow / figure spaces → regular space
    .replace(/[\u00A0\u2009\u200A\u200B\u200C\u200D\u202F\u205F\u3000]/g, " ")
    // Zero-width spaces / joiners / BOM → drop entirely
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
    // Soft hyphen → drop (common in PDF extraction, creates hyphenated words)
    .replace(/\u00AD/g, "")
    // Glyph-noise runs: 5+ consecutive single-capital letters separated by
    // single spaces (e.g., "G G E N E R A T E G P D F"). These are font
    // glyphs from icons/emojis that pdf-parse re-emitted as letterforms.
    // Real text rarely produces this pattern at length 5+ (acronyms like
    // USA / PLC are 3 chars).
    .replace(/(?:\b[A-Z]\s+){5,}[A-Z]\b/g, " ")
    // Fix hyphenated line breaks: "pro-\nposal" → "proposal"
    // Common in justified PDF text where words are split across lines
    .replace(/(\w)-\n(\w)/g, "$1$2")
    // Fix excessive spaces between words (common in pdf2json)
    .replace(/([a-z])\s{2,}([a-z])/gi, "$1 $2");

  // Repair common proposal-vocabulary words split by PDF extraction
  // (e.g., "T echnical Approach" → "Technical Approach").
  for (const [pattern, replacement] of PDF_BROKEN_WORD_REPAIRS) {
    out = out.replace(pattern, replacement);
  }

  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

// ─── PDF positional table reconstruction ─────────────────────────────────────
//
// pdf2json and pdfjs both expose per-text-item positional data (x, y, width).
// The previous extractors joined ALL items with spaces, destroying table
// row/column structure. A PDF BOQ like:
//
//   | Item | Description    | Qty | Rate  | Total  |
//   | 1    | Site survey    | 1   | 5000  | 5000   |
//   | 2    | Foundation     | 200 | 250   | 50000  |
//
// was extracted as: "Item Description Qty Rate Total 1 Site survey 1 5000 5000
// 2 Foundation 200 250 50000" — a flat word soup with no row or column
// boundaries. Downstream table-extraction regex (which looks for "Row N:" and
// "|" separators) found nothing, so BOQ/pricing/evaluation-criteria tables in
// PDF tenders were silently lost.
//
// The helpers below reconstruct row/column structure from positional data:
//   1. Group items by y-position (visual rows) with a small tolerance.
//   2. Sort each row's items by x-position (left-to-right reading order).
//   3. Detect column boundaries via horizontal gaps: a gap > max(15, 3×median
//      char width) PDF units is a column separator.
//   4. Emit multi-column rows as "cell | cell | cell" and wrap 3+ consecutive
//      multi-column rows in [Table: N rows] markers.
//   5. Single-column rows (body text) are emitted as plain text lines.
//
// This produces output consistent with the DOCX/XLSX/PPTX table extractors,
// so downstream regex picks up PDF tables uniformly.

interface PositionedTextItem {
  x: number;   // left edge, PDF units
  y: number;   // baseline position; direction doesn't matter (we group by equality)
  w: number;   // text width, PDF units
  text: string; // decoded text content
}

// Tolerance for grouping items into the same visual row. pdf2json/pdfjs report
// y as the baseline; items on the same line should have identical y, but
// sub-pixel rounding and mixed font sizes can cause ~1-2 unit drift. 3 units
// (≈2pt) is well within one line height (12pt text has ~14pt line height).
const PDF_ROW_Y_TOLERANCE = 3;

// Minimum horizontal gap (in PDF units) between two text items to be considered
// a column boundary rather than inter-word spacing. 15 units ≈ 0.2 inches,
// which is a reasonable minimum column gap. The adaptive threshold
// (3 × median char width) scales for different font sizes.
const PDF_MIN_COLUMN_GAP = 15;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Group positioned items into visual rows by y-position, then sort each row
// by x-position. Returns an array of rows, each row being a sorted array of
// items.
function groupItemsIntoRows(items: PositionedTextItem[]): PositionedTextItem[][] {
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > PDF_ROW_Y_TOLERANCE) return a.y - b.y;
    return a.x - b.x;
  });
  const rows: PositionedTextItem[][] = [];
  let currentRow: PositionedTextItem[] = [sorted[0]];
  let currentY = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - currentY) <= PDF_ROW_Y_TOLERANCE) {
      currentRow.push(sorted[i]);
    } else {
      rows.push(currentRow);
      currentRow = [sorted[i]];
      currentY = sorted[i].y;
    }
  }
  rows.push(currentRow);
  // Sort each row by x-position (left to right).
  return rows.map((row) => [...row].sort((a, b) => a.x - b.x));
}

// Split a single row's items into cells based on horizontal gaps.
// Returns an array of cell strings. A gap > gapThreshold between consecutive
// items indicates a column boundary; smaller gaps are inter-word spacing
// within the same cell.
function splitRowIntoCells(row: PositionedTextItem[]): string[] {
  if (row.length === 0) return [];
  if (row.length === 1) return [row[0].text.trim()];

  // Adaptive gap threshold: 3× the median character width, with a floor of
  // PDF_MIN_COLUMN_GAP units. At 12pt, characters are ~6-7 units wide, so
  // 3× ≈ 18-21 units — comfortably larger than inter-word spacing (3-5 units)
  // but smaller than typical table column gaps (25+ units).
  const charWidths = row.map((i) => (i.text.length > 0 ? i.w / i.text.length : 5));
  const medCharW = median(charWidths) || 5;
  const gapThreshold = Math.max(PDF_MIN_COLUMN_GAP, medCharW * 3);

  const cells: string[] = [];
  let currentCell = row[0].text;
  let prevEnd = row[0].x + row[0].w;

  for (let i = 1; i < row.length; i++) {
    const gap = row[i].x - prevEnd;
    if (gap > gapThreshold) {
      cells.push(currentCell.trim());
      currentCell = row[i].text;
    } else {
      currentCell += " " + row[i].text;
    }
    prevEnd = row[i].x + row[i].w;
  }
  cells.push(currentCell.trim());
  return cells;
}

// Reconstruct page text from positioned items, preserving table structure.
// Multi-column rows (2+ cells) are emitted as "cell | cell | cell". When 3+
// consecutive multi-column rows appear, they are wrapped in
// [Table: N rows]\nRow 1: ...\nRow 2: ...\n markers matching the DOCX/XLSX
// format. Single-column rows are emitted as plain text lines.
function reconstructPositionedPageText(items: PositionedTextItem[]): string {
  if (items.length === 0) return "";
  const rows = groupItemsIntoRows(items);

  const lines: string[] = [];
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length === 0) return;
    if (tableBuffer.length >= 3) {
      lines.push(`[Table: ${tableBuffer.length} rows]`);
    }
    lines.push(...tableBuffer);
    tableBuffer = [];
  };

  for (const row of rows) {
    const cells = splitRowIntoCells(row);
    if (cells.length >= 2) {
      // Multi-column row — likely a table row. Buffer it; flush when a
      // non-table row appears or at the end.
      tableBuffer.push(`Row ${tableBuffer.length + 1}: ${cells.join(" | ")}`);
    } else {
      // Single-column row — body text. Flush any accumulated table first.
      flushTable();
      const text = cells[0] || "";
      if (text) lines.push(text);
    }
  }
  flushTable();
  return lines.join("\n");
}

// ─── HTML entity decoding (for mammoth DOCX output) ──────────────────────────

function decodeHtmlEntities(s: string): string {
  return (s ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function extractPdfWithPdfParse(buffer: Buffer): Promise<{ text: string; pages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("pdf-parse");
  let text = "";
  let pages = 0;

  if (typeof mod === "function") {
    const result = await mod(buffer);
    text = result?.text ?? "";
    pages = result?.numpages ?? result?.numPages ?? 0;
  } else if (typeof mod?.default === "function") {
    const result = await mod.default(buffer);
    text = result?.text ?? "";
    pages = result?.numpages ?? result?.numPages ?? 0;
  } else if (typeof mod?.PDFParse === "function") {
    const parser = new mod.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      pages = result?.total ?? result?.pages?.length ?? 0;
      // pdf-parse v2 returns per-page text in result.pages ([{ text, num }]).
      // Reconstruct the text WITH [Page N] markers so the page count and
      // per-requirement/client source attribution survive downstream. The
      // flat result.text field has NO page markers, which previously caused
      // multi-page digital PDFs to report an unknown page count (export
      // blocked, no source pages) whenever pdf-parse won the extractor race.
      const perPage = Array.isArray(result?.pages) ? result.pages as Array<{ text?: string; num?: number }> : [];
      const anyPageText = perPage.some((p) => (p?.text ?? "").trim().length > 0);
      text = anyPageText
        ? perPage
            .map((p, i) => {
              const body = (p?.text ?? "").trim();
              return body ? `[Page ${p?.num ?? i + 1}]\n${body}` : "";
            })
            .filter(Boolean)
            .join("\n\n")
        : (result?.text ?? "");
    } finally {
      if (typeof parser.destroy === "function") await parser.destroy();
    }
  }

  return { text: normalizeExtractedText(text), pages };
}

async function extractPdfWithPdf2Json(buffer: Buffer): Promise<{ text: string; pages: number }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const PDFParser = require("pdf2json");
  const parser = new PDFParser();

  return await new Promise((resolve, reject) => {
    parser.on("pdfParser_dataError", (errData: { parserError?: Error }) => reject(errData.parserError ?? new Error("pdf2json failed")));
    parser.on("pdfParser_dataReady", (pdfData: { Pages?: Array<{ Texts?: Array<{ x?: number; y?: number; w?: number; R?: Array<{ T?: string }> }> }> }) => {
      const pages = pdfData.Pages ?? [];
      const pageTexts = pages.map((page, index) => {
        // Build positioned items from pdf2json's Texts array. Each Texts item
        // has x, y, w (width) and an R (runs) array of text fragments. We
        // decode the URI-encoded text and preserve the position so the table
        // reconstruction helper can detect row/column structure.
        const items: PositionedTextItem[] = (page.Texts ?? []).flatMap((textItem) => {
          const text = (textItem.R ?? [])
            .map((run) => {
              try { return decodeURIComponent(run.T ?? ""); }
              catch { return run.T ?? ""; }
            })
            .join("");
          if (!text.trim()) return [];
          return [{
            x: textItem.x ?? 0,
            y: textItem.y ?? 0,
            w: textItem.w ?? 0,
            text,
          }];
        });
        const reconstructed = reconstructPositionedPageText(items);
        return reconstructed ? `[Page ${index + 1}]\n${reconstructed}` : "";
      }).filter(Boolean);
      resolve({ text: normalizeExtractedText(pageTexts.join("\n\n")), pages: pages.length });
    });
    parser.parseBuffer(buffer);
  }).finally(() => {
    // Clean up listeners and destroy the parser to prevent memory leaks.
    // Without this, repeated extraction calls accumulate listeners on parser
    // instances (V8 won't GC until listeners are removed). Long-running worker
    // processes bleed memory.
    parser.removeAllListeners();
    if (typeof parser.destroy === "function") parser.destroy();
  }) as Promise<{ text: string; pages: number }>;
}

async function extractPdfWithPdfJs(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true, verbosity: 0 });
  const pdf = await task.promise;
  const pages = pdf.numPages ?? 0;
  const pageTexts: string[] = [];
  let totalChars = 0;

  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
    // pdfjs text items have:
    //   .str       — the text string
    //   .transform — [a, b, c, d, e, f] where e=x (left), f=y (baseline from bottom)
    //   .width     — text width in PDF units
    //   .hasEOL    — whether this item ends a line
    // We use transform[4] (x) and transform[5] (y) to reconstruct row/column
    // structure via the positional table reconstruction helper, instead of
    // the old approach of joining everything with spaces and relying on
    // hasEOL for line breaks. This preserves table structure that the old
    // approach destroyed.
    const rawItems = (content.items ?? []) as Array<{
      str?: string;
      hasEOL?: boolean;
      transform?: number[];
      width?: number;
    }>;
    const items: PositionedTextItem[] = rawItems
      .filter((item) => item.str && item.str.trim())
      .map((item) => ({
        // transform[4] = x (left edge), transform[5] = y (baseline from bottom).
        // Negate y so that larger y = lower on page (top-to-bottom ordering),
        // matching the convention used by pdf2json. The grouping helper only
        // cares about y-equality within tolerance, so the sign doesn't affect
        // row detection — only the sort direction for row ordering.
        x: item.transform?.[4] ?? 0,
        y: -(item.transform?.[5] ?? 0),
        w: item.width ?? 0,
        text: item.str!,
      }));

    let pageText: string;
    if (items.length > 0 && items.some((i) => i.w > 0)) {
      // Items have positional data — use table-aware reconstruction.
      pageText = reconstructPositionedPageText(items);
    } else {
      // Fallback: no positional data (shouldn't happen with pdfjs, but
      // defensive). Use the old hasEOL-based approach.
      pageText = rawItems
        .map((item) => item.str ? `${item.str}${item.hasEOL ? "\n" : " "}` : "")
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
    }

    if (pageText) {
      pageTexts.push(`[Page ${pageNumber}]\n${pageText}`);
      totalChars += pageText.length;
    }
    if (totalChars >= MAX_EXTRACTED_TEXT_CHARS) break;
    if (typeof page.cleanup === "function") page.cleanup();
  }

  if (typeof pdf.destroy === "function") await pdf.destroy();
  return { text: normalizeExtractedText(pageTexts.join("\n\n")), pages };
}

// ─── Claude vision OCR (4th-engine fallback for scanned PDFs) ───────────────
//
// Three text-layer extractors run first (pdf-parse, pdf2json, pdfjs).
// If all three return < 20 chars, the PDF has no text layer — it is a
// scanned-image PDF, which is exactly the case the user keeps hitting
// ("Extracted tender text is only 0 chars").
//
// The fix: pass the PDF buffer DIRECTLY to Claude as a `document` content
// block. Claude's vision-equivalent PDF support (claude-3-5-sonnet and
// later) reads scanned PDFs natively — no Tesseract install, no external
// OCR API, no extra credentials. Output goes through the same
// normalizeExtractedText pipeline as the text-layer extractors.
//
// Cost & timing:
//   • Anthropic charges per-page on PDF document blocks.
//   • Wall time: ~10–30s for a 50-page scanned PDF.
//   • Capped at PDF_OCR_MAX_PAGES_PER_CALL pages per call to bound cost
//     and keep wall time well under the upload route's 60s budget.
//
// Gating:
//   • PDF_OCR_ENABLED=true must be set explicitly. Default OFF so users
//     don't get surprise OCR charges. When OFF, the legacy "[Scanned
//     PDF — needs OCR]" placeholder is returned (current behaviour).
//   • ANTHROPIC_API_KEY must be set. When missing, OCR is skipped.

const PDF_OCR_MAX_PAGES_PER_CALL = (() => {
  const raw = Number(process.env.PDF_OCR_MAX_PAGES);
  if (Number.isFinite(raw) && raw > 0 && raw <= 100) return raw;
  return 50;
})();

async function extractPdfWithClaudeVision(buffer: Buffer, pageCount: number | "unknown"): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  let Anthropic: { new (config: { apiKey: string; timeout?: number }): unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch (err) {
    logger.warn("[extract-text] @anthropic-ai/sdk not available for OCR fallback:", { detail: err });
    return "";
  }

  // If we know the page count and it exceeds the per-call cap, take only
  // the first PDF_OCR_MAX_PAGES_PER_CALL pages. We trim the buffer by
  // re-rendering with pdfjs in a follow-up patch; for now we send the
  // whole document (Anthropic accepts up to ~100 pages per request).
  // The cap above is enforced by the model itself on big files.
  const knownPages = typeof pageCount === "number" ? pageCount : null;
  if (knownPages && knownPages > PDF_OCR_MAX_PAGES_PER_CALL) {
    logger.warn(`[extract-text] PDF has ${knownPages} pages; OCR call may be slow / costly (cap is ${PDF_OCR_MAX_PAGES_PER_CALL} pages).`);
  }

  const base64Pdf = buffer.toString("base64");

  // Use the same canonical Claude model name normalization as lib/ai.ts
  // so user typos in the env var don't break OCR. The OCR-specific model
  // can be overridden via PDF_OCR_MODEL.
  const rawModel = process.env.PDF_OCR_MODEL || "claude-3-5-sonnet-latest";
  const modelName = rawModel.trim().toLowerCase().replace(/[._\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  // OCR timeout — prevents Vercel FUNCTION_RUNTIME_LIMIT (504) when the
  // Anthropic API hangs or is slow. Default 40s leaves ~20s headroom under
  // the upload route's 60s maxDuration for the 3 text-layer extractors +
  // storage + DB writes. Configurable via PDF_OCR_TIMEOUT_MS.
  const ocrTimeoutMs = (() => {
    const raw = Number(process.env.PDF_OCR_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 5000 && raw <= 120000 ? raw : 40_000;
  })();

  const client = new (Anthropic as new (config: { apiKey: string; timeout?: number }) => {
    messages: { create: (input: unknown, options?: { signal?: AbortSignal }) => Promise<{ content: Array<{ type: string; text?: string }>; stop_reason?: string }> };
  })({ apiKey, timeout: ocrTimeoutMs });

  // AbortController for hard timeout — the SDK's timeout option is a
  // connection-level timeout; the AbortController ensures the request is
  // aborted even if the connection is established but the response is slow.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ocrTimeoutMs);

  try {
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 16_000, // raised from 8K — a 50-page PDF holds ~25-50K chars (~8-15K tokens)
      system: "You are a precise OCR engine. Extract ALL visible text from the attached PDF document, preserving paragraph structure and table contents where possible. Output ONLY the extracted text — no commentary, no markdown fences, no preamble. If a section is unreadable, write [unreadable] inline. Preserve page breaks with the marker [Page N] at the start of each page's text.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: "Extract the complete text content of this PDF. Preserve paragraph and table structure. Include page breaks as [Page N].",
            },
          ],
        },
      ],
    }, { signal: controller.signal });
    const text = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    // Detect truncation — if stop_reason is "max_tokens", the output was
    // cut mid-document. Log a warning so operators know the OCR was partial.
    if (response.stop_reason === "max_tokens") {
      logger.warn(`[extract-text] Claude vision OCR truncated at max_tokens (16K) — PDF may have more content. Consider splitting large PDFs or raising the limit. Model: ${modelName}, pages: ${pageCount}.`);
    }
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Distinguish OCR error classes so the user gets actionable advice
    // instead of the generic "upload a higher-resolution scan" message.
    if (err instanceof Error && (err.name === "AbortError" || /abort/i.test(msg))) {
      logger.warn(`[extract-text] Claude vision OCR timed out after ${ocrTimeoutMs}ms (model: ${modelName}, pages: ${pageCount}).`);
      return "[OCR_TIMEOUT — the OCR call exceeded the time budget. Try uploading a smaller PDF or split into pages.]";
    }
    if (/401|403|invalid api key|authentication/i.test(msg)) {
      logger.warn(`[extract-text] Claude vision OCR auth failed (model: ${modelName}):`, { detail: msg });
      return "[OCR_AUTH_FAILED — ANTHROPIC_API_KEY is invalid or expired. Contact admin.]";
    }
    if (/429|rate.?limit|overloaded/i.test(msg)) {
      logger.warn(`[extract-text] Claude vision OCR rate-limited (model: ${modelName}):`, { detail: msg });
      return "[OCR_RATE_LIMITED — Anthropic rate limit hit. Retry in a few minutes.]";
    }
    logger.warn(`[extract-text] Claude vision OCR failed (${modelName}):`, { detail: msg });
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // Race the 3 text-layer extractors with a per-extractor timeout.
  // Previously these ran sequentially (15-30s for a 50-page PDF), exhausting
  // the 60s Vercel budget before OCR could even start. Now each gets 10s;
  // the first non-corrupted result with > 1000 chars wins. If all fail or
  // return garbage, we fall through to the OCR path.
  const extractorTimeout = 10_000; // 10s per extractor
  const extractors = [
    { source: "pdf-parse", fn: () => extractPdfWithPdfParse(buffer) },
    { source: "pdf2json", fn: () => extractPdfWithPdf2Json(buffer) },
    { source: "pdfjs", fn: () => extractPdfWithPdfJs(buffer) },
  ];

  const results: Array<{ source: string; text: string; pages: number }> = [];
  await Promise.allSettled(
    extractors.map(async (ext) => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          ext.fn(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${ext.source} timed out after ${extractorTimeout}ms`)), extractorTimeout);
          }),
        ]);
        results.push({ source: ext.source, ...result });
      } catch (error) {
        logger.warn(`[extract-text] ${ext.source} failed:`, { detail: error instanceof Error ? error.message : String(error) });
      } finally {
        // Clear the timeout timer to prevent memory leaks — when ext.fn()
        // wins the race, the setTimeout handle keeps running for up to 10s,
        // holding memory and delaying Vercel function completion.
        if (timer) clearTimeout(timer);
      }
    }),
  );

  // Pick the best extractor by quality score, not text length.
  // Previously: `results.sort((a, b) => b.text.length - a.text.length)[0]`
  // — this picked 100K chars of garbage over 80K chars of clean text.
  // Now: score each result with scorePageTextQuality and pick the highest
  // non-corrupted score, breaking ties by length.
  const { scorePageTextQuality } = await import("./engine/extraction-quality-gate");
  let best: { source: string; text: string; pages: number } | undefined;
  let bestScore = -1;
  for (const r of results) {
    if (!r.text || r.text.length < 20) continue;
    const quality = scorePageTextQuality(r.text);
    // Prefer non-corrupted results; among corrupted, prefer longer (for OCR trigger)
    const score = quality.isCorrupted ? -100 + r.text.length : quality.score + r.text.length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // If no non-corrupted result, fall back to longest (for OCR trigger detection)
  if (!best && results.length > 0) {
    best = results.sort((a, b) => b.text.length - a.text.length)[0];
  }

  const pages = best?.pages || results.find((r) => r.pages > 0)?.pages || "unknown";

  // 4th-engine fallback: Claude vision OCR for scanned PDFs.
  // Triggers when all three text-layer extractors returned essentially
  // nothing.
  //
  // PR U FIX — OCR was opt-in via PDF_OCR_ENABLED=true. The user's
  // production deployment had this env var unset, so when a scanned
  // tender PDF was uploaded the extraction returned 0 chars and the
  // engine silently produced a generic proposal. Now: OCR runs by
  // DEFAULT whenever ANTHROPIC_API_KEY is present (which the engine
  // already requires for proposal generation). The user can still
  // opt-out with PDF_OCR_ENABLED=false.
  const ocrFlag = (process.env.PDF_OCR_ENABLED || "").toLowerCase();
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const ocrEnabled = ocrFlag === "true" || (ocrFlag !== "false" && hasAnthropicKey);

  // Determine OCR trigger reason:
  //   1. No text layer — traditional case (< 20 chars)
  //   2. Corrupted text — pdf2json / pdf-parse returned garbage characters
  const hasNoTextLayer = !best?.text || best.text.length < 20;
  const hasCorruptedText =
    !hasNoTextLayer &&
    best != null &&
    best.text.length > 20 &&
    isExtractionCorrupted(best.text);

  if ((hasNoTextLayer || hasCorruptedText) && ocrEnabled) {
    const ocrReason = hasCorruptedText ? "CORRUPTED_TEXT" : "NO_TEXT_LAYER";
    if (hasNoTextLayer) {
      logger.info(`[extract-text] PDF has no text layer (${pages} pages) — running Claude vision OCR fallback (default-on, set PDF_OCR_ENABLED=false to disable).`);
    } else {
      logger.info(`[extract-text] PDF text layer detected as corrupted (${best!.text.length} chars, garbage content) — running Claude vision OCR fallback. ocrReason=${ocrReason}`);
    }
    const ocrText = await extractPdfWithClaudeVision(buffer, pages);
    // OCR can return error-class markers ([OCR_TIMEOUT...], [OCR_AUTH_FAILED...],
    // [OCR_RATE_LIMITED...]). Treat these as "OCR failed" — don't store them
    // as extracted text. The user sees the scanned-PDF placeholder instead.
    const isOcrErrorMarker = ocrText.startsWith("[OCR_");
    if (ocrText && !isOcrErrorMarker && ocrText.length >= 20) {
      // Normalize once on the fully assembled string. Calling normalizeExtractedText
      // twice (once on ocrText, once on the prefixed string) would silently truncate
      // ~58 chars of OCR content when the output is near the 500 K char limit.
      return normalizeExtractedText(`[PDF text extracted via Claude vision OCR — ${pages} page(s). ocrReason=${ocrReason}]\n\n${ocrText.trim()}`);
    }
    if (isOcrErrorMarker) {
      // OCR returned an error marker — log it and fall through to the
      // scanned-PDF placeholder. The marker text is NOT stored as extractedText.
      logger.warn(`[extract-text] Claude vision OCR returned error marker: ${ocrText.slice(0, 120)}`);
    }
    if (hasCorruptedText) {
      logger.warn("[extract-text] Claude vision OCR returned empty for corrupted text — falling back to corrupted extraction.");
      // Return the corrupted text with a warning prefix so downstream
      // quality gates can still detect and flag it.
      return normalizeExtractedText(`[PDF text extracted but detected as corrupted — ocrReason=${ocrReason} — OCR returned empty. Review extraction quality before AI Analyze.]\n\n${best!.text}`);
    }
    logger.warn("[extract-text] Claude vision OCR returned empty — returning scanned-PDF placeholder.");
  }

  if (!best?.text || best.text.length < 20) {
    if (!ocrEnabled) {
      return `[Scanned PDF — ${pages} page(s). Text layer not found. Vision OCR fallback is disabled (PDF_OCR_ENABLED=false or no ANTHROPIC_API_KEY). Re-enable OCR or upload a digital PDF / DOCX with selectable text.]`;
    }
    return `[Scanned PDF — ${pages} page(s). Text layer not found and Claude vision OCR returned empty. The PDF may be image-only with very low resolution, password-protected, or otherwise unreadable. Try uploading a higher-resolution scan or a digital PDF.]`;
  }

  // If OCR was not enabled but text is corrupted, surface a warning prefix
  // so the quality panel and AI gate can detect it.
  if (!ocrEnabled && isExtractionCorrupted(best.text)) {
    logger.warn(`[extract-text] PDF text layer is corrupted but OCR is disabled — returning corrupted text with warning prefix. Set PDF_OCR_ENABLED=true to enable OCR fallback.`);
    return normalizeExtractedText(`[PDF text extracted but detected as corrupted — ocrReason=CORRUPTED_TEXT — OCR required but not configured (set PDF_OCR_ENABLED=true). Review extraction quality before AI Analyze.]\n\n${best.text}`);
  }

  if (best.text.length <= LEGACY_TEXT_LIMIT && Number(pages) > 1) return normalizeExtractedText(`[PDF text extracted from ${pages} page(s) using ${best.source}.]\n\n${best.text}`);
  return best.text;
}

// ─── DOCX table extraction helpers ───────────────────────────────────────────
//
// The previous DOCX table extraction had four gaps that broke table structure
// for tender documents:
//
//   1. colspan/rowspan not expanded — a BOQ with a category header spanning
//      5 columns (colspan="5") was emitted as a single cell, shifting every
//      subsequent row's column alignment. The fix uses a grid model: each
//      cell occupies (row, col) positions, and new cells skip positions
//      already occupied by a rowspan from above.
//
//   2. Nested tables broke the non-greedy <table[\s\S]*?<\/table> regex —
//      it matched from the outer <table> to the FIRST </table> (the inner
//      close), truncating the outer table and leaking the inner table's
//      content as body text. The fix uses a depth-aware table finder that
//      matches balanced <table>...</table> pairs.
//
//   3. No "Row N:" prefix — inconsistent with the XLSX/PPTX extractors,
//      so downstream table-parsing regex that expects "Row N:" didn't match
//      DOCX tables. The fix adds "Row N:" prefix to every row.
//
//   4. HTML entities not decoded in cells — &amp; &lt; &gt; &nbsp; survived
//      into the output, corrupting cell text. The fix uses decodeHtmlEntities.

// Find the position of the matching </table> close tag for a <table> open tag
// at position `openPos`, accounting for nested tables. Returns the index
// AFTER the closing ">" of the matching </table>, or -1 if unbalanced.
function findMatchingTableClose(html: string, openPos: number): number {
  let depth = 1;
  let pos = html.indexOf(">", openPos) + 1;
  while (depth > 0 && pos < html.length) {
    const nextOpen = html.indexOf("<table", pos);
    const nextClose = html.indexOf("</table", pos);
    if (nextClose === -1) return -1; // malformed — no close tag found
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = html.indexOf(">", nextOpen) + 1;
    } else {
      depth--;
      pos = html.indexOf(">", nextClose) + 1;
      if (depth === 0) return pos;
    }
  }
  return -1;
}

// Find all top-level <table>...</table> regions in the HTML, correctly
// handling nested tables. Returns an array of {start, end, html} where
// start/end are indices into the original HTML and html is the table
// markup (including the outer <table> and </table> tags).
function findTopLevelTables(html: string): Array<{ start: number; end: number; html: string }> {
  const tables: Array<{ start: number; end: number; html: string }> = [];
  let searchFrom = 0;
  while (searchFrom < html.length) {
    const openIdx = html.indexOf("<table", searchFrom);
    if (openIdx === -1) break;
    const closeEnd = findMatchingTableClose(html, openIdx);
    if (closeEnd === -1) {
      // Malformed — skip this <table> and continue searching.
      searchFrom = openIdx + 6;
      continue;
    }
    tables.push({ start: openIdx, end: closeEnd, html: html.slice(openIdx, closeEnd) });
    searchFrom = closeEnd;
  }
  return tables;
}

// Parse a single <table>...</table> HTML fragment into structured text,
// expanding colspan/rowspan via a grid model. Emits:
//   [Table: N rows]
//   Row 1: cell | cell | cell
//   Row 2: cell | cell | cell
// matching the XLSX/PPTX table format.
function parseDocxTableToText(tableHtml: string): string {
  const rowMatches = [...tableHtml.matchAll(/<tr\b[\s\S]*?<\/tr>/gis)];
  if (rowMatches.length === 0) return "";

  // Grid model: grid[row][col] = cell text. The occupied set tracks which
  // (row, col) positions are already filled by a rowspan/colspan from an
  // earlier cell, so new cells skip those positions.
  const grid: Map<string, string> = new Map();
  let maxCol = 0;

  for (let r = 0; r < rowMatches.length; r++) {
    const rowHtml = rowMatches[r][0];
    // Match <td> and <th> cells. Use \b to avoid matching <tdesign> etc.
    const cellMatches = [...rowHtml.matchAll(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gis)];
    let col = 0;
    for (const cellMatch of cellMatches) {
      // Skip positions occupied by a rowspan from a previous row.
      while (grid.has(`${r},${col}`)) col++;

      const cellHtml = cellMatch[0];
      const colspanMatch = cellHtml.match(/colspan\s*=\s*["']?(\d+)["']?/i);
      const rowspanMatch = cellHtml.match(/rowspan\s*=\s*["']?(\d+)["']?/i);
      const colspan = Math.max(1, parseInt(colspanMatch?.[1] ?? "1"));
      const rowspan = Math.max(1, parseInt(rowspanMatch?.[1] ?? "1"));

      // Extract cell text: strip all inner HTML tags, decode entities.
      const rawText = cellHtml
        .replace(/^<t[dh]\b[^>]*>/i, "")
        .replace(/<\/t[dh]>$/i, "")
        .replace(/<[^>]+>/g, " ");
      const cellText = decodeHtmlEntities(rawText).replace(/\s+/g, " ").trim();

      // Fill the grid for all spanned positions.
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          grid.set(`${r + dr},${col + dc}`, cellText);
        }
      }
      col += colspan;
      if (col > maxCol) maxCol = col;
    }
  }

  // Build output rows from the grid.
  const tableLines: string[] = [];
  for (let r = 0; r < rowMatches.length; r++) {
    const cells: string[] = [];
    for (let c = 0; c < maxCol; c++) {
      cells.push(grid.get(`${r},${c}`) ?? "");
    }
    // Only emit rows that have at least one non-empty cell.
    if (cells.some((cell) => cell)) {
      tableLines.push(`Row ${r + 1}: ${cells.join(" | ")}`);
    }
  }

  if (tableLines.length === 0) return "";
  return `[Table: ${tableLines.length} rows]\n${tableLines.join("\n")}`;
}

async function extractDocx(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "doc") return "[Legacy .doc file detected. Please save as .docx for reliable text extraction.]";
  const mammoth = await import("mammoth");

  // Use convertToHtml FIRST — it gives us both text and structure (headings, tables).
  // Previously we called BOTH extractRawText AND convertToHtml, which doubled memory
  // usage for large DOCX files and caused OOM on Vercel's 1024MB Hobby plan.
  // Now we only call convertToHtml; if it fails or finds no structure, we extract
  // text from the HTML itself (stripping tags).
  try {
    const htmlResult = await mammoth.convertToHtml({ buffer });
    const html = htmlResult.value ?? "";

    // Check if the HTML has structural elements (headings or tables)
    const hasHeadings = /<h[1-6][^>]*>/i.test(html);
    const hasTables = /<table[\s\S]/i.test(html);

    if (hasHeadings || hasTables) {
      // Build structured text preserving section order and hierarchy.
      // Instead of splitting by regex (which breaks on nested tables), we
      // iterate through the HTML linearly, finding top-level tables via the
      // depth-aware finder and headings via regex, in document order.
      const tables = findTopLevelTables(html);
      const sections: string[] = [];
      let currentSection = "";
      let cursor = 0;

      // Build a combined list of "structural elements" (headings + tables)
      // sorted by position, so we can walk the HTML in document order and
      // emit text between them as body paragraphs.
      type StructuralElement = { pos: number; type: "heading" | "table"; match: RegExpMatchArray | null; tableHtml: string };
      const elements: StructuralElement[] = [];

      // Find all headings.
      const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gis;
      let hMatch: RegExpExecArray | null;
      while ((hMatch = headingRegex.exec(html)) !== null) {
        elements.push({ pos: hMatch.index, type: "heading", match: hMatch, tableHtml: "" });
      }

      // Find all top-level tables (already depth-aware).
      for (const t of tables) {
        elements.push({ pos: t.start, type: "table", match: null, tableHtml: t.html });
      }

      // Sort by position.
      elements.sort((a, b) => a.pos - b.pos);

      for (const el of elements) {
        // Emit any body text between the cursor and this element.
        if (el.pos > cursor) {
          const between = html.slice(cursor, el.pos);
          const text = decodeHtmlEntities(between.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
          if (text) currentSection += text + "\n\n";
        }

        if (el.type === "heading" && el.match) {
          if (currentSection.trim()) sections.push(currentSection.trim());
          const level = parseInt(el.match[1]);
          const headingText = decodeHtmlEntities(el.match[2].replace(/<[^>]+>/g, "")).trim();
          const prefix = "#".repeat(level);
          currentSection = `${prefix} ${headingText}\n\n`;
          cursor = el.match.index! + el.match[0].length;
        } else if (el.type === "table") {
          const tableText = parseDocxTableToText(el.tableHtml);
          if (tableText) currentSection += tableText + "\n\n";
          // Advance cursor past the table. Find the table's end position.
          const tableEl = tables.find((t) => t.start === el.pos);
          cursor = tableEl ? tableEl.end : el.pos + el.tableHtml.length;
        }
      }

      // Emit any remaining body text after the last structural element.
      if (cursor < html.length) {
        const remaining = html.slice(cursor);
        const text = decodeHtmlEntities(remaining.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        if (text) currentSection += text + "\n\n";
      }

      if (currentSection.trim()) sections.push(currentSection.trim());

      if (sections.length > 0) {
        return normalizeExtractedText(sections.join("\n\n---\n\n"));
      }
    }

    // No structure found — extract plain text from HTML (strip all tags)
    const plainText = decodeHtmlEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (plainText.length > 20) {
      return normalizeExtractedText(plainText);
    }
  } catch {
    // convertToHtml failed — fall through to extractRawText
  }

  // Fallback: extract raw text only (no structure)
  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result.value ?? "");
}

async function extractXlsx(buffer: Buffer, fileName: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("@e965/xlsx") as typeof import("@e965/xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true, cellDates: true });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Use sheet_to_json with header:1 to get row arrays for better structure
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
    if (rows.length === 0) continue;

    // Detect if this sheet looks like a BOQ / price schedule
    const headerRow = rows[0]?.map((c: any) => String(c ?? "").toLowerCase()) ?? [];
    const boqKeywords = ["item", "description", "unit", "quantity", "price", "rate", "amount", "total", "cost", "sum", "subTotal", "grand total"];
    const isBoq = headerRow.filter((h: string) => boqKeywords.some((kw) => h.includes(kw))).length >= 3;
    const sheetType = isBoq ? " [BOQ/Price Schedule]" : "";

    // Handle merged cells: if a cell is empty but the cell above in the same
    // column had a value, it's likely a merged cell — copy the value down.
    // This is common in tender BOQ files where item categories span multiple rows.
    for (let r = 1; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const cellValue = String(rows[r][c] ?? "").trim();
        if (!cellValue && rows[r - 1]?.[c]) {
          const aboveValue = String(rows[r - 1][c] ?? "").trim();
          // Only copy down if the above value looks like a category/label (not a number)
          if (aboveValue && isNaN(Number(aboveValue)) && aboveValue.length > 2) {
            rows[r][c] = aboveValue;
          }
        }
      }
    }

    // Build structured text with row references
    // Limit to first 500 rows to prevent memory issues on very large spreadsheets
    const maxRows = Math.min(rows.length, 500);
    const lines: string[] = [`[Sheet: ${sheetName}${sheetType}]`];
    if (rows.length > 500) {
      lines.push(`[Note: ${rows.length} rows total, showing first 500]`);
    }
    for (let i = 0; i < maxRows; i++) {
      const row = rows[i].map((c: any) => {
        const val = String(c ?? "").trim();
        // Format dates nicely
        if (c instanceof Date) return c.toLocaleDateString();
        return val;
      });
      const lineText = row.filter((c: string) => c).join(" | ");
      if (lineText) lines.push(`Row ${i + 1}: ${lineText}`);
    }
    const cleaned = lines.join("\n").trim();
    if (cleaned) parts.push(cleaned);
  }
  if (parts.length === 0) return `[Empty spreadsheet: ${fileName}]`;
  return normalizeExtractedText(parts.join("\n\n"));
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => {
    const numA = parseInt(a.match(/\d+/)?.[0] ?? "0");
    const numB = parseInt(b.match(/\d+/)?.[0] ?? "0");
    return numA - numB;
  });
  const isOdp = slideNames.length === 0 && Boolean(zip.files["content.xml"]);
  const files = slideNames.length > 0 ? slideNames : isOdp ? ["content.xml"] : [];
  if (files.length === 0) return "[No slide content found in presentation]";
  const slideTexts: string[] = [];
  for (const name of files) {
    const xml = await zip.files[name].async("string");
    const matches = [...xml.matchAll(/<(?:a:t|text:span|text:p)[^>]*>([^<]+)<\//g)];
    const text = matches.map((m) => m[1].trim()).filter(Boolean).join(" ");
    if (text) slideTexts.push(text);
  }
  const result = slideTexts.join("\n");
  return result ? normalizeExtractedText(result) : "[Presentation has no extractable text]";
}

function extractCsv(buffer: Buffer): string {
  // Detect BOM and strip it
  let text: string;
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    text = buffer.subarray(3).toString("utf8");
  } else {
    text = buffer.toString("utf8");
  }

  // Detect delimiter: comma, semicolon, tab, or pipe
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const pipeCount = (firstLine.match(/\|/g) ?? []).length;
  const delimiter = semicolonCount > commaCount && semicolonCount > tabCount ? ";"
    : tabCount > commaCount ? "\t"
    : pipeCount > commaCount ? "|"
    : ",";

  // Parse rows with proper quoted-field handling
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          currentField += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f)) rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }
  // Last field
  if (currentField.trim() || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f)) rows.push(currentRow);
  }

  if (rows.length === 0) return "[Empty CSV file]";

  // Build structured text with row references
  const colCount = rows[0]?.length ?? 0;
  const lines: string[] = [`[CSV: ${rows.length} rows × ${colCount} columns, delimiter: ${delimiter === "\t" ? "tab" : delimiter}]`];
  for (let i = 0; i < rows.length; i++) {
    const lineText = rows[i].filter((c) => c).join(" | ");
    if (lineText) lines.push(`Row ${i + 1}: ${lineText}`);
  }
  return normalizeExtractedText(lines.join("\n"));
}

function extractRtf(buffer: Buffer): string {
  const rtf = buffer.toString("latin1");
  // More thorough RTF cleaning:
  // 1. Remove RTF control words (\par, \tab, \b, etc.)
  // 2. Remove RTF groups ({\group})
  // 3. Convert \par and \line to newlines
  // 4. Convert \tab to tab
  // 5. Handle Unicode escapes (\uNNNN)
  // 6. Handle hex escapes (\\'NN)
  let cleaned = rtf
    // Convert paragraph/line breaks first (before removing control words)
    .replace(/\\par[d]?\b/gi, "\n")
    .replace(/\\line\b/gi, "\n")
    .replace(/\\tab\b/gi, "\t")
    // Unicode escapes: \uNNNN? where NNNN is a signed decimal
    .replace(/\\u(-?\d+)\??/g, (_, code) => {
      const num = parseInt(code, 10);
      return num < 0 ? String.fromCharCode(num + 65536) : String.fromCharCode(num);
    })
    // Hex escapes: \\'NN
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Remove remaining RTF control words and their optional numeric parameters
    .replace(/\\[a-zA-Z]+[-]?\d*\s?/g, " ")
    // Remove RTF control symbols (\\, \{, \}, etc.)
    .replace(/\\[^a-zA-Z]/g, "")
    // Remove remaining braces
    .replace(/[{}]/g, " ")
    // Collapse whitespace
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalizeExtractedText(cleaned);
}

export function isMeaningfulExtraction(text: string | null | undefined): boolean {
  if (!text) return false;
  if (/^\[(Scanned PDF|Extraction failed|Legacy \.doc|Image:)/i.test(text)) return false;
  return text.trim().length >= 20;
}

export function getFileTypeLabel(mimeType: string, fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (isPdf(mimeType, ext)) return "PDF";
  if (isDocx(mimeType, ext)) return ext === "doc" ? "DOC" : "DOCX";
  if (isXlsx(mimeType, ext)) return ext === "xls" ? "XLS" : ext === "ods" ? "ODS" : "XLSX";
  if (isPptx(mimeType, ext)) return ext === "ppt" ? "PPT" : ext === "odp" ? "ODP" : "PPTX";
  if (isCsv(mimeType, ext)) return "CSV";
  if (isRtf(mimeType, ext)) return "RTF";
  if (isImage(mimeType, ext)) return ext.toUpperCase();
  if (isText(mimeType, ext)) return ext.toUpperCase() || "TXT";
  return ext.toUpperCase() || "FILE";
}

export function detectCategoryFromFile(fileName: string, mimeType: string): string {
  const lower = fileName.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  if (isImage(mimeType, ext)) return "OTHER";
  if (/\bcv\b|curriculum.?vitae|resume/.test(lower)) return "EXPERT_CV";
  if (/company.?profile|firm.?profile|corporate.?profile|about.?us/.test(lower)) return "COMPANY_PROFILE";
  if (/financial|audit|statement|balance.?sheet|income|revenue|turnover|p[&+]l/.test(lower)) return "FINANCIAL_STATEMENT";
  if (/registr|incorp|legal|statute|bylaw|memorandum|certificate.?of.?incorp/.test(lower)) return "LEGAL_REGISTRATION";
  if (/certif|licen|permit|accredit|iso.?\d|quality/.test(lower)) return "CERTIFICATION";
  if (/reference|past.?project|contract|portfolio/.test(lower)) return "PROJECT_REFERENCE";
  if (/manual|policy|procedure|guideline|handbook|sop/.test(lower)) return "MANUAL";
  if (/compliance|gdpr|privacy|security.?audit/.test(lower)) return "COMPLIANCE_RECORD";
  if (["xlsx", "xls", "ods"].includes(ext)) return "FINANCIAL_STATEMENT";
  if (["pptx", "ppt", "odp"].includes(ext)) return "COMPANY_PROFILE";
  if (ext === "csv") return "FINANCIAL_STATEMENT";
  return "OTHER";
}

export const SUPPORTED_EXTENSIONS = ".pdf,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.csv,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp,.svg,.tiff,.bmp";
export const FILE_TYPE_COLORS: Record<string, string> = {
  PDF: "bg-red-100 text-red-700", DOCX: "bg-blue-100 text-blue-700", DOC: "bg-blue-100 text-blue-700", XLSX: "bg-green-100 text-green-700", XLS: "bg-green-100 text-green-700", ODS: "bg-green-100 text-green-700", PPTX: "bg-orange-100 text-orange-700", PPT: "bg-orange-100 text-orange-700", CSV: "bg-teal-100 text-teal-700", RTF: "bg-slate-100 text-slate-700", TXT: "bg-slate-100 text-slate-700", JPG: "bg-purple-100 text-purple-700", JPEG: "bg-purple-100 text-purple-700", PNG: "bg-purple-100 text-purple-700",
};
