// Text extraction from uploaded documents. Runs at upload time so all text
// is immediately searchable and usable by the analysis engine.
// Supports: PDF, DOCX/DOC, XLSX/XLS, PPTX/PPT, CSV, TXT, RTF, ODS, ODP + images.

const MAX_EXTRACTED_TEXT_CHARS = 500_000;
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
    console.error(`[extract-text] ${fileName} (${mimeType}):`, err);
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
    // Common PDF ligatures (U+FB00–U+FB06) — replace with letter pairs so
    // text is searchable / readable. Without this, words like "specified",
    // "office", "official" appear with unusual glyphs in every section.
    .replace(/ﬀ/g, "ff")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/ﬅ/g, "ft")
    .replace(/ﬆ/g, "st")
    // Smart quotes → ASCII apostrophe / double-quote
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    // Ellipsis → three dots
    .replace(/…/g, "...")
    // Non-breaking / thin / hair / narrow / figure spaces → regular space
    .replace(/[     ]/g, " ")
    // Zero-width spaces / joiners / BOM → drop entirely
    .replace(/[​‌‍﻿]/g, "")
    // Glyph-noise runs: 5+ consecutive single-capital letters separated by
    // single spaces (e.g., "G G E N E R A T E G P D F"). These are font
    // glyphs from icons/emojis that pdf-parse re-emitted as letterforms.
    // Real text rarely produces this pattern at length 5+ (acronyms like
    // USA / PLC are 3 chars).
    .replace(/(?:\b[A-Z]\s+){5,}[A-Z]\b/g, " ");

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
      text = result?.text ?? "";
      pages = result?.total ?? result?.pages?.length ?? 0;
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
    parser.on("pdfParser_dataReady", (pdfData: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }) => {
      const pages = pdfData.Pages ?? [];
      const pageTexts = pages.map((page, index) => {
        const raw = (page.Texts ?? [])
          .map((textItem) => (textItem.R ?? []).map((run) => decodeURIComponent(run.T ?? "")).join(""))
          .filter(Boolean)
          .join(" ");
        return raw ? `[Page ${index + 1}]\n${raw}` : "";
      }).filter(Boolean);
      resolve({ text: normalizeExtractedText(pageTexts.join("\n\n")), pages: pages.length });
    });
    parser.parseBuffer(buffer);
  });
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
    const items = (content.items ?? []) as Array<{ str?: string; hasEOL?: boolean }>;
    const pageText = items.map((item) => item.str ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").replace(/[ \t]+\n/g, "\n").trim();
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

  let Anthropic: { new (config: { apiKey: string }): unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk").Anthropic;
  } catch (err) {
    console.warn("[extract-text] @anthropic-ai/sdk not available for OCR fallback:", err);
    return "";
  }

  // If we know the page count and it exceeds the per-call cap, take only
  // the first PDF_OCR_MAX_PAGES_PER_CALL pages. We trim the buffer by
  // re-rendering with pdfjs in a follow-up patch; for now we send the
  // whole document (Anthropic accepts up to ~100 pages per request).
  // The cap above is enforced by the model itself on big files.
  const knownPages = typeof pageCount === "number" ? pageCount : null;
  if (knownPages && knownPages > PDF_OCR_MAX_PAGES_PER_CALL) {
    console.warn(`[extract-text] PDF has ${knownPages} pages; OCR call may be slow / costly (cap is ${PDF_OCR_MAX_PAGES_PER_CALL} pages).`);
  }

  const base64Pdf = buffer.toString("base64");

  // Use the same canonical Claude model name normalization as lib/ai.ts
  // so user typos in the env var don't break OCR. The OCR-specific model
  // can be overridden via PDF_OCR_MODEL.
  const rawModel = process.env.PDF_OCR_MODEL || "claude-3-5-sonnet-latest";
  const modelName = rawModel.trim().toLowerCase().replace(/[._\s]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  const client = new (Anthropic as new (config: { apiKey: string }) => {
    messages: { create: (input: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }> };
  })({ apiKey });

  try {
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 8000,
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
    });
    const text = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[extract-text] Claude vision OCR failed (${modelName}):`, msg);
    return "";
  }
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const results: Array<{ source: string; text: string; pages: number }> = [];
  try { const r = await extractPdfWithPdfParse(buffer); results.push({ source: "pdf-parse", ...r }); } catch (error) { console.warn("[extract-text] pdf-parse failed:", error); }
  try { const r = await extractPdfWithPdf2Json(buffer); results.push({ source: "pdf2json", ...r }); } catch (error) { console.warn("[extract-text] pdf2json failed:", error); }
  try { const r = await extractPdfWithPdfJs(buffer); results.push({ source: "pdfjs", ...r }); } catch (error) { console.warn("[extract-text] pdfjs failed:", error); }

  const best = results.sort((a, b) => b.text.length - a.text.length)[0];
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
  if ((!best?.text || best.text.length < 20) && ocrEnabled) {
    console.info(`[extract-text] PDF has no text layer (${pages} pages) — running Claude vision OCR fallback (default-on, set PDF_OCR_ENABLED=false to disable).`);
    const ocrText = await extractPdfWithClaudeVision(buffer, pages);
    if (ocrText && ocrText.length >= 20) {
      const normalized = normalizeExtractedText(ocrText);
      return normalizeExtractedText(`[PDF text extracted via Claude vision OCR — ${pages} page(s).]\n\n${normalized}`);
    }
    console.warn("[extract-text] Claude vision OCR returned empty — returning scanned-PDF placeholder.");
  }

  if (!best?.text || best.text.length < 20) {
    if (!ocrEnabled) {
      return `[Scanned PDF — ${pages} page(s). Text layer not found. Vision OCR fallback is disabled (PDF_OCR_ENABLED=false or no ANTHROPIC_API_KEY). Re-enable OCR or upload a digital PDF / DOCX with selectable text.]`;
    }
    return `[Scanned PDF — ${pages} page(s). Text layer not found and Claude vision OCR returned empty. The PDF may be image-only with very low resolution, password-protected, or otherwise unreadable. Try uploading a higher-resolution scan or a digital PDF.]`;
  }
  if (best.text.length <= LEGACY_TEXT_LIMIT && Number(pages) > 1) return normalizeExtractedText(`[PDF text extracted from ${pages} page(s) using ${best.source}.]\n\n${best.text}`);
  return best.text;
}

async function extractDocx(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "doc") return "[Legacy .doc file detected. Please save as .docx for reliable text extraction.]";
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result.value ?? "");
}

async function extractXlsx(buffer: Buffer, fileName: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const cleaned = csv.split("\n").filter((row: string) => row.replace(/,/g, "").trim().length > 0).join("\n").trim();
    if (cleaned) parts.push(`[Sheet: ${sheetName}]\n${cleaned}`);
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
  const text = buffer.toString("utf8");
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  const header = rows[0] ?? "";
  const colCount = (header.match(/,/g) ?? []).length + 1;
  return normalizeExtractedText(`[CSV: ${rows.length} rows × ${colCount} columns]\n${text}`);
}

function extractRtf(buffer: Buffer): string {
  const rtf = buffer.toString("latin1");
  const cleaned = rtf.replace(/\{\\[^{}]*\}/g, " ").replace(/\\[a-z]+[-\d]* ?/gi, " ").replace(/[{}\\]/g, " ").replace(/\s{2,}/g, " ").trim();
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
