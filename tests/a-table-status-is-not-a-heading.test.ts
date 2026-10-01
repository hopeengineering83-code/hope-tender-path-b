// A compliance matrix's status cell is not a heading.
//
// Read out of a DOCX, each table cell sits on its own line. A real package
// with three rows rated "PARTIALLY MET" failed the quality gate (score 63,
// DUPLICATED_SECTIONS: "Same heading appears ≥3 times: PARTIALLY MET"). A real
// heading repeated three times is still caught. Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

function duplicated(visibleText: string) {
  const result = assessGeneratedDocumentQuality({
    doc: { name: "Technical Proposal.docx", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" },
    visibleText,
    hasStoragePath: true,
  } as Parameters<typeof assessGeneratedDocumentQuality>[0]);
  return result.issues.find((i) => i.code === "DUPLICATED_SECTIONS") ?? null;
}

const rows = (status: string) => ["Annexes", status, "Section B", "CV Evidence", "Certificates", status, "Section D", "Licences", "Supporting documents", status, "Section A", "Records"].join("\n");

describe("a table status is not a heading", () => {
  it("repeated status cells do not fail the document", () => {
    assert.equal(duplicated(rows("PARTIALLY MET")), null);
    assert.equal(duplicated(rows("FULLY MET")), null);
  });

  it("a real heading repeated three times still does", () => {
    assert.ok(duplicated(["## TECHNICAL APPROACH", "Text.", "## TECHNICAL APPROACH", "Text.", "## TECHNICAL APPROACH", "Text."].join("\n")));
  });
});
