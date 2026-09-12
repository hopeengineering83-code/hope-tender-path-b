import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deduplicateTables } from "../lib/engine/advanced-quality-passes";

/**
 * THE DEFECT, found in a delivered proposal rather than in a test.
 * ---------------------------------------------------------------
 * Section B of the proposal for an Addis Ababa hospital tender named three
 * project references — two Ethiopian hospitals and one Nigerian project — and
 * carded exactly one: the Nigerian one, which was simply the last written.
 *
 * Every Section B project card is a two-column metadata table headed
 * `| Field | Detail |`. The table de-duplicator keyed on the HEADER ROW alone,
 * so all three cards hashed to one key and it deleted all but the last as
 * duplicates. The two most relevant pieces of evidence in the document were
 * removed by a cleanup pass, and no gate could see it: the surviving card is
 * well-formed, so readiness passed, the audit scored the document and the ZIP
 * hashes matched.
 *
 * A table's identity is its content. Two tables that share a header and differ
 * in their rows are different evidence. The pass still removes what it was
 * written for — a repeated section emitting the same table twice — because
 * those are identical all the way down.
 */

const card = (name: string, client: string, location: string, value: string) =>
  [
    `### ${name}`,
    "",
    "| Field | Detail |",
    "|---|---|",
    `| Client | ${client} |`,
    `| Location & Scale | ${location} |`,
    `| Contract Value | ${value} |`,
    "",
  ].join("\n");

describe("a cleanup pass must not delete distinct evidence", () => {
  it("keeps every project card that says something different", () => {
    const markdown = [
      "## SECTION B: RELEVANT EXPERIENCE",
      "",
      card("G+6 General Hospital", "Dr Abdul Seid", "Addis Ababa, Ethiopia — 7,000 m²", "ETB 550.1M"),
      card("Dessie Specialized Hospital", "Amhara Health Bureau", "Dessie, Ethiopia — 2,800 m²", "ETB 125.0M"),
      card("Hospital Project", "City Administration of Abuja", "Nigeria — 7,500 m²", "NGN 1200.0M"),
    ].join("\n");

    const result = deduplicateTables(markdown);

    assert.equal(result.removed, 0, "three different cards are three pieces of evidence");
    for (const name of ["G+6 General Hospital", "Dessie Specialized Hospital", "Hospital Project"]) {
      assert.ok(result.markdown.includes(name), `${name} must survive`);
    }
    for (const evidence of ["Dr Abdul Seid", "Amhara Health Bureau", "City Administration of Abuja"]) {
      assert.ok(result.markdown.includes(evidence), `${evidence} must survive`);
    }
    for (const value of ["ETB 550.1M", "ETB 125.0M", "NGN 1200.0M"]) {
      assert.ok(result.markdown.includes(value), `${value} must survive`);
    }
  });

  it("still removes a table a repeated section emitted twice", () => {
    const repeated = card("G+6 General Hospital", "Dr Abdul Seid", "Addis Ababa, Ethiopia", "ETB 550.1M");
    const markdown = ["## SECTION B", "", repeated, repeated].join("\n");

    const result = deduplicateTables(markdown);

    assert.ok(result.removed > 0, "an identical table is still a duplicate");
    const occurrences = result.markdown.split("| Client | Dr Abdul Seid |").length - 1;
    assert.equal(occurrences, 1, "exactly one copy survives");
  });

  it("treats a difference in any cell as a difference in evidence", () => {
    // The cards differ only in the value. Under a header-only key they were
    // indistinguishable; the one that survived was decided by document order.
    const markdown = [
      card("Project A", "Client One", "Kenya", "KES 890.0M"),
      card("Project B", "Client One", "Kenya", "KES 120.0M"),
    ].join("\n");

    const result = deduplicateTables(markdown);
    assert.equal(result.removed, 0);
    assert.ok(result.markdown.includes("KES 890.0M"));
    assert.ok(result.markdown.includes("KES 120.0M"));
  });

  it("ignores formatting differences that carry no meaning", () => {
    // Bold markers, casing and whitespace are presentation, not content: a
    // table repeated with cosmetic differences is still a repeat.
    const one = ["| Field | Detail |", "|---|---|", "| Client | Ministry of Health |", ""].join("\n");
    const two = ["| **Field** | Detail |", "| --- | --- |", "|  client  |  Ministry  of  Health  |", ""].join("\n");
    const result = deduplicateTables([one, two].join("\n"));
    assert.ok(result.removed > 0, "cosmetic differences must not defeat de-duplication");
  });

  it("leaves a document with no duplicate tables exactly as it was", () => {
    const markdown = [
      "| Stage | Milestone |",
      "|---|---|",
      "| Stage 1 | 30% Schematic Design |",
      "",
      "| Expert | Role |",
      "|---|---|",
      "| A. Mohammed | Resident Engineer |",
      "",
    ].join("\n");
    const result = deduplicateTables(markdown);
    assert.equal(result.removed, 0);
    assert.equal(result.markdown, markdown);
  });
});
