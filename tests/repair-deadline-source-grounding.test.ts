// Regression tests proving deadline repair cannot bypass source grounding.
// These tests verify the EXACT code structure — not source text, but the
// actual control flow by checking the route source for the required patterns.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routeSource = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

describe("Deadline repair cannot bypass source grounding", () => {
  it("CRITICAL_SOURCE_GROUNDED_FIELDS includes deadline", () => {
    assert.match(routeSource, /CRITICAL_SOURCE_GROUNDED_FIELDS[\s\S]*"deadline"/);
  });

  it("durable file ID resolution happens BEFORE the deadline type dispatch", () => {
    // The durableFileId resolution must come before `field === "deadline"`
    const durableIdx = routeSource.indexOf("durableFileId = extraction.sourceFile");
    const deadlineIdx = routeSource.indexOf('field === "deadline"');
    assert.ok(durableIdx > 0, "durableFileId resolution must exist");
    assert.ok(deadlineIdx > 0, "deadline dispatch must exist");
    assert.ok(durableIdx < deadlineIdx, "durableFileId must be resolved BEFORE deadline dispatch");
  });

  it("deadline branch does NOT skip to REPAIRED without source grounding", () => {
    // The deadline branch must be inside or after the CRITICAL_SOURCE_GROUNDED_FIELDS check
    const criticalCheckIdx = routeSource.indexOf("CRITICAL_SOURCE_GROUNDED_FIELDS.has(field)");
    const deadlineWriteIdx = routeSource.indexOf('(updates as Record<string, unknown>)[field] = dt');
    assert.ok(criticalCheckIdx > 0);
    assert.ok(deadlineWriteIdx > 0);
    assert.ok(criticalCheckIdx < deadlineWriteIdx, "critical source-grounded check must come before deadline write");
  });

  it("evidence persistence block checks durableFileId for deadline", () => {
    // The evidenceCols block must have deadline in sourceEvidenceColumns
    assert.match(routeSource, /deadline:\s*\{\s*fileId:\s*"deadlineSourceFileId"/);
    // And the persistence must check durableFileId
    assert.match(routeSource, /if \(evidenceCols && durableFileId\)/);
  });

  it("REPAIRED outcome for critical fields uses provenPage (not null)", () => {
    // The REPAIRED outcome uses `sourcePage: provenPage` — the extractor's
    // sourcePage, which is guarded by TenderFile.totalPages via computePageNumber.
    assert.match(routeSource, /sourcePage: provenPage/);
  });

  it("non-critical fields use sourcePage: null (evaluationMethodology)", () => {
    // evaluationMethodology is not a critical field — it uses sourcePage: null.
    assert.match(routeSource, /sourcePage: null, sourceQuote: extraction\.sourceQuote/);
  });
});

describe("Source grounding applies to all critical fields equally", () => {
  const criticalFields = [
    "clientName", "title", "deadline", "submissionMethod",
    "submissionAddress", "submissionEmails", "reference",
  ];

  for (const field of criticalFields) {
    it(`${field} is in CRITICAL_SOURCE_GROUNDED_FIELDS`, () => {
      assert.match(routeSource, new RegExp(`"${field}"`));
    });
  }

  it("all critical fields go through durableFileId resolution", () => {
    // The CRITICAL_SOURCE_GROUNDED_FIELDS.has(field) check must gate the
    // durableFileId resolution block
    assert.match(routeSource, /CRITICAL_SOURCE_GROUNDED_FIELDS\.has\(field\)/);
    assert.match(routeSource, /durableFileId = extraction\.sourceFile/);
  });

  it("all critical fields go through quote containment verification", () => {
    assert.match(routeSource, /verifySourceQuote/);
  });

  it("all critical fields go through active file ID check", () => {
    assert.match(routeSource, /activeFileIds\.has\(durableFileId\)/);
  });
});

describe("UNRESOLVED is returned (not REPAIRED) when source grounding fails", () => {
  it("UNRESOLVED when durableFileId is null", () => {
    assert.match(routeSource, /status: "UNRESOLVED"[\s\S]*Source file.*not an active tender file/);
  });

  it("UNRESOLVED when sourceQuote is missing or too short", () => {
    assert.match(routeSource, /status: "UNRESOLVED"[\s\S]*Source quote.*missing or too short/);
  });

  it("UNRESOLVED when quote is not contained in active file", () => {
    assert.match(routeSource, /status: "UNRESOLVED"[\s\S]*not contained in the referenced active tender file/);
  });

  it("UNRESOLVED outcomes do NOT write the scalar value", () => {
    // The UNRESOLVED pushes must have `continue` — no fall-through to updates
    const unresolvedBlocks = routeSource.match(/status: "UNRESOLVED"[\s\S]*?continue;/g);
    assert.ok(unresolvedBlocks && unresolvedBlocks.length >= 3, "Must have at least 3 UNRESOLVED continue blocks");
    // None of them should have `(updates as Record` between UNRESOLVED and continue
    for (const block of unresolvedBlocks) {
      assert.ok(!/\(updates as Record/.test(block), "UNRESOLVED block must NOT write to updates");
    }
  });
});
