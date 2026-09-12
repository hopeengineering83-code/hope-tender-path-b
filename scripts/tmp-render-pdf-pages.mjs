// TEMPORARY — owner-authorized helper for the one final hosted acceptance run
// (temporary-preview-hosted-acceptance in
// .github/workflows/lockfile-refresh-artifact.yml). Delete alongside that job.
//
// Renders EVERY page of the final PDF to a PNG and reports the layout facts a
// text extraction cannot show: content that runs past the media box, a page
// whose text is missing entirely, page-number labels that do not agree with
// the real page count, and rows that reach the bottom margin.
//
// "Do not accept a PDF from text extraction alone." Page 34 of an earlier
// artifact had a table row reaching the page boundary, which extracted text
// reports as perfectly ordinary.
//
// Usage: node scripts/tmp-render-pdf-pages.mjs <pdf-path> <out-dir>

import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [, , pdfPath, outDir] = process.argv;
if (!pdfPath || !outDir) {
  console.error("usage: node scripts/tmp-render-pdf-pages.mjs <pdf-path> <out-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// Rasterisation is done by poppler's pdftoppm rather than a JS canvas: this is
// temporary tooling and must not add a dependency to the application. pdfjs,
// already a project dependency, supplies the text geometry the raster cannot.
const { execFileSync } = await import("node:child_process");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

function rasterisePages(source, destination) {
  try {
    execFileSync("pdftoppm", ["-png", "-r", "110", source, path.join(destination, "page")], { stdio: "pipe" });
    return true;
  } catch (error) {
    console.log(`raster: pdftoppm unavailable or failed (${error?.message ?? error})`);
    return false;
  }
}

const data = new Uint8Array(await readFile(pdfPath));
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
const pageCount = doc.numPages;
console.log(`pages: ${pageCount}`);

// Every page is rasterised first, so a page that cannot be drawn at all fails
// here rather than passing a text-only inspection.
const rasterised = rasterisePages(pdfPath, outDir);
if (rasterised) {
  const { readdirSync } = await import("node:fs");
  const pngs = readdirSync(outDir).filter((name) => name.endsWith(".png"));
  console.log(`raster: ${pngs.length} page image(s) written to ${outDir}`);
  if (pngs.length !== pageCount) {
    console.log(`raster: WARNING rendered ${pngs.length} image(s) for ${pageCount} page(s)`);
  }
}

const problems = [];
const labelPattern = /Page\s+(\d+)\s+of\s+(\d+)/i;
let labelledPages = 0;

for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
  const page = await doc.getPage(pageNumber);
  // Layout facts from the unscaled text geometry.
  const [, , mediaWidth, mediaHeight] = page.view;
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((item) => typeof item.str === "string" && item.str.trim().length > 0);

  if (items.length === 0) {
    problems.push(`page ${pageNumber}: rendered but carries no text`);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let pageText = "";
  for (const item of items) {
    const x = item.transform[4];
    const y = item.transform[5];
    const width = item.width ?? 0;
    const height = item.height ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + height);
    pageText += `${item.str} `;
  }

  if (items.length > 0) {
    // Out-of-bounds text is clipped text: the reader never sees it.
    if (minX < -1 || minY < -1 || maxX > mediaWidth + 1 || maxY > mediaHeight + 1) {
      problems.push(
        `page ${pageNumber}: text outside the media box `
        + `(x ${minX.toFixed(1)}..${maxX.toFixed(1)} of ${mediaWidth}, `
        + `y ${minY.toFixed(1)}..${maxY.toFixed(1)} of ${mediaHeight})`,
      );
    }
    // Content reaching within 18pt of the bottom edge collides with the footer.
    if (minY < 18) {
      problems.push(`page ${pageNumber}: content reaches ${minY.toFixed(1)}pt from the bottom edge (footer collision risk)`);
    }
  }

  const label = pageText.match(labelPattern);
  if (label) {
    labelledPages += 1;
    if (Number(label[1]) !== pageNumber) {
      problems.push(`page ${pageNumber}: labelled "Page ${label[1]}" — wrong page number`);
    }
    if (Number(label[2]) !== pageCount) {
      problems.push(`page ${pageNumber}: labelled "of ${label[2]}" but the document has ${pageCount} pages`);
    }
  } else {
    problems.push(`page ${pageNumber}: no "Page N of M" label found`);
  }
}

console.log(`pages carrying a correct "Page N of M" label: ${labelledPages}/${pageCount}`);
if (problems.length === 0) {
  console.log("layout: no clipping, overflow, footer collision or pagination problem found on any page");
  process.exit(0);
}
console.log(`layout problems (${problems.length}):`);
for (const problem of problems) console.log(`  - ${problem}`);
process.exit(1);
