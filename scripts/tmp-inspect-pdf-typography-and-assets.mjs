// TEMPORARY — does the DELIVERED PDF actually contain the brand asset bytes?
//
// WHY THIS EXISTS
// ---------------
// "Verify embedded asset bytes in the ACTUAL final DOCX/PDF. ACTIVE metadata
// alone is not proof." The asset store reports STAMP, SIGNATURE and LETTERHEAD
// as ACTIVE with integrity VERIFIED, and none of that says whether a single
// byte of them reached the client's copy.
//
// Text extraction cannot answer this, and text extraction has already misled
// this work three times in one session — reporting markdown that was really CI
// log tail, and reporting a spacing defect the source does not contain, because
// extractors insert a space at a font-run boundary. This reads the PDF's own
// object graph: an image counts only when its XObject bytes are in the file.
//
// Removed with the rest of the temporary acceptance tooling.

import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from "pdf-lib";

const path = process.argv[2];
if (!path) {
  console.error("usage: tmp-inspect-pdf-typography-and-assets.mjs <file.pdf>");
  process.exit(1);
}

const bytes = readFileSync(path);
const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
const pages = pdf.getPages();

console.log(`=== DELIVERED PDF ASSET AUDIT (${pages.length} pages, ${bytes.length} bytes) ===`);

let total = 0;
const found = [];
pages.forEach((page, index) => {
  const resources = page.node.get(PDFName.of("Resources"));
  if (!(resources instanceof PDFDict)) return;
  const xobjects = resources.get(PDFName.of("XObject"));
  if (!(xobjects instanceof PDFDict)) return;
  for (const [name, ref] of xobjects.entries()) {
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    if (stream.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    total += 1;
    const w = stream.dict.get(PDFName.of("Width"))?.toString() ?? "?";
    const h = stream.dict.get(PDFName.of("Height"))?.toString() ?? "?";
    const filter = stream.dict.get(PDFName.of("Filter"))?.toString() ?? "?";
    found.push(`  page ${index + 1}: ${name.toString()} ${w}x${h} ${filter} ${stream.contents.length} bytes`);
  }
});

console.log(`EMBEDDED IMAGE XOBJECTS: ${total}`);
for (const line of found) console.log(line);

// The four assets the owner uploaded, and what their presence would look like.
// Sizes are reported so a 3,246-byte signature is distinguishable from a
// 103,155-byte stamp without needing to decode either.
if (total === 0) {
  console.log("");
  console.log("  RESULT: the client's copy contains NO images at all.");
  console.log("  Letterhead, logo, signature and stamp are each absent from the");
  console.log("  delivered artifact regardless of what the asset store reports.");
} else {
  console.log("");
  console.log(`  RESULT: ${total} image(s) reached the client's copy.`);
}

console.log("=== END DELIVERED PDF ASSET AUDIT ===");
