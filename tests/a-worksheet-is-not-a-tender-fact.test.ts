// ─── A worksheet is not a Tender Fact ───────────────────────────────────────
//
// THE DEFECT, read from the exact-head Preview (tender d2b85e2a). Three facts
// blocked the ZIP, and nothing else did:
//
//   [BLOCKER] AUTHORITY_OR_QUALITY_BLOCKERS: Authority or document quality
//     blockers remain:
//     Field "Submission address":       Value contains extractor field-label
//       scaffolding or internal extraction instructions and must be
//       re-extracted as a single field value.
//     Field "Client address":           (same)
//     Field "Pre-bid meeting location": (same)
//
//   summary.documentBlockers=0   summary.tenderLevelBlockers=0
//   summary.qualityFailedDocuments=0
//   documents.generated (1): ["Technical Proposal.pdf"]
//   validate says: All canonical package and document validation checks passed.
//
// TWO PLACES THE GUARD WAS MISSING.
//
// 1. THE WRITE. Every extended client field was stored with nothing but
//    trim().slice(...), so the extractor's own worksheet went into the column
//    verbatim. containsMetadataScaffolding already existed and already ran --
//    but only at the READ side, in the canonical field resolver. The value was
//    stored, then refused, with nothing in between able to clear it.
//
// 2. THE CLEANUP. sanitize-stored-metadata.ts exists to "nullify any stored
//    tender metadata that fails the canonical validators" and imports that very
//    check -- for eight NAME-shaped fields. No address-shaped field was
//    covered, so the one repair path that could have cleared these three could
//    not see them.
//
// The result is generic, not particular to any tender: ANY tender whose
// extractor drops a multi-field worksheet into an address scalar is
// permanently export-blocked with no way back.
//
// WHY NULL IS THE RIGHT ANSWER. CLAUDE.md already specifies it -- a field that
// cannot be extracted is MISSING_SOURCE and requires manual confirmation, and
// placeholders must never be accepted as valid. Null is recoverable by
// confirmation; contaminated text is not, because it can never match its own
// source evidence.
//
// WHAT IS NOT CHANGED. The gate. A contaminated value that does reach storage
// still blocks final export exactly as before.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storedTenderFactOrNull } from "../lib/ai";
import {
  isContaminatedFreeText,
  computeStoredMetadataPatch,
  sanitizeStoredMetadataForEngine,
} from "../lib/engine/sanitize-stored-metadata";

// Two embedded field labels in one scalar -- the shape the live tender had.
const WORKSHEET = "Submission address: PO Box 1234, Capital City Submission method: Email";
const REAL_ADDRESS = "PO Box 1234, 5th Floor, Central Business District, Capital City";

describe("the write refuses to store a worksheet as a value", () => {
  it("stores a legitimate address unchanged", () => {
    assert.equal(storedTenderFactOrNull(REAL_ADDRESS, 500), REAL_ADDRESS);
  });

  it("refuses a multi-field extraction worksheet", () => {
    assert.equal(storedTenderFactOrNull(WORKSHEET, 500), null);
  });

  it("refuses a placeholder rather than storing it as data", () => {
    for (const placeholder of ["N/A", "TBD", "unknown", "Bid-Team to confirm", "not specified"]) {
      assert.equal(storedTenderFactOrNull(placeholder, 500), null, `${placeholder} was stored as a value`);
    }
  });

  it("still trims, caps and nulls empty input", () => {
    assert.equal(storedTenderFactOrNull("   ", 500), null);
    assert.equal(storedTenderFactOrNull(null, 500), null);
    assert.equal(storedTenderFactOrNull(42, 500), null);
    assert.equal(storedTenderFactOrNull("  " + REAL_ADDRESS + "  ", 500), REAL_ADDRESS);
    assert.equal(storedTenderFactOrNull("abcdefghij", 4), "abcd");
  });

  it("tolerates a single label, which a real endpoint can legitimately carry", () => {
    const single = "Portal: https://tenders.example.test/submit";
    assert.equal(storedTenderFactOrNull(single, 500), single);
  });
});

describe("the cleanup can see the fields that were blocking", () => {
  it("recognises contamination in free text", () => {
    assert.equal(isContaminatedFreeText(WORKSHEET), true);
    assert.equal(isContaminatedFreeText(REAL_ADDRESS), false);
    assert.equal(isContaminatedFreeText(null), false);
    assert.equal(isContaminatedFreeText(""), false);
  });

  it("patches exactly the three fields the live tender was blocked on", () => {
    const patch = computeStoredMetadataPatch({
      submissionAddress: WORKSHEET,
      clientAddress: WORKSHEET,
      preBidMeetingLocation: WORKSHEET,
    });
    assert.equal(patch.submissionAddress, null);
    assert.equal(patch.clientAddress, null);
    assert.equal(patch.preBidMeetingLocation, null);
  });

  it("leaves a clean address out of the patch entirely", () => {
    const patch = computeStoredMetadataPatch({ submissionAddress: REAL_ADDRESS, clientAddress: REAL_ADDRESS });
    assert.equal("submissionAddress" in patch, false);
    assert.equal("clientAddress" in patch, false);
  });

  it("nulls contamination and preserves clean values in the engine view", () => {
    const clean = sanitizeStoredMetadataForEngine({
      submissionAddress: WORKSHEET,
      clientAddress: REAL_ADDRESS,
      preBidMeetingLocation: WORKSHEET,
      clientCity: "Capital City",
    });
    assert.equal(clean.submissionAddress, null);
    assert.equal(clean.clientAddress, REAL_ADDRESS);
    assert.equal(clean.preBidMeetingLocation, null);
    assert.equal(clean.clientCity, "Capital City");
  });

  it("still cleans the name-shaped fields it always covered", () => {
    const patch = computeStoredMetadataPatch({ clientName: "Bid-Team to confirm" });
    assert.equal(patch.clientName, null);
  });
});

describe("the repair carries no tender, sector or benchmark knowledge", () => {
  it("names no sector, client or jurisdiction", () => {
    const SRC = readFileSync("lib/engine/sanitize-stored-metadata.ts", "utf8");
    const region = SRC.slice(SRC.indexOf("const ADDRESS_LIKE_FIELDS"));
    assert.equal(/pharo|ethiop|addis|healthcare|architect|consultanc/i.test(region), false);
  });
});
