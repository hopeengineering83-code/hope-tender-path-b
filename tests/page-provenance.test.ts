// Unit tests for lib/engine/page-provenance.ts
//
// The page-provenance guard uses TenderFile.totalPages as the authoritative
// page-count guard.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { computeProvenPageNumber } from "../lib/engine/page-provenance";

describe("computeProvenPageNumber — page-provenance guard", () => {
  it("form feeds establish a page number (page = formFeedCount + 1)", () => {
    const text = "page one content\fpage two content\fMinistry of Health";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 5), 3);
  });

  it("form feeds rejected when computed page > totalPages", () => {
    const text = "page one\fpage two\fpage three\fMinistry of Health";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 3), null);
  });

  it("[Page N] marker establishes the page number", () => {
    const text = "Some intro.\n[Page 2]\nMinistry of Water Resources";
    const idx = text.indexOf("Ministry of Water Resources");
    assert.equal(computeProvenPageNumber(text, idx, 3), 2);
  });

  it("[Page N] marker rejected when N > totalPages", () => {
    const text = "Intro.\n[Page 5]\nMinistry of Health";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 3), null);
  });

  it("'Page N' at line start establishes the page number", () => {
    const text = "Intro text.\nPage 2\nMinistry of Education";
    const idx = text.indexOf("Ministry of Education");
    assert.equal(computeProvenPageNumber(text, idx, 3), 2);
  });

  it("no boundary + totalPages=1 → page 1 (single-page exception)", () => {
    const text = "Boundaryless text with Ministry of Health somewhere in it.";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 1), 1);
  });

  it("no boundary + totalPages=3 → null (cannot prove page)", () => {
    const text = "Boundaryless text with Ministry of Health somewhere in it.";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 3), null);
  });

  it("no boundary + totalPages=null → null (unknown page count)", () => {
    const text = "Boundaryless text with Ministry of Health somewhere in it.";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, null), null);
  });

  it("no boundary + totalPages=0 → null (treat 0 as unknown)", () => {
    const text = "Boundaryless text with Ministry of Health somewhere in it.";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 0), null);
  });

  it("no boundary + totalPages=undefined → null", () => {
    const text = "Boundaryless text with Ministry of Health somewhere in it.";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, undefined), null);
  });

  it("form feeds take precedence over [Page N] markers", () => {
    const text = "[Page 5]\fMinistry of Health";
    const idx = text.indexOf("Ministry of Health");
    assert.equal(computeProvenPageNumber(text, idx, 5), 2);
  });

  it("negative matchIndex returns null", () => {
    assert.equal(computeProvenPageNumber("text", -1, 1), null);
  });

  it("matchIndex beyond text length returns null", () => {
    assert.equal(computeProvenPageNumber("short", 100, 1), null);
  });

  it("page 1 allowed when totalPages=1 and value is at the very start", () => {
    assert.equal(computeProvenPageNumber("Ministry of Health at the start.", 0, 1), 1);
  });

  it("page 1 NOT allowed when totalPages=2 and value is at the very start", () => {
    assert.equal(computeProvenPageNumber("Ministry of Health at the start.", 0, 2), null);
  });
});
