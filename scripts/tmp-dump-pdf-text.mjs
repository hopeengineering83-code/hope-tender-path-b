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
    if (typeof item.str !== "string" || item.str.trim().length === 0) continue;
    const y = Math.round(item.transform[5]);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: item.transform[4], text: item.str });
  }
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  console.log(`\n----- PAGE ${pageNumber} of ${doc.numPages} -----`);
  for (const line of lines) console.log(line);
}
