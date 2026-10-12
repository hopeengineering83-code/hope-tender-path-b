// Partial source verification must not cost the staleness guarantee.
//
// Verification used to require every field on the record to be found in the
// source text, and the read-side check enforced that by comparing counts:
//
//     if (currentFields.length !== provenance.evidence.length) return false;
//
// That count was doing two jobs. It rejected partially-verified records on
// read — the real bug — and it also caught fields that APPEARED after
// verification. Removing it fixed the first and silently dropped the second,
// so a SOURCE_VERIFIED expert could gain a certification nobody verified and
// stay verified. Because these gates return one verdict for the whole record,
// that claim then rides along into matching scores and generated client
// documents.
//
// The fix records which fields were present-but-unproven at verification time.
// On read a field must be one of: verified with a matching value, or recorded
// as unproven. Anything else appeared afterwards.
//
// Both halves are pinned here, because each is a regression the other's fix
// can reintroduce.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import {
  buildPartialSourceVerificationProvenance,
  buildSourceVerificationProvenance,
  expertReviewFields,
  isDurablySourceVerified,
} from "../lib/vault-review-provenance";

const COMPANY = "company-partial-verification";

/** A CV that proves the identity but never states years of experience. */
const CV_TEXT =
  "CURRICULUM VITAE\nName of Key Expert: Mara Tesfaye\n" +
  "Mara Tesfaye is a Structural Engineer working on bridge rehabilitation in the Roads sector.";

function sourceDocument(text: string, id = "doc-partial") {
  return {
    id,
    companyId: COMPANY,
    extractedText: text,
    contentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
  };
}

/** Identity provable from the CV; yearsExperience present but not stated in it. */
function partiallyVerifiedExpert() {
  const doc = sourceDocument(CV_TEXT);
  const record = {
    id: "expert-partial",
    companyId: COMPANY,
    fullName: "Mara Tesfaye",
    title: "Structural Engineer",
    yearsExperience: 14, // nowhere in the CV text
    disciplines: JSON.stringify(["Structural Engineer"]),
    sectors: JSON.stringify(["Roads"]),
    certifications: JSON.stringify([]),
    trustLevel: "SOURCE_VERIFIED",
    sourceDocumentId: doc.id,
    reviewedBy: null,
    reviewedAt: null,
    sourceDocument: doc,
  };
  const provenance = buildPartialSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument: doc,
    fields: expertReviewFields(record),
    verificationMethod: "DETERMINISTIC",
  });
  assert.equal(provenance.ok, true, `fixture must verify partially: ${JSON.stringify(provenance)}`);
  if (!provenance.ok) throw new Error("fixture failed");
  return { record: { ...record, reviewNotes: provenance.serialized }, provenance };
}

describe("a partially verified record is still usable", () => {
  it("verifies the identity while leaving the unprovable field unproven", () => {
    const { provenance } = partiallyVerifiedExpert();
    if (!provenance.ok) return;
    assert.ok(provenance.verifiedFields.includes("fullName"), "identity must be proven");
    assert.ok(
      provenance.unverifiedFields.includes("yearsExperience"),
      `yearsExperience is not in the CV and must be reported unproven: ${JSON.stringify(provenance.unverifiedFields)}`,
    );
  });

  it("still reads as durably source-verified afterwards", () => {
    // The regression this replaced: the strict count check rejected every
    // partially-verified record the moment it was read back.
    const { record } = partiallyVerifiedExpert();
    assert.equal(isDurablySourceVerified(record), true);
  });

  it("records the unproven fields in the stored payload, not just the return value", () => {
    // If they live only in the return value they are gone by the time anything
    // reads the record, and the read side cannot tell them from new claims.
    const { record } = partiallyVerifiedExpert();
    assert.match(record.reviewNotes ?? "", /"unverifiedFields":\[/);
    assert.match(record.reviewNotes ?? "", /yearsExperience/);
  });
});

describe("a record that grew after verification is stale", () => {
  it("rejects a certification added after verification", () => {
    const { record } = partiallyVerifiedExpert();
    const overclaimed = { ...record, certifications: JSON.stringify(["Chartered Engineer"]) };
    assert.equal(
      isDurablySourceVerified(overclaimed),
      false,
      "a credential nobody verified must not inherit the record's verified status",
    );
  });

  it("rejects a changed value on a field that WAS verified", () => {
    const { record } = partiallyVerifiedExpert();
    const renamed = { ...record, fullName: "Someone Else" };
    assert.equal(isDurablySourceVerified(renamed), false);
  });

  it("accepts a changed value on a field recorded as unproven", () => {
    // yearsExperience was never authoritative, so editing it does not
    // invalidate what the source actually proved.
    const { record } = partiallyVerifiedExpert();
    const edited = { ...record, yearsExperience: 15 };
    assert.equal(isDurablySourceVerified(edited), true);
  });
});

describe("full verification keeps the stricter rule", () => {
  const FULL_TEXT =
    "CURRICULUM VITAE\nName of Key Expert: Dawit Alemu\n" +
    "Dawit Alemu is a Water Engineer with 9 years of experience in Water and Sanitation.";

  function fullyVerifiedExpert() {
    const doc = sourceDocument(FULL_TEXT, "doc-full");
    const record = {
      id: "expert-full",
      companyId: COMPANY,
      fullName: "Dawit Alemu",
      title: "Water Engineer",
      yearsExperience: 9,
      disciplines: JSON.stringify(["Water Engineer"]),
      sectors: JSON.stringify(["Water and Sanitation"]),
      certifications: JSON.stringify([]),
      trustLevel: "SOURCE_VERIFIED",
      sourceDocumentId: doc.id,
      reviewedBy: null,
      reviewedAt: null,
      sourceDocument: doc,
    };
    const provenance = buildSourceVerificationProvenance({
      recordType: "EXPERT",
      sourceDocument: doc,
      fields: expertReviewFields(record),
      verificationMethod: "DETERMINISTIC",
    });
    assert.equal(provenance.ok, true);
    if (!provenance.ok) throw new Error("fixture failed");
    return { ...record, reviewNotes: provenance.serialized };
  }

  it("reads back as verified", () => {
    assert.equal(isDurablySourceVerified(fullyVerifiedExpert()), true);
  });

  it("records an empty unproven list rather than omitting it", () => {
    // Omission means "written before partial verification existed", which is a
    // different claim from "nothing was left unproven".
    assert.match(fullyVerifiedExpert().reviewNotes ?? "", /"unverifiedFields":\[\]/);
  });

  it("rejects any field added afterwards", () => {
    const grown = { ...fullyVerifiedExpert(), certifications: JSON.stringify(["PMP"]) };
    assert.equal(isDurablySourceVerified(grown), false);
  });
});
