// Regression tests for the canonical metadata validators.
//
// These tests use the EXACT corrupted values observed in production
// screenshots so a future change can't silently regress the gate.
//   • clientName  = "references (where available) Photos or drawings..."
//   • reference   = "only"
//   • country     = "A ddis Ababa"
//   • contact     = "s Contact Person"

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  getClientNameStatus,
  isValidClientName,
  isPlaceholderClientName,
  isGarbageClientName,
  clientNameDisplayMessage,
  isValidReferenceNumber,
  isValidCountry,
  canonicalizeCountry,
  isValidClientContact,
  containsMetadataPlaceholder,
} from "../lib/engine/metadata-validators";

describe("metadata-validators — client name", () => {
  it("flags the corrupted TOC fragment as GARBAGE", () => {
    const garbage = "references (where available) Photos or drawings of completed projects C. Technical Approach Understanding of the assignment Proposed design methodology Approac";
    assert.equal(getClientNameStatus(garbage), "GARBAGE");
    assert.equal(isValidClientName(garbage), false);
    assert.equal(isGarbageClientName(garbage), true);
  });

  it("flags placeholder values as PLACEHOLDER, not GARBAGE", () => {
    assert.equal(getClientNameStatus("The Client"), "PLACEHOLDER");
    assert.equal(getClientNameStatus("Unknown"), "PLACEHOLDER");
    assert.equal(getClientNameStatus("N/A"), "PLACEHOLDER");
    assert.equal(getClientNameStatus("TBD"), "PLACEHOLDER");
    assert.equal(isPlaceholderClientName("The Client"), true);
  });

  it("flags empty / whitespace-only as EMPTY", () => {
    assert.equal(getClientNameStatus(null), "EMPTY");
    assert.equal(getClientNameStatus(""), "EMPTY");
    assert.equal(getClientNameStatus("   "), "EMPTY");
  });

  it("accepts real procuring entities", () => {
    assert.equal(isValidClientName("Pharo Ventures"), true);
    assert.equal(isValidClientName("Ethiopian Heritage Trust"), true);
    assert.equal(isValidClientName("Ministry of Health, Federal Democratic Republic of Ethiopia"), true);
    assert.equal(isValidClientName("AAWSA - Addis Ababa Water and Sewerage Authority"), true);
    assert.equal(isValidClientName("Pharo Foundation"), true);
  });

  it("rejects extraction noise that mentions proposal section headers", () => {
    // The original PROPOSAL_SECTION_NOISE pattern in tender-metadata.ts
    // didn't include "references" or "photos" — those keywords appear
    // in TOC entries and would slip through. Confirm they're rejected here.
    assert.equal(isValidClientName("Section A Company Profile"), false);
    assert.equal(isValidClientName("Technical Approach Methodology"), false);
    assert.equal(isValidClientName("Photos and drawings of completed projects"), false);
    assert.equal(isValidClientName("References, where available"), false);
    assert.equal(isValidClientName("Table of contents"), false);
    assert.equal(isValidClientName("Understanding of the assignment"), false);
  });

  it("clientNameDisplayMessage routes UI text correctly", () => {
    const garbage = clientNameDisplayMessage("references (where available) Photos...");
    assert.equal(garbage.status, "GARBAGE");
    assert.match(garbage.text, /Invalid client name extracted/i);

    const empty = clientNameDisplayMessage(null);
    assert.equal(empty.status, "EMPTY");
    assert.match(empty.text, /not set/i);

    const valid = clientNameDisplayMessage("Pharo Ventures");
    assert.equal(valid.status, "VALID");
    assert.equal(valid.text, "Pharo Ventures");
  });
});

