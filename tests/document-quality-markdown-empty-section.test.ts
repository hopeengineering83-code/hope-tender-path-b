import test from "node:test";
import assert from "node:assert/strict";
import { validateDocumentQuality } from "../lib/engine/document-quality-validator";

function warnings(text: string): string[] {
  return validateDocumentQuality({
    name: "Technical Proposal",
    documentType: "TECHNICAL_PROPOSAL",
    fileContent: text,
    storagePath: null,
  }).qualityWarnings;
}

test("normal Markdown spacing after a heading is not an empty section", () => {
  assert.ok(!warnings("# Methodology\n\nWe will assess, design, coordinate, supervise, commission, and hand over the facility.").includes("Empty section headings detected"));
});

test("a heading followed only by another heading is still detected as empty", () => {
  assert.ok(warnings("# Methodology\n\n## Work Plan\nThe work plan has sufficient substantive content to inspect.").includes("Empty section headings detected"));
});
