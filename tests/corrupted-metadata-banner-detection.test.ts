// Tests for the banner's detection logic — the SAME validator chain
// used by lib/engine/tender-metadata.ts and the re-extract route.
// Pin the four production-screenshot corruptions as detected.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
} from "../lib/engine/metadata-validators";

// Mirror the badFieldsFor helper from the banner component so we can
// test the rule without spinning up React.
type TenderShape = {
  reference: string | null;
  clientName: string | null;
  country: string | null;
  clientContactName: string | null;
};
function badFieldsFor(t: TenderShape): string[] {
  const bad: string[] = [];
  if (t.reference && t.reference.trim() && !isValidReferenceNumber(t.reference)) bad.push("reference");
  if (t.clientName && t.clientName.trim() && !isValidClientName(t.clientName)) bad.push("clientName");
  if (t.country && t.country.trim() && !isValidCountry(t.country)) bad.push("country");
  if (t.clientContactName && t.clientContactName.trim() && !isValidClientContact(t.clientContactName)) bad.push("clientContactName");
  return bad;
}

describe("corrupted-metadata banner — detection of stored corruption", () => {
  it("detects all four production-screenshot corruptions at once", () => {
    const bad = badFieldsFor({
      reference: "only",
      clientName: "references (where available) Photos or drawings of completed projects C. Technical Approach",
      country: "A ddis Ababa",
      clientContactName: "s Contact Person",
    });
    assert.deepEqual(bad.sort(), ["clientContactName", "clientName", "country", "reference"]);
  });

  it("returns empty list when ALL fields are valid (banner won't render)", () => {
    const bad = badFieldsFor({
      reference: "RFP-2026-024",
      clientName: "Pharo Ventures",
      country: "Ethiopia",
      clientContactName: "Esayas Dessalegn",
    });
    assert.deepEqual(bad, []);
  });

  it("returns empty list when fields are NULL or empty (banner won't render for unset tenders)", () => {
    assert.deepEqual(badFieldsFor({ reference: null, clientName: null, country: null, clientContactName: null }), []);
    assert.deepEqual(badFieldsFor({ reference: "", clientName: "  ", country: null, clientContactName: "" }), []);
  });

  it("detects only the invalid fields, leaves valid ones alone", () => {
    const bad = badFieldsFor({
      reference: "RFP-2026-024",                  // valid
      clientName: "TOC section fragment etc",     // not necessarily invalid — check via validator
      country: "A ddis Ababa",                    // INVALID
      clientContactName: "Jane Doe",              // valid
    });
    // reference is valid → not flagged
    assert.ok(!bad.includes("reference"));
    // country is invalid → flagged
    assert.ok(bad.includes("country"));
    // clientContactName valid → not flagged
    assert.ok(!bad.includes("clientContactName"));
  });

  it("ignores fields that contain whitespace-only values", () => {
    const bad = badFieldsFor({
      reference: "   ",
      clientName: null,
      country: "",
      clientContactName: "\t\n",
    });
    assert.deepEqual(bad, []);
  });
});
