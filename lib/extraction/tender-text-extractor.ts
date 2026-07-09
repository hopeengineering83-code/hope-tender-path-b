// lib/extraction/tender-text-extractor.ts
//
// Types for extracted tender source files, pages, and tables.
// Also exports the text extraction functions for each file type.

import { createHash } from "node:crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ExtractedTenderSourceFile = {
  tenderId: string;
  fileId: string;
  originalFileName: string;
  fileType: "PDF" | "DOCX" | "XLSX" | "CSV" | "TXT" | "UNKNOWN";
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
  pageCount: number | null;
  sheetCount: number | null;
  extractionStatus:
    | "extracted"
    | "partial"
    | "empty"
    | "encrypted"
    | "corrupt"
    | "unsupported"
    | "ocr_required"
    | "ocr_unavailable"
    | "failed";
  extractedText: string;
  pages: ExtractedTenderPage[];
  tables: ExtractedTenderTable[];
  warnings: string[];
};

export type ExtractedTenderPage = {
  pageNumber: number;
  text: string;
  charCount: number;
  extractionMethod: "native_pdf" | "docx" | "xlsx" | "csv" | "txt" | "ocr" | "unknown";
};

export type ExtractedTenderTable = {
  tableId: string;
  sourceFileId: string;
  pageNumber: number | null;
  sheetName: string | null;
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: string[][];
  textEquivalent: string;
};

// ─── Text extraction functions ───────────────────────────────────────────────

/**
 * Extract text from a PDF buffer.
 * Uses pdf-parse for native text extraction.
 * Returns pages with page numbers and extraction method.
 * If pages have no text, marks as ocr_required.
 */
export async function extractPdfText(
  pdfBuffer: Buffer,
  fileId: string,
): Promise<{ pages: ExtractedTenderPage[]; tables: ExtractedTenderTable[]; status: ExtractedTenderSourceFile["extractionStatus"]; warnings: string[] }> {
  const warnings: string[] = [];
  const pages: ExtractedTenderPage[] = [];
  const tables: ExtractedTenderTable[] = [];

  try {
    // Dynamic import to avoid loading pdf-parse in environments without it
    const pdfParseModule = await import("pdf-parse");
    const pdfParse = (pdfParseModule as any).default ?? pdfParseModule;
    const data = await pdfParse(pdfBuffer);

    // pdf-parse returns text per page via data.text (all pages joined)
    // and numpages. We need to split by page markers.
    const totalPages = data.numpages ?? 1;
    const fullText = data.text ?? "";

    if (!fullText.trim()) {
      // No text extracted — likely a scanned PDF
      return {
        pages: [],
        tables: [],
        status: "ocr_required",
        warnings: ["PDF has no extractable text — likely scanned. OCR is required."],
      };
    }

    // Split text into pages using form feed (\f) which pdf-parse uses as page separator
    const pageTexts = fullText.split("\f");
    for (let i = 0; i < pageTexts.length; i++) {
      const text = pageTexts[i].trim();
      pages.push({
        pageNumber: i + 1,
        text,
        charCount: text.length,
        extractionMethod: "native_pdf",
      });
      if (text.length < 10 && totalPages > 1) {
        warnings.push(`Page ${i + 1} has very little text (${text.length} chars) — may be scanned or image-only.`);
      }
    }

    // If we got fewer pages than expected, add empty pages
    if (pages.length < totalPages) {
      for (let i = pages.length; i < totalPages; i++) {
        pages.push({
          pageNumber: i + 1,
          text: "",
          charCount: 0,
          extractionMethod: "unknown",
        });
        warnings.push(`Page ${i + 1} could not be extracted — may be scanned.`);
      }
    }

    const hasEmptyPages = pages.some((p) => p.charCount === 0);
    return {
      pages,
      tables,
      status: hasEmptyPages ? "partial" : "extracted",
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Password") || msg.includes("encrypt") || msg.includes("PasswordException")) {
      return { pages: [], tables: [], status: "encrypted", warnings: ["PDF is password-protected/encrypted."] };
    }
    if (msg.includes("corrupt") || msg.includes("invalid") || msg.includes("Header")) {
      return { pages: [], tables: [], status: "corrupt", warnings: [`PDF appears corrupt: ${msg}`] };
    }
    return { pages: [], tables: [], status: "failed", warnings: [`PDF extraction failed: ${msg}`] };
  }
}

/**
 * Extract text from a DOCX buffer.
 * Uses mammoth for paragraph/heading extraction.
 */
