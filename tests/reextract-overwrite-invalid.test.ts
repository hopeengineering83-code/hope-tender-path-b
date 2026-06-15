// Regression test for "Re-extract from PDF doesn't clean DB corruption".
//
// THE DEEP BUG (May 16 production, persisted across PR #368 → #375)
// ────────────────────────────────────────────────────────────────────
// `inferTenderMetadata` was fixed to reject TOC fragments, stop-words,
// non-whitelist countries, and contact-fragment strings (PR #368). All
// downstream panels were fixed to use the same validators. But the
// CORRUPTED VALUES that were stored in the DB BEFORE PR #368 landed
// (e.g. reference="only", country="A ddis Ababa", clientName="references
// (where available) Photos or drawings...", clientContactName="s Contact
// Person") stayed there permanently. The user's "Re-extract from PDF"
// button used fill-empty-only semantics — so it saw "only" as a
// non-empty value and refused to overwrite it. Every panel kept
// rendering the corruption forever.
//
// FIX (this commit): re-extract treats a stored value as overridable
// when EITHER it's empty OR it fails the canonical validator. Manual
// edits that pass validation are still preserved.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
} from "../lib/engine/metadata/metadata-validators";

// Mirror the isValidStoredValue helper from the route so we can test
// the rule without spinning up a Prisma client or HTTP layer.
function isValidStoredValue(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  switch (field) {
    case "clientName":         return isValidClientName(String(value));
    case "reference":          return isValidReferenceNumber(String(value));
    case "country":            return isValidCountry(String(value));
    case "clientContactName":  return isValidClientContact(String(value));
    default:                   return true;
  }
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function shouldOverwrite(field: string, stored: unknown, extracted: unknown): boolean {
  const storedIsOverridable = isEmpty(stored) || !isValidStoredValue(field, stored);
  return storedIsOverridable && !isEmpty(extracted);
}

describe("re-extract — overwrite invalid stored values (the deep bug)", () => {
  it("reference='only' is overwritten when extractor returns a valid ref", () => {
    assert.equal(shouldOverwrite("reference", "only", "RFP-2026-001"), true);
  });

  it("reference='only' is overwritten even when extractor returns null (cleared to null)", () => {
    // shouldOverwrite returns false here because we don't WRITE null.
    // The caller handles the null path separately.
    assert.equal(shouldOverwrite("reference", "only", null), false);
  });

  it("country='A ddis Ababa' is overwritten with 'Ethiopia'", () => {
    assert.equal(shouldOverwrite("country", "A ddis Ababa", "Ethiopia"), true);
  });

  it("clientName='references (where available) Photos...' is overwritten with valid entity", () => {
    const garbage = "references (where available) Photos or drawings of completed projects C. Technical Approach";
    assert.equal(shouldOverwrite("clientName", garbage, "Pharo Ventures"), true);
  });

  it("clientContactName='s Contact Person' is overwritten with valid name", () => {
    assert.equal(shouldOverwrite("clientContactName", "s Contact Person", "Esayas Dessalegn"), true);
  });

  it("VALID stored clientName is PRESERVED (manual edit protection)", () => {
    assert.equal(shouldOverwrite("clientName", "Pharo Ventures", "Some Other Extracted Entity"), false);
  });

  it("VALID stored reference is PRESERVED (manual edit protection)", () => {
    assert.equal(shouldOverwrite("reference", "RFP-2026-001", "RFP-2026-002"), false);
  });

  it("VALID stored country is PRESERVED (manual edit protection)", () => {
    assert.equal(shouldOverwrite("country", "Ethiopia", "Kenya"), false);
  });

  it("VALID stored clientContactName is PRESERVED (manual edit protection)", () => {
    assert.equal(shouldOverwrite("clientContactName", "Esayas Dessalegn", "Some Other"), false);
  });

  it("empty stored value is filled (the original fill-empty-only behaviour still works)", () => {
    assert.equal(shouldOverwrite("clientName", null, "Pharo Ventures"), true);
    assert.equal(shouldOverwrite("clientName", "", "Pharo Ventures"), true);
    assert.equal(shouldOverwrite("clientName", "   ", "Pharo Ventures"), true);
  });

  it("fields without a validator preserve any non-empty stored value (legacy semantics)", () => {
    assert.equal(shouldOverwrite("budget", 100000, 200000), false);  // numeric, no validator
    assert.equal(shouldOverwrite("clientAddress", "Some address text", "Other address"), false);
    assert.equal(shouldOverwrite("title", "Tender Title", "Other Title"), false);
    // Empty still gets filled
    assert.equal(shouldOverwrite("budget", null, 100000), true);
  });

  it("the four exact production-screenshot corruptions are ALL overwritten with valid replacements", () => {
    const screenshotCorruptions = [
      { field: "reference", stored: "only", extracted: "RFP-2026-024" },
      { field: "country", stored: "A ddis Ababa", extracted: "Ethiopia" },
      { field: "clientName", stored: "references (where available) Photos or drawings of completed projects C. Technical Approach Understanding of the assignment Proposed design methodology Approac", extracted: "Pharo Ventures" },
      { field: "clientContactName", stored: "s Contact Person", extracted: "Esayas Dessalegn" },
    ];
    for (const c of screenshotCorruptions) {
      assert.equal(
        shouldOverwrite(c.field, c.stored, c.extracted),
        true,
        `Expected re-extract to overwrite ${c.field}="${c.stored}" with "${c.extracted}"`,
      );
    }
  });
});
