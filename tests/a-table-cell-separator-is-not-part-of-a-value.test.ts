// A Word or PDF table is extracted as "Row N: label | value | label | value".
// The title rule read "Project Title" followed by an optional colon, so the
// value it captured from a table row began with the cell separator: the Pharo
// tender uploaded on 2026-10-08 was titled "| Architectural Consultancy …".
// A longer row would also have carried the next cell's label and value.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";

// The extractor does not trust a document shorter than 500 characters.
const BODY = "\nThe consultant shall prepare concept design, detailed design and tender documents, and supervise construction. ".repeat(6);

describe("a table cell separator is not part of a labelled value", () => {
  it("reads the title from a two-cell table row without the separator", () => {
    const text = [
      "[Page 1]",
      "Row 1: Project Title | Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
      "Row 2: Client | Pharo Ventures",
    ].join("\n") + BODY;
    const meta = inferTenderMetadata(text, "pharo tender document.docx");
    assert.equal(meta.title, "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center");
  });

  it("stops at the next cell of a wider row", () => {
    const text = "[Page 1]\nRow 1: Project Title | Design of the Regional Water Supply Scheme | Reference | RFP-2026-031\n" + BODY;
    const meta = inferTenderMetadata(text, "tor.docx");
    assert.equal(meta.title, "Design of the Regional Water Supply Scheme");
  });

  it("still reads an ordinary 'Label: value' line unchanged", () => {
    const text = "[Page 1]\nProject Title: Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center\n" + BODY;
    const meta = inferTenderMetadata(text, "tor.pdf");
    assert.equal(meta.title, "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center");
  });
});