export async function extractDocxText(
  docxBuffer: Buffer,
  fileId: string,
): Promise<{ pages: ExtractedTenderPage[]; tables: ExtractedTenderTable[]; status: ExtractedTenderSourceFile["extractionStatus"]; warnings: string[] }> {
  const warnings: string[] = [];
  const tables: ExtractedTenderTable[] = [];

  try {
    const mammoth = await import("mammoth");
    // Extract raw text (paragraphs + headings)
    const textResult = await mammoth.extractRawText({ buffer: docxBuffer });
    const text = textResult.value ?? "";

    if (!text.trim()) {
      return { pages: [], tables: [], status: "empty", warnings: ["DOCX has no extractable text."] };
    }

    // DOCX doesn't have "pages" in the same sense as PDF.
    // We treat the entire document as one "page" with page number 1.
    const pages: ExtractedTenderPage[] = [{
      pageNumber: 1,
      text,
      charCount: text.length,
      extractionMethod: "docx",
    }];

    // Try to extract tables via mammoth's convertToHtml
    try {
      const htmlResult = await mammoth.convertToHtml({ buffer: docxBuffer });
      const html = htmlResult.value ?? "";
      // Parse HTML tables
      const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
      for (let ti = 0; ti < tableMatches.length; ti++) {
        const tableHtml = tableMatches[ti];
        const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
        const rows: string[][] = [];
        for (const rowHtml of rowMatches) {
          const cellMatches = rowHtml.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
          const cells = cellMatches.map((c) => c.replace(/<[^>]+>/g, "").trim());
          rows.push(cells);
        }
        if (rows.length > 0) {
          const headers = rows[0];
          const dataRows = rows.slice(1);
          const textEquivalent = rows.map((r) => r.join(" | ")).join("\n");
          tables.push({
            tableId: `${fileId}_table_${ti}`,
            sourceFileId: fileId,
            pageNumber: 1,
            sheetName: null,
            rowCount: rows.length,
            columnCount: headers.length,
            headers,
            rows: dataRows,
            textEquivalent,
          });
        }
      }
    } catch {
      warnings.push("Table extraction from DOCX failed — text extraction succeeded.");
    }

    return { pages, tables, status: "extracted", warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("zip") || msg.includes("corrupt")) {
      return { pages: [], tables: [], status: "corrupt", warnings: [`DOCX appears corrupt: ${msg}`] };
    }
    return { pages: [], tables: [], status: "failed", warnings: [`DOCX extraction failed: ${msg}`] };
  }
}

/**
 * Extract text from XLSX buffer.
 * Uses @e965/xlsx for sheet/row/column extraction.
 */
export async function extractXlsxText(
  xlsxBuffer: Buffer,
  fileId: string,
): Promise<{ pages: ExtractedTenderPage[]; tables: ExtractedTenderTable[]; status: ExtractedTenderSourceFile["extractionStatus"]; warnings: string[] }> {
  const warnings: string[] = [];
  const tables: ExtractedTenderTable[] = [];
  const pages: ExtractedTenderPage[] = [];

  try {
    const XLSX = await import("@e965/xlsx");
    const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return { pages: [], tables: [], status: "empty", warnings: ["XLSX has no sheets."] };
    }

    for (let si = 0; si < sheetNames.length; si++) {
      const sheetName = sheetNames[si];
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];
      if (rows.length === 0) continue;

      const headers = rows[0].map((c: any) => String(c ?? "").trim());
      const dataRows = rows.slice(1).map((r: any) => r.map((c: any) => String(c ?? "").trim()));
      const textEquivalent = rows.map((r: any) => r.map((c: any) => String(c ?? "")).join(" | ")).join("\n");

      tables.push({
        tableId: `${fileId}_sheet_${si}`,
        sourceFileId: fileId,
        pageNumber: null,
        sheetName,
        rowCount: rows.length,
        columnCount: headers.length,
        headers,
        rows: dataRows,
        textEquivalent,
      });

      pages.push({
        pageNumber: si + 1, // Use sheet index as "page" for XLSX
        text: textEquivalent,
        charCount: textEquivalent.length,
        extractionMethod: "xlsx",
      });
    }

    return { pages, tables, status: "extracted", warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("zip") || msg.includes("corrupt")) {
      return { pages: [], tables: [], status: "corrupt", warnings: [`XLSX appears corrupt: ${msg}`] };
    }
    return { pages: [], tables: [], status: "failed", warnings: [`XLSX extraction failed: ${msg}`] };
  }
}

/**
 * Extract text from CSV content.
 */
export function extractCsvText(
  csvContent: string,
  fileId: string,
): { pages: ExtractedTenderPage[]; tables: ExtractedTenderTable[]; status: ExtractedTenderSourceFile["extractionStatus"]; warnings: string[] } {
  const warnings: string[] = [];
  const tables: ExtractedTenderTable[] = [];

  if (!csvContent.trim()) {
    return { pages: [], tables: [], status: "empty", warnings: ["CSV is empty."] };
  }

  // Simple CSV parsing (no quoted-comma handling for now — production would use papaparse)
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return { pages: [], tables: [], status: "empty", warnings: ["CSV has no data rows."] };
  }

  const rows = lines.map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const textEquivalent = rows.map((r) => r.join(" | ")).join("\n");

  tables.push({
    tableId: `${fileId}_csv`,
    sourceFileId: fileId,
    pageNumber: null,
    sheetName: null,
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    rows: dataRows,
    textEquivalent,
  });

  return {
    pages: [{ pageNumber: 1, text: textEquivalent, charCount: textEquivalent.length, extractionMethod: "csv" }],
    tables,
    status: "extracted",
    warnings,
  };
}

/**
 * Extract text from a plain text file.
 */
export function extractTxtText(
  txtContent: string,
  fileId: string,
): { pages: ExtractedTenderPage[]; tables: ExtractedTenderTable[]; status: ExtractedTenderSourceFile["extractionStatus"]; warnings: string[] } {
  const warnings: string[] = [];

  // Normalize line endings
  const text = txtContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!text.trim()) {
    return { pages: [], tables: [], status: "empty", warnings: ["TXT file is empty."] };
  }

  return {
    pages: [{ pageNumber: 1, text, charCount: text.length, extractionMethod: "txt" }],
    tables: [],
    status: "extracted",
    warnings,
  };
}

/**
 * Compute a stable hash for a text string.
 */
export function computeTextHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
