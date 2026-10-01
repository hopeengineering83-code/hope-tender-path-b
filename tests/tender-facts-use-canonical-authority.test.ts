/**
 * The proposal writer must not lose facts the analysis already grounded.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * On a real owner run, AI Analyze correctly extracted the client, the
 * submission deadline (2026-08-25), the submission method and the
 * technical-only instruction, and persisted them as canonical. The proposal
 * writer then logged:
 *
 *   Tender facts extracted: 3 RFP ID(s), 0 deadline(s),
 *   0 deliverable code(s), 0 quantity(s)
 *
 * Zero deadlines — for a tender whose deadline was known and source-grounded.
 * The writer called extractTenderFacts() on raw tender text and consulted
 * nothing else, so a deadline written in a format DEADLINE_PATTERNS does not
 * match was simply dropped, and the proposal could not echo the single date an
 * evaluator most expects to see.
 *
 * The fix passes the already-resolved canonical facts IN rather than creating
 * a second fact authority. These tests pin that contract: canonical facts
 * survive, regex still supplements, and neither one fabricates.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extractTenderFacts } from "../lib/engine/tender-facts-extractor";

// Long enough to clear the extractor's minimum-length guard, and deliberately
// written WITHOUT a machine-parseable deadline — this is the real situation.
const TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE = `
Request for Proposals for consultancy services. The assignment covers design
and supervision of healthcare facilities. Bidders shall submit a technical
proposal only; the financial proposal is excluded from this submission.
Proposals must be delivered on the twenty-fifth day of August in the year two
thousand and twenty-six, which is stated in words rather than in digits.
The scope includes 3 private offices and 25 workstations for the facility.
`.repeat(3);

describe("canonical facts reach the proposal", () => {
  it("keeps a canonical deadline the text patterns cannot parse", () => {
    // The exact failure from the real run: regex finds nothing, canonical
    // knows the answer, and the answer must survive.
    const withoutCanonical = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE);
    assert.equal(withoutCanonical.deadlines.length, 0, "precondition: the text alone yields no deadline");

    const withCanonical = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {
      deadlineDisplay: "2026-08-25",
    });
    assert.deepEqual(withCanonical.deadlines, ["2026-08-25"]);
  });

  it("leads with the canonical reference rather than a regex guess", () => {
    const facts = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {
      referenceNumber: "PHARO/RFP/2026/014",
    });
    assert.equal(facts.rfpIds[0], "PHARO/RFP/2026/014");
  });

  it("counts canonical facts, so the writer's own log stops reading zero", () => {
    const facts = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {
      deadlineDisplay: "2026-08-25",
      referenceNumber: "PHARO/RFP/2026/014",
    });
    assert.ok(facts.rawCount > 0);
    assert.ok(facts.deadlines.length > 0 && facts.rfpIds.length > 0);
  });
});

describe("the regex extractor still does the work canonical does not cover", () => {
  it("keeps extracting quantities, which the canonical record does not carry", () => {
    const facts = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {
      deadlineDisplay: "2026-08-25",
    });
    assert.ok(facts.quantities.length > 0, "canonical seeding must not suppress regex classes");
  });

  it("does not duplicate a fact both sources found", () => {
    const text = `Tender Ref ABC/123/2026 for consultancy services. ${TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE}`;
    const facts = extractTenderFacts(text, { referenceNumber: "ABC/123/2026" });
    const occurrences = facts.rfpIds.filter((id) => id === "ABC/123/2026").length;
    assert.equal(occurrences, 1, "the same reference must not appear twice");
  });
});

describe("nothing is invented", () => {
  it("does not turn flattened table labels and filenames into references or locations", () => {
    const flattened = (`Tender Reference: document.docx Type Row\nTender Reference: METADATA, Title, Issuing\nTender Reference: Status, issued, references\n` +
      `Location: Addis Ababa Submission Method: Email Submission Address: No portal\n`).repeat(8);
    const facts = extractTenderFacts(flattened);
    assert.ok(!facts.rfpIds.some((value) => /document\.docx|^type$|^row$|metadata|issuing|status|references/i.test(value)));
    assert.deepEqual(facts.locations, ["Addis Ababa"]);
    assert.ok(facts.locations.every((value) => !/Submission|Portal|Method/i.test(value)));
  });

  it("adds no deadline when neither source has one", () => {
    const facts = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {});
    assert.equal(facts.deadlines.length, 0);
  });

  it("ignores blank canonical values rather than emitting empty facts", () => {
    // A blank column must not become a fact that reads as an answer.
    const facts = extractTenderFacts(TENDER_TEXT_WITHOUT_PARSEABLE_DEADLINE, {
      deadlineDisplay: "   ",
      referenceNumber: null,
    });
    assert.equal(facts.deadlines.length, 0);
    assert.equal(facts.rfpIds.filter((id) => !id.trim()).length, 0);
  });

  it("still returns canonical facts when the tender text is too short to scan", () => {
    // The short-text guard used to return an all-empty result. A canonical
    // fact is true regardless of how much text was extracted.
    const facts = extractTenderFacts("too short", { deadlineDisplay: "2026-08-25" });
    assert.deepEqual(facts.deadlines, ["2026-08-25"]);
  });
});
