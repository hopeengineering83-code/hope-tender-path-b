// Test the regex directly
const LABEL_WORDS = "(?:Number|Reference|Ref|No|ID|Code)";
const patterns = [
  new RegExp(
    "\\b(?:Tender|RFP|RFQ|ITB|EOI|Procurement)\\s+(?:Reference|Ref(?:erence)?|Number|No\\.?|ID)\\s*[:#-]?\\s*" +
    "(?!" + LABEL_WORDS + "\\b)" +
    "([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"
  ),
  new RegExp(
    "\\bReference\\s+(?:No\\.?|Number|#)\\s*[:.]?\\s*" +
    "(?!" + LABEL_WORDS + "\\b)" +
    "([A-Z0-9][A-Z0-9./_\\-]{2,40})", "i"
  ),
];

const tests = [
  "Reference No.: RFP/2026/0042",
  "Tender Reference: XYZ/2026/01",
  "Tender Reference Number: ABC-2026-001",
];

for (const text of tests) {
  for (const p of patterns) {
    const m = p.exec(text);
    console.log(`Pattern: ${p.source.slice(0, 60)}... | Text: "${text}" → match=${m ? m[1] : 'NONE'}`);
  }
}

// Also test without the negative lookahead
const simplePattern = /\bReference\s+(?:No\.?|Number|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9./_\-]{2,40})/i;
for (const text of tests) {
  const m = simplePattern.exec(text);
  console.log(`Simple: Text: "${text}" → match=${m ? m[1] : 'NONE'}`);
}
