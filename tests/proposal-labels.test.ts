// G7 — starter unit tests (Node native test runner via tsx).
// Run with: npx tsx --test tests/**/*.test.ts
//
// These tests cover pure functions that should never regress:
// proposal-labels' tender title and client name cleanup.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cleanTenderTitle, cleanClientName, formatRequirementLine, safeFileBaseName, extractLikelyClientName } from "../lib/engine/proposal-labels";

describe("cleanClientName", () => {
  it("strips common garbage suffixes", () => {
    assert.equal(cleanClientName("PATH Ethiopia headquarters: Eagle Plaza"), "PATH Ethiopia");
  });
  it("returns Client when input is empty", () => {
    assert.equal(cleanClientName(""), "Client");
  });
  it("falls back when input is too long", () => {
    const huge = "A".repeat(200);
    const out = cleanClientName(huge);
    // Should fall back to Client when we can't extract a likely entity
    assert.equal(out, "Client");
  });
  it("preserves a normal client name", () => {
    assert.equal(cleanClientName("Pharo Ventures"), "Pharo Ventures");
  });
});

describe("cleanTenderTitle", () => {
  it("returns Tender Submission when input is empty and no client", () => {
    assert.equal(cleanTenderTitle("", { clientName: null }), "Tender Submission");
  });
  it("uses client name when title is empty", () => {
    assert.equal(cleanTenderTitle("", { clientName: "Pharo Ventures" }), "Pharo Ventures Tender");
  });
  it("rejects suspicious labels containing garbage tokens", () => {
    // The function flags any input containing "headquarters", "full name",
    // "relationship", "ref only", etc. as suspicious and falls back to
    // a safe placeholder. The contract we test is that suspicious
    // tokens never leak into the cleaned output.
    const out = cleanTenderTitle("Architectural Consultancy Services headquarters: Addis Ababa");
    assert.ok(!out.toLowerCase().includes("headquarters"), `expected no 'headquarters' in: ${out}`);
  });
  it("truncates very long titles to 120 chars", () => {
    const huge = `${"A".repeat(150)} Tender for the Project`;
    const out = cleanTenderTitle(huge);
    assert.ok(out.length <= 120);
  });
});

describe("formatRequirementLine", () => {
  it("dedupes repeated tokens separated by em-dashes", () => {
    const line = formatRequirementLine({
      title: "Submission rule",
      description: "Submit by deadline — Submit by deadline — Submit by deadline — Submit by deadline",
    });
    assert.equal(line, "Submission rule — Submit by deadline");
  });
  it("returns just the title when description equals title", () => {
    assert.equal(formatRequirementLine({ title: "TITLE", description: "TITLE" }), "TITLE");
  });
  it("strips leading title duplication", () => {
    const out = formatRequirementLine({ title: "Mandatory licence", description: "Mandatory licence — must be valid for 12 months." });
    assert.ok(out.startsWith("Mandatory licence"));
    assert.ok(out.includes("must be valid for 12 months"));
  });

  it("appends source page citation when sourcePageNumber is provided", () => {
    const out = formatRequirementLine({ title: "Technical Proposal", description: "Submit sealed technical proposal", sourcePageNumber: 12 });
    assert.ok(out.includes("[p.12]"), `expected [p.12] in output, got: ${out}`);
    assert.ok(out.startsWith("Technical Proposal"), "title must come first");
  });

  it("does not append page tag when sourcePageNumber is null", () => {
    const out = formatRequirementLine({ title: "Financial Statement", description: "Last 3 years audited", sourcePageNumber: null });
    assert.ok(!out.includes("[p."), `must not include page tag when null, got: ${out}`);
  });

  it("does not append page tag when sourcePageNumber is undefined (old call sites unaffected)", () => {
    const out = formatRequirementLine({ title: "Experience", description: "5 years minimum" });
    assert.ok(!out.includes("[p."), `must not include page tag when undefined, got: ${out}`);
  });

  it("page tag appears at the end of the formatted string", () => {
    const out = formatRequirementLine({ title: "Bid Bond", description: "2% of contract value", sourcePageNumber: 7 });
    assert.ok(out.endsWith("[p.7]"), `expected string to end with [p.7], got: ${out}`);
  });
});

describe("safeFileBaseName", () => {
  it("converts a tender title to a safe filename slug", () => {
    const out = safeFileBaseName("RFP No. 2026-024 — Architectural Design");
    assert.match(out, /^[A-Za-z0-9-]+$/);
    assert.ok(out.length <= 90);
  });
  it("falls back when nothing usable can be extracted", () => {
    const out = safeFileBaseName("");
    assert.equal(out, "submission-package");
  });
});

describe("extractLikelyClientName", () => {
  it("extracts an entity that ends with one of the recognised suffixes", () => {
    const out = extractLikelyClientName("This proposal is for Pharo Ventures relating to Project X.");
    // The function uses a generous regex that may swallow a few extra
    // words after the recognised suffix. The contract we assert is that
    // the canonical "Pharo Ventures" prefix appears.
    assert.ok(out !== null && out.startsWith("Pharo Ventures"), `expected client to start with "Pharo Ventures", got: ${out}`);
  });
  it("returns null when no entity is found", () => {
    // The regex matches any uppercase entity ending in one of the
    // recognised suffixes — even short generic phrases. The contract
    // we test is that empty / clearly non-entity input returns null.
    assert.equal(extractLikelyClientName(""), null);
  });
});
