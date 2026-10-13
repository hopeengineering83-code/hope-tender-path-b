// TEMPORARY — owner-authorized helper for the one final hosted acceptance run
// (temporary-preview-hosted-acceptance in
// .github/workflows/lockfile-refresh-artifact.yml). Delete alongside that job.
//
// Prints the final PDF's visible text, page by page, so the factual and
// compliance review is made against what the client actually reads rather than
// against a summary of it.
//
// Usage: node scripts/tmp-dump-pdf-text.mjs <pdf-path>

import { readFile } from "node:fs/promises";

const [, , pdfPath] = process.argv;
if (!pdfPath) {
  console.error("usage: node scripts/tmp-dump-pdf-text.mjs <pdf-path>");
  process.exit(2);
}

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(await readFile(pdfPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  // Rebuild lines from the y coordinate so table rows and headings stay
  // readable; a flat join turns a whole page into one unreviewable string.
  const rows = new Map();
  for (const item of content.items) {
    if (typeof item.str !== "string") continue;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    // A whitespace item is pdf.js reporting a space; keep it as a marker.
    if (item.str.trim().length === 0) { rows.get(y).push({ x: item.transform[4], width: item.width ?? 0, text: " ", space: true }); continue; }
    rows.get(y).push({ x: item.transform[4], width: item.width ?? 0, text: item.str });
  }
  // Join on the real gap. A font change (bold to regular) starts a new text
  // item, and joining every item with a space printed "Project Principal :"
  // and "Medical Center ." for text the PDF draws with no space at all.
  const joinRow = (parts) => parts.reduce((out, p, i) => {
    if (i === 0) return p.text;
    const prev = parts[i - 1];
    if (p.space) return out + " ";
    const gap = p.x - (prev.x + prev.width);
    return out + (gap > 1 || /\s$/.test(prev.text) ? " " : "") + p.text;
  }, "");
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => joinRow(parts.sort((a, b) => a.x - b.x)).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  console.log(`\n----- PAGE ${pageNumber} of ${doc.numPages} -----`);
  for (const line of lines) console.log(line);
}
