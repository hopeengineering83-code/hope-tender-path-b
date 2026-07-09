// lib/extraction/tender-table-extractor.ts
//
// Extracts table-like structures from text and preserves row references.
// Re-exports the ExtractedTenderTable type from tender-text-extractor.

export type { ExtractedTenderTable } from "./tender-text-extractor";

import type { ExtractedTenderTable } from "./tender-text-extractor";

/**
 * Detect table-like text patterns in extracted text.
 * Looks for pipe-separated rows, tab-separated rows, or consistent column widths.
 */
export function detectTablesInText(text: string, fileId: string, pageNumber: number | null): ExtractedTenderTable[] {
  const tables: ExtractedTenderTable[] = [];
  const lines = text.split("\n");
  let currentTable: string[][] | null = null;
  let tableStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Detect pipe-separated rows
    if (line.includes("|") && line.split("|").length >= 3) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        if (!currentTable) {
          currentTable = [];
          tableStartLine = i;
        }
        currentTable.push(cells);
        continue;
      }
    }
    // Detect tab-separated rows
    if (line.includes("\t") && line.split("\t").length >= 3) {
      const cells = line.split("\t").map((c) => c.trim());
      if (!currentTable) {
        currentTable = [];
        tableStartLine = i;
      }
      currentTable.push(cells);
      continue;
    }
    // End of table
    if (currentTable && currentTable.length >= 2) {
      tables.push(buildTable(currentTable, fileId, pageNumber, tableStartLine, tables.length));
    }
    currentTable = null;
  }
  // Final table
  if (currentTable && currentTable.length >= 2) {
    tables.push(buildTable(currentTable, fileId, pageNumber, tableStartLine, tables.length));
  }

  return tables;
}

function buildTable(rows: string[][], fileId: string, pageNumber: number | null, startLine: number, index: number): ExtractedTenderTable {
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const textEquivalent = rows.map((r) => r.join(" | ")).join("\n");
  return {
    tableId: `${fileId}_text_table_${index}`,
    sourceFileId: fileId,
    pageNumber,
    sheetName: null,
    rowCount: rows.length,
    columnCount: headers.length,
    headers,
    rows: dataRows,
    textEquivalent,
  };
}

/**
 * Create a text equivalent from a table for AI analysis.
 * This lets the AI see table content as structured text without losing row identity.
 */
export function tableToTextEquivalent(table: ExtractedTenderTable): string {
  const lines: string[] = [];
  lines.push(`[Table: ${table.rowCount} rows × ${table.columnCount} columns${table.sheetName ? `, sheet: ${table.sheetName}` : ""}]`);
  if (table.headers.length > 0) {
    lines.push(`Headers: ${table.headers.join(" | ")}`);
  }
  for (let i = 0; i < table.rows.length; i++) {
    lines.push(`Row ${i + 1}: ${table.rows[i].join(" | ")}`);
  }
  return lines.join("\n");
}

/**
 * Check if a table looks like a BOQ / price schedule.
 */
export function isBoqTable(table: ExtractedTenderTable): boolean {
  const headers = table.headers.map((h) => h.toLowerCase());
  const boqKeywords = ["item", "description", "unit", "quantity", "price", "rate", "amount", "total"];
  const matchCount = headers.filter((h) => boqKeywords.some((kw) => h.includes(kw))).length;
  return matchCount >= 3;
}
