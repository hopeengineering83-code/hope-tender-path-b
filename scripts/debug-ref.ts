import { extractReference } from "../lib/engine/tender-field-extractors";

const tests = [
  "Reference No.: RFP/2026/0042",
  "Tender Reference: XYZ/2026/01",
  "Tender Reference Number: ABC-2026-001",
  "Reference Number: Number",
];

for (const text of tests) {
  const result = extractReference({ files: [{ fileName: "t.pdf", extractedText: text }] });
  console.log(`"${text}" → found=${result.found}, value="${result.found ? result.value : 'N/A'}"`);
}
