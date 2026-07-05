// One-off extraction script for the benchmark gap analysis.
// Reads every file in benchmark-samples/ and writes plain-text
// extractions to benchmark-samples/extracted/ for diffing.
//
// Uses the same extractors the app's lib/extract-text.ts uses
// (pdf-parse + mammoth) so the comparison is apples-to-apples
// with what the app would have seen at upload time.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SAMPLES = "benchmark-samples";
const OUT = "benchmark-samples/extracted";
mkdirSync(OUT, { recursive: true });

async function extractPdf(buffer) {
  const mod = await import("pdf-parse");
  const fn = mod.default ?? mod;
  if (typeof fn === "function") {
    const result = await fn(buffer);
    return { text: result?.text ?? "", pages: result?.numpages ?? 0 };
  }
  return { text: "", pages: 0 };
}

async function extractDocx(buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value ?? "", pages: 0 };
}

const targets = [];

// Top-level files
for (const entry of readdirSync(SAMPLES)) {
  const fp = join(SAMPLES, entry);
  const stat = statSync(fp);
  if (!stat.isFile()) continue;
  if (entry.toLowerCase().endsWith(".pdf") || entry.toLowerCase().endsWith(".docx")) {
    targets.push({ path: fp, label: entry.replace(/\.[^.]+$/, "") });
  }
}

// Files inside the unzipped folders
for (const sub of ["unzipped-pharo", "unzipped-path"]) {
  const dir = join(SAMPLES, sub);
  try {
    for (const entry of readdirSync(dir)) {
      const fp = join(dir, entry);
      if (!statSync(fp).isFile()) continue;
      if (entry.toLowerCase().endsWith(".docx") || entry.toLowerCase().endsWith(".pdf")) {
        targets.push({ path: fp, label: `${sub}__${entry.replace(/\.[^.]+$/, "")}` });
      }
    }
  } catch (err) { /* missing dir */ }
}

console.log(`Extracting ${targets.length} files...`);

for (const t of targets) {
  try {
    const buf = readFileSync(t.path);
    const isPdf = t.path.toLowerCase().endsWith(".pdf");
    const result = isPdf ? await extractPdf(buf) : await extractDocx(buf);
    const safe = t.label.replace(/[^a-zA-Z0-9_-]+/g, "_");
    const outFile = join(OUT, `${safe}.txt`);
    writeFileSync(outFile, result.text);
    console.log(`✓ ${t.label} — ${result.text.length.toLocaleString()} chars (${result.pages || "?"} pages)`);
  } catch (err) {
    console.warn(`✗ ${t.label} — ${err.message}`);
  }
}

console.log("Done. Extractions in benchmark-samples/extracted/");
