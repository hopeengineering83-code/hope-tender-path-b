import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectMetadataContamination } from "../lib/engine/tender-metadata-completeness";
import { isClientNameContaminated } from "../lib/engine/metadata-validators";

/**
 * THE DEFECT, read off the live release snapshot for a real tender on
 * 2026-09-15T14:03:23Z.
 * ----------------------------------------------------------------------
 * The client / procuring entity came back as one run-on value carrying three of
 * its own field labels and a word truncated mid-token:
 *
 *   "<entity> Procuring Entity / Client Name: <entity> Legal Client Name:
 *    <entity> Project Name: <project…>"
 *
 * and the product reported it as:
 *
 *   status: "EXTRACTED_AND_GROUNDED", isValid: true, isGrounded: true,
 *   generationEligible: true, exportEligible: true, zipEligible: true
 *
 * Acceptance criterion 6 says the app must block generation when client details
 * are contaminated. It did not block anything.
 *
 * WHY — two detectors, and the gates read the weaker one.
 *
 *   metadata-validators.isClientNameContaminated       → contaminated
 *   tender-metadata-completeness.detectMetadataContamination → clean
 *
 * on the very same bytes. The first has recognised this shape for some time;
 * its own comment quotes it as observed live. But it is consulted only by
 * pre-generation-validation and a dashboard badge. Every gate that decides
 * generation, export and Final ZIP descends from Tender.metadataContaminated,
 * which canonical-analysis-update computes by OR-ing the SECOND detector across
 * seven entity fields — and that detector's pattern table knew only about
 * tender-portal scrape noise: status banners, breadcrumbs, nav links, date and
 * reference label bleed.
 *
 * Label bleed was already in that table. The enumeration simply stopped at
 * dates and reference numbers and never reached the entity-identity labels,
 * which bleed more often because they sit in the same structured table as the
 * value being extracted.
 *
 * THE FIX is not a second call site at each gate — that would leave the split
 * brain in place for the next field. The vocabulary is declared once and
 * imported, so the canonical detector every gate already consults gains what
 * the client-name detector always knew.
 */

/** The live value, with the tender's own identifiers replaced. */
const OBSERVED_SHAPE =
  "Northwind Authority Procuring Entity / Client Name: Northwind Authority "
  + "Legal Client Name: Northwind Authority Project Name: Riverside Spec";

describe("one contamination authority, not two", () => {
  it("the canonical detector flags the shape that reached generation as eligible", () => {
    const r = detectMetadataContamination(OBSERVED_SHAPE);
    assert.equal(r.contaminated, true);
    assert.equal(r.signal, "EMBEDDED_FIELD_LABEL_BLEED");
  });

  it("both detectors now agree on the same bytes", () => {
    // Disagreement is the defect itself: whichever one a gate happened to call
    // decided whether a contaminated client name could reach a client's PDF.
    assert.equal(isClientNameContaminated(OBSERVED_SHAPE), true);
    assert.equal(detectMetadataContamination(OBSERVED_SHAPE).contaminated, true);
  });

  it("a single embedded label is enough — concatenation does not need to repeat", () => {
    for (const value of [
      "Contact Person: Ms A. Uwase",
      "Client Name: Riverside Municipal Council",
      "Project Name: Coastal Water Supply Phase II",
    ]) {
      assert.equal(
        detectMetadataContamination(value).contaminated,
        true,
        `"${value}" carries the name of a field and must not pass as a value`,
      );
    }
  });

  it("applies to every entity field the table serves, not to client name alone", () => {
    // canonical-analysis-update ORs this detector across clientName,
    // legalClientName, donorAgency, implementingAgency, clientAddress,
    // submissionAddress and clientContactName. An address that carries
    // "Contact Person:" has conflated two fields the schema keeps apart.
    const address = "Client Address: P.O. Box 9, Kigali Contact Person: Ms A. Uwase";
    assert.equal(detectMetadataContamination(address).contaminated, true);
  });

  it("does not flag legitimate entity names, in any country", () => {
    for (const value of [
      "Procurement and Tender Authority of Ethiopia",
      "Kenya Rural Roads Authority",
      "Ministry of Health & Tender Division",
      "Riverside Municipal Council",
      "National Water and Sewerage Corporation",
    ]) {
      assert.equal(
        detectMetadataContamination(value).contaminated,
        false,
        `"${value}" is a legitimate entity name and must not be flagged`,
      );
    }
  });

  it("does not flag legitimate addresses or prose that merely contain a colon", () => {
    for (const value of [
      "P.O. Box 1234, Nairobi, Kenya",
      "Submission deadline extended to 15 October 2026 by official notice.",
      "The Evaluation Methodology requires Technical and Financial proposals scored 70/30. "
        + "Methodology and approach: 25 marks. Key Personnel: 30 marks.",
    ]) {
      assert.equal(
        detectMetadataContamination(value).contaminated,
        false,
        `"${value.slice(0, 40)}…" must not be flagged`,
      );
    }
  });

  it("the vocabulary has one home and is imported, not restated", () => {
    const completeness = readFileSync("lib/engine/tender-metadata-completeness.ts", "utf8");
    assert.match(
      completeness,
      /import \{ EMBEDDED_FIELD_LABEL \} from "\.\/metadata-validators"/,
      "the label vocabulary must be imported from its single declaration",
    );
    // A second copy of the pattern here is exactly how the two authorities
    // drifted apart in the first place.
    assert.doesNotMatch(
      completeness,
      /legal\\s\+client/,
      "the pattern must not be re-declared in the consumer",
    );
  });

  it("carries no client-specific, sector-specific or country-specific special case", () => {
    const completeness = readFileSync("lib/engine/tender-metadata-completeness.ts", "utf8");
    const region = completeness.slice(
      completeness.indexOf("METADATA_CONTAMINATION_PATTERNS"),
      completeness.indexOf("export function detectMetadataContamination"),
    );
    assert.doesNotMatch(region, /pharo/i);
    assert.doesNotMatch(region, /ethiopia/i);
    assert.doesNotMatch(region, /hospital|healthcare/i);
  });
});