describe("metadata-validators — reference number", () => {
  it("rejects the literal 'only' regression case", () => {
    assert.equal(isValidReferenceNumber("only"), false);
  });

  it("rejects stop-words and stop-phrases without digits", () => {
    assert.equal(isValidReferenceNumber("none"), false);
    assert.equal(isValidReferenceNumber("see above"), false);
    assert.equal(isValidReferenceNumber("N/A"), false);
    assert.equal(isValidReferenceNumber("TBD"), false);
    assert.equal(isValidReferenceNumber("the"), false);
  });

  it("accepts letter-only references (digit requirement removed per mission spec)", () => {
    // The mission explicitly says: "Remove the rule requiring every valid
    // reference number to contain a digit." Letter-only references like
    // "RFP/CONSULTANCY", "PHARO-RFP", "AA/PROC/ARCH" are valid.
    assert.equal(isValidReferenceNumber("RFP"), true);
    assert.equal(isValidReferenceNumber("PROCUREMENT"), true);
    assert.equal(isValidReferenceNumber("RFP/CONSULTANCY"), true);
    assert.equal(isValidReferenceNumber("PHARO-RFP"), true);
    assert.equal(isValidReferenceNumber("AA/PROC/ARCH"), true);
  });

  it("accepts real tender reference numbers", () => {
    assert.equal(isValidReferenceNumber("RFP-2026-001"), true);
    assert.equal(isValidReferenceNumber("EOI/2026/04"), true);
    assert.equal(isValidReferenceNumber("AAWSA/CONS/2026"), true);
    assert.equal(isValidReferenceNumber("2026-024"), true);
    assert.equal(isValidReferenceNumber("ICB-WB-2026-15"), true);
  });
});

describe("metadata-validators — country", () => {
  it("rejects the 'A ddis Ababa' OCR fragment as a country", () => {
    assert.equal(isValidCountry("A ddis Ababa"), false);
    assert.equal(isValidCountry("Addis Ababa"), false); // city, not a country
  });

  it("accepts known countries from the whitelist", () => {
    assert.equal(isValidCountry("Ethiopia"), true);
    assert.equal(isValidCountry("Kenya"), true);
    assert.equal(isValidCountry("Nigeria"), true);
    assert.equal(isValidCountry("United States"), true);
  });

  it("accepts substrings that contain a known country", () => {
    assert.equal(isValidCountry("Addis Ababa, Ethiopia"), true);
    assert.equal(isValidCountry("Located in Kenya, East Africa"), true);
  });

  it("canonicalizeCountry returns the country name when present", () => {
    assert.equal(canonicalizeCountry("Addis Ababa, Ethiopia"), "Ethiopia");
    assert.equal(canonicalizeCountry("Nairobi, Kenya"), "Kenya");
    assert.equal(canonicalizeCountry("A ddis Ababa"), null);
    assert.equal(canonicalizeCountry(null), null);
  });
});

describe("metadata-validators — client contact", () => {
  it("rejects the 's Contact Person' regression fragment", () => {
    assert.equal(isValidClientContact("s Contact Person"), false);
  });

  it("rejects bare role labels", () => {
    assert.equal(isValidClientContact("Contact Person"), false);
    assert.equal(isValidClientContact("Procurement Officer"), false);
    assert.equal(isValidClientContact("Focal Person"), false);
  });

  it("rejects fragments that start with noise tokens", () => {
    assert.equal(isValidClientContact("the procurement officer"), false);
    assert.equal(isValidClientContact("a Contact"), false);
  });

  it("accepts two-token proper names", () => {
    assert.equal(isValidClientContact("Jane Doe"), true);
    assert.equal(isValidClientContact("Hassan Otieno"), true);
    assert.equal(isValidClientContact("Esayas Dessalegn"), true);
  });

  it("accepts names with a recognised title prefix", () => {
    assert.equal(isValidClientContact("Dr. Hassan"), true);
    assert.equal(isValidClientContact("Eng. Otieno"), true);
    assert.equal(isValidClientContact("Mr. Smith"), true);
  });
});

describe("metadata-validators — placeholders anywhere", () => {
  it("rejects all production placeholder terms", () => {
    for (const value of ["Bid-Team to confirm", "TBD", "TBC", "TBA", "N/A", "unknown", "not specified", "pending", "blank"]) {
      assert.equal(containsMetadataPlaceholder(value), true, `${value} should be treated as placeholder`);
      assert.equal(isValidClientName(value), false, `${value} should not be a valid client name`);
    }
  });
});
