import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2];
const outputFile = process.argv[3] ?? "app-output-combined.txt";

if (!inputDir) {
  console.error("Usage: node scripts/extract-docx.mjs <dir-with-docx> [out-file]");
  process.exit(1);
}

const mammoth = await import("mammoth");
const files = (await readdir(inputDir)).filter((f) => f.toLowerCase().endsWith(".docx")).sort();

const sections = [];
for (const file of files) {
  const buf = await readFile(path.join(inputDir, file));
  const result = await mammoth.extractRawText({ buffer: buf });
  sections.push(`\n\n========== ${file} (${result.value.length} chars, ~${result.value.split(/\s+/).filter(Boolean).length} words) ==========\n\n${result.value}`);
}

await writeFile(outputFile, sections.join("\n"), "utf8");
console.log(`Wrote ${files.length} files (combined ${sections.join("").length} chars) to ${outputFile}`);
