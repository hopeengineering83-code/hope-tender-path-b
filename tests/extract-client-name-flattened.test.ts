// Regression test for client/procuring-entity extraction on flattened pages.
//
// Bug found via runtime verification: when a PDF page is extracted as a single
// line (pdf2json / pdfjs join a page's items with spaces, no newlines), the
// CLIENT_NAME_PATTERNS capture `([^\n\r]{3,120})` ran straight past the org
// name into the following labelled fields, e.g.:
//   "Nairobi Water and Sewerage Authority Reference: RFP-2026-014 Project: …"
// That contaminated value was then rejected downstream, leaving clientName
// null and blocking generation. The extractor now cuts the captured value at
// the first secondary field label.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractClientName } from "../lib/engine/tender-field-extractors";

function run(text: string) {
  return extractClientName({ files: [{ fileName: "rfp.pdf", extractedText: text }] } as never) as {
    found: boolean;
    value?: string;
  };
}

describe("extractClientName — flattened single-line page", () => {
  it("stops at the next field label (Reference / Project / Country)", () => {
    const text =
      "[Page 1] REQUEST FOR PROPOSAL Procuring Entity: Nairobi Water and Sewerage Authority " +
      "Reference: RFP-2026-014 Project: Construction Supervision Services for Bulk Water Supply " +
      "Country: Kenya. The procuring entity invites sealed proposals from qualified firms.";
    const r = run(text);
    assert.ok(r.found, "should extract a client name");
    assert.equal(r.value, "Nairobi Water and Sewerage Authority");
  });

  it("still works when the org name is the whole captured segment", () => {
    const text =
      "Contracting Authority: Ministry of Health and Sanitation\n" +
      "Section 1. Introduction and background to this procurement opportunity.";
    const r = run(text);
    assert.ok(r.found);
    assert.equal(r.value, "Ministry of Health and Sanitation");
  });

  it("does not over-trim a newline-terminated org name", () => {
    const text =
      "Client: Kenya Rural Roads Authority\n" +
      "Background and scope of the assignment are described in the sections below.";
    const r = run(text);
    assert.ok(r.found);
    assert.equal(r.value, "Kenya Rural Roads Authority");
  });
});
