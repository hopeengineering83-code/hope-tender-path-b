// Text extraction from uploaded documents. Runs at upload time so all text
// is immediately searchable and usable by the analysis engine.
// Supports: PDF, DOCX/DOC, XLSX/XLS, PPTX/PPT, CSV, TXT, RTF, ODS, ODP + images.

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  try {
    if (isPdf(mimeType, ext)) return await extractPdf(buffer);
    if (isDocx(mimeType, ext)) return await extractDocx(buffer);
    if (isXlsx(mimeType, ext)) return await extractXlsx(buffer, fileName);
    if (isPptx(mimeType, ext)) return await extractPptx(buffer);
    if (isCsv(mimeType, ext)) return extractCsv(buffer);
    if (isRtf(mimeType, ext)) return extractRtf(buffer);
    if (isText(mimeType, ext)) return buffer.toString("utf8").slice(0, 50000);
    if (isImage(mimeType, ext)) return `[Image: ${fileName}]`;
    return "";
  } catch (err) {
    console.error(`[extract-text] ${fileName} (${mimeType}):`, err);
    return "";
  }
}

// ─── Type detectors ──────────────────────────────────────────────────────────

function isPdf(mime: string, ext: string) {
  return mime === "application/pdf" || ext === "pdf";
}

function isDocx(mime: string, ext: string) {
  return (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/msword" ||
    ext === "docx" || ext === "doc"
  );
}

function isXlsx(mime: string, ext: string) {
  return (
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.oasis.opendocument.spreadsheet" ||
    ["xlsx", "xls", "ods"].includes(ext)
  );
}

function isPptx(mime: string, ext: string) {
  return (
    mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/vnd.oasis.opendocument.presentation" ||
    ["pptx", "ppt", "odp"].includes(ext)
  );
}

function isCsv(mime: string, ext: string) {
  return mime === "text/csv" || mime === "text/comma-separated-values" || ext === "csv";
}

function isRtf(mime: string, ext: string) {
  return mime === "application/rtf" || mime === "text/rtf" || ext === "rtf";
}

function isText(mime: string, ext: string) {
  return mime.startsWith("text/") || ["txt", "md", "json", "xml"].includes(ext);
}

function isImage(mime: string, ext: string) {
  return (
    mime.startsWith("image/") ||
    ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff"].includes(ext)
  );
}

// ─── Extractors ───────────────────────────────────────────────────────────────

async function extractPdf(buffer: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const result = await pdfParse(buffer);
  const text = (result.text ?? "").trim();
  if (!text || text.length < 20) {
    return `[Scanned PDF — ${result.numpages} page(s). Text layer not found. Upload a text-based PDF or use OCR conversion for analysis.]`;
  }
  return text.slice(0, 80000);
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return (result.value ?? "").trim().slice(0, 80000);
}

async function extractXlsx(buffer: Buffer, fileName: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require("xlsx") as typeof import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellText: true });
  const parts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    const cleaned = csv
      .split("\n")
      .filter((row) => row.replace(/,/g, "").trim().length > 0)
      .join("\n")
      .trim();
    if (cleaned) parts.push(`[Sheet: ${sheetName}]\n${cleaned}`);
  }

  if (parts.length === 0) return `[Empty spreadsheet: ${fileName}]`;
  return parts.join("\n\n").slice(0, 80000);
}

async function extractPptx(buffer: Buffer): Promise<string> {
  // PPTX/ODP are ZIP archives containing XML slide files
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
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
    const text = matches
      .map((m) => m[1].trim())
      .filter((t) => t.length > 0)
      .join(" ");
    if (text) slideTexts.push(text);
  }

  const result = slideTexts.join("\n");
  return result ? result.slice(0, 80000) : "[Presentation has no extractable text]";
}

function extractCsv(buffer: Buffer): string {
  const text = buffer.toString("utf8");
  const rows = text.split(/\r?\n/).filter((r) => r.trim());
  const header = rows[0] ?? "";
  const colCount = (header.match(/,/g) ?? []).length + 1;
  const summary = `[CSV: ${rows.length} rows × ${colCount} columns]\n`;
  return (summary + text).slice(0, 80000);
}

function extractRtf(buffer: Buffer): string {
  const rtf = buffer.toString("latin1");
  const cleaned = rtf
    .replace(/\{\\[^{}]*\}/g, " ")
    .replace(/\\[a-z]+[-\d]* ?/gi, " ")
    .replace(/[{}\\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned.slice(0, 80000);
}

// ─── Metadata helpers (exported for use in upload routes) ────────────────────

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

  // By file type
  if (["xlsx", "xls", "ods"].includes(ext)) return "FINANCIAL_STATEMENT";
  if (["pptx", "ppt", "odp"].includes(ext)) return "COMPANY_PROFILE";
  if (ext === "csv") return "FINANCIAL_STATEMENT";

  return "OTHER";
}

export const SUPPORTED_EXTENSIONS =
  ".pdf,.doc,.docx,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.csv,.txt,.rtf,.jpg,.jpeg,.png,.gif,.webp,.svg,.tiff,.bmp";

export const FILE_TYPE_COLORS: Record<string, string> = {
  PDF: "bg-red-100 text-red-700",
  DOCX: "bg-blue-100 text-blue-700",
  DOC: "bg-blue-100 text-blue-700",
  XLSX: "bg-green-100 text-green-700",
  XLS: "bg-green-100 text-green-700",
  ODS: "bg-green-100 text-green-700",
  PPTX: "bg-orange-100 text-orange-700",
  PPT: "bg-orange-100 text-orange-700",
  CSV: "bg-teal-100 text-teal-700",
  RTF: "bg-slate-100 text-slate-700",
  TXT: "bg-slate-100 text-slate-700",
  JPG: "bg-purple-100 text-purple-700",
  JPEG: "bg-purple-100 text-purple-700",
  PNG: "bg-purple-100 text-purple-700",
};
