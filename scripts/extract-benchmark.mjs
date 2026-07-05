import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const pdfPath = process.argv[2];
const outPath = process.argv[3] ?? "benchmark-extracted.txt";

if (!pdfPath) {
  console.error("Usage: node scripts/extract-benchmark.mjs <pdf-path> [out-path]");
  process.exit(1);
}

const { PDFParse } = await import("pdf-parse");
const buf = await readFile(pdfPath);
const parser = new PDFParse({ data: buf });
const result = await parser.getText();

const text = result?.text ?? "";
const pages = result?.pages?.length ?? result?.numpages ?? 0;

const meta = {
  pages,
  textLength: text.length,
  approxWords: text.split(/\s+/).filter(Boolean).length,
};
result.text = text;

console.log(JSON.stringify(meta, null, 2));
await writeFile(outPath, result.text, "utf8");
console.log(`Wrote text to ${path.resolve(outPath)}`);
