/**
 * "Has content" is not the same question as "has a storage path".
 *
 * Reproduced live on the same tender whose ZIP downloads (200, three DOCX).
 * GET /api/tenders/[id]/workflow-status answered BLOCKED with:
 *
 *   01-Expression-Of-Interest.docx: Generated document has no stored content
 *   02-Company-Profile.docx: Generated document has no stored content
 *   03-Capability-Statement.docx: Generated document has no stored content
 *
 * All three rows were, at that moment:
 *
 *   storagePath: null | contentByteLength: 17159 / 9752 / 9777
 *   integrityStatus: VERIFIED | contentSha256 present
 *
 * Content lives in one of two places: the fileContent column, or an external
 * object named by storagePath. Documents generated into the database have no
 * storagePath by design, so a check written as `!doc.storagePath` declares
 * every one of them contentless - including the three the ZIP was built from
 * seconds earlier.
 *
 * The route cannot load fileContent (multi-MB per document on a polling
 * surface), and it does not need to: contentByteLength is an integer column
 * that answers the question directly.
 *
 * The check is not removed. A GENERATED document with neither a storage path
 * nor any recorded bytes is still reported, which the second case pins.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const ROUTE = "app/api/tenders/[id]/workflow-status/route.ts";

/**
 * The route's rule, extracted so the behaviour is asserted rather than the
 * source text. Kept identical to the expression in the route.
 */
function reportsNoStoredContent(doc: {
  generationStatus: string;
  storagePath: string | null;
  contentByteLength: number | null;
}): boolean {
  const hasStoredBytes = (doc.contentByteLength ?? 0) > 0;
  return doc.generationStatus === "GENERATED" && !doc.storagePath && !hasStoredBytes;
}

describe("stored-content detection on the workflow-status route", () => {
  it("does not report a database-stored document as having no content", () => {
    // The exact live rows.
    const live = [
      { name: "01-Expression-Of-Interest.docx", generationStatus: "GENERATED", storagePath: null, contentByteLength: 17159 },
      { name: "02-Company-Profile.docx", generationStatus: "GENERATED", storagePath: null, contentByteLength: 9752 },
      { name: "03-Capability-Statement.docx", generationStatus: "GENERATED", storagePath: null, contentByteLength: 9777 },
    ];
    for (const doc of live) {
      assert.equal(
        reportsNoStoredContent(doc),
        false,
        `${doc.name} holds ${doc.contentByteLength} bytes and must not be called contentless`,
      );
    }
  });

  it("still reports a generated document that really has nothing behind it", () => {
    assert.equal(
      reportsNoStoredContent({ generationStatus: "GENERATED", storagePath: null, contentByteLength: null }),
      true,
      "no storage path and no recorded bytes is the case this check exists for",
    );
    assert.equal(
      reportsNoStoredContent({ generationStatus: "GENERATED", storagePath: null, contentByteLength: 0 }),
      true,
      "zero recorded bytes is equally empty",
    );
  });

  it("accepts either place content can live", () => {
    assert.equal(
      reportsNoStoredContent({ generationStatus: "GENERATED", storagePath: "tenders/x/01.docx", contentByteLength: null }),
      false,
      "an externally stored document has content even with no inline bytes",
    );
  });

  it("says nothing about documents that were never generated", () => {
    for (const status of ["PLANNED", "FAILED", "PENDING"]) {
      assert.equal(
        reportsNoStoredContent({ generationStatus: status, storagePath: null, contentByteLength: null }),
        false,
        `${status} is not a generated document missing its content`,
      );
    }
  });

  it("is the rule the route actually applies, on columns it actually selects", () => {
    const source = readFileSync(ROUTE, "utf8");
    assert.match(source, /contentByteLength:\s*true/, "the cheap column must be selected");
    assert.match(
      source,
      /!doc\.storagePath\s*&&\s*!hasStoredBytes/,
      "and both places content can live must be consulted",
    );
    assert.doesNotMatch(
      source,
      /fileContent:\s*true/,
      "without pulling the multi-MB blob onto a polling route",
    );
  });
});
