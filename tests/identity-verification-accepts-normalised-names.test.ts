// AI-normalised names must still verify against the source they came from.
//
// THE DEFECT (owner-visible): after AI Analyze and Run Engine both succeeded,
// the workflow sat on "Match Evidence" forever. Stage 3 showed 112 candidates
// and 0 selected; Stage 4 named the chain — NO_SELECTED_REVIEWED_EXPERTS ->
// NO_ACTIVE_GENERATED_DOCUMENTS -> MISSING_PLANNED_FILES. No ZIP, ever.
//
// CAUSE: evidencePattern() builds /token\s+token/i, which is order-sensitive.
// An extractor reads "BEKELE, Dawit (MSc)" off a CV and stores "Dawit Bekele".
// The source never contains that exact sequence, so the identity field failed,
// the record stayed draft, and matching could not see it. Every record failed
// the same way, so the whole vault was unusable.
//
// THE FIX: after the ordered pattern fails, an identity field retries
// order-independently — every significant token must be present as a whole
// word, honorifics from a closed list ignored.
//
// THE LINE THAT MUST NOT MOVE: a value whose tokens are not all in the source
// still fails. This is the gate that stops the app citing an expert who is not
// in the company's documents.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import { deriveAutomaticSourceVerification } from "../lib/company-auto-verification";
import { matchReviewEvidenceField } from "../lib/vault-review-provenance";

const SOURCE = `HOPE ENGINEERING PLC — COMPANY PROFILE
Established 2009 in Addis Ababa, Ethiopia. TIN 0001234567.
KEY EXPERT: Dawit Bekele, MSc Civil Engineering, 15 years experience, Team Leader.
PROJECT REFERENCE: Adama Water Supply Design, client Oromia Water Bureau, 2021.`;

const BYTES = Buffer.from(SOURCE);
const sourceDocument = {
  id: "doc-1",
  fileName: "company-profile.txt",
  companyId: "company-1",
  extractedText: SOURCE,
  contentSha256: createHash("sha256").update(BYTES).digest("hex"),
  contentByteLength: BYTES.byteLength,
  integrityStatus: "VERIFIED",
} as never;

function verify(fields: Array<{ field: string; value: string }>) {
  return deriveAutomaticSourceVerification({
    recordType: "EXPERT" as never,
    sourceDocument,
    fields: fields as never,
    priorTrustLevel: "AI_DRAFT",
  });
}

describe("identity verification tolerates extractor normalisation", () => {
  for (const [label, value] of [
    ["exact name as printed", "Dawit Bekele"],
    ["surname-first", "Bekele, Dawit"],
    ["honorific prefix", "Ato Dawit Bekele"],
    ["post-nominal", "Dawit Bekele MSc"],
    ["case difference", "DAWIT BEKELE"],
    ["extra whitespace", "Dawit  Bekele"],
  ] as const) {
    it(`verifies ${label}`, () => {
      assert.equal(verify([{ field: "fullName", value }]).ok, true, `"${value}" is the same person the source names`);
    });
  }

  it("verifies identity even when an inferred field is not stated in the source", () => {
    // The partial fallback: a CV names the person but rarely prints a
    // years-of-experience number. Refusing the whole record for that is what
    // left real vaults unusable.
    assert.equal(verify([
      { field: "fullName", value: "Ato Dawit Bekele" },
      { field: "yearsExperience", value: "15" },
    ]).ok, true);
  });

  it("uses the same normalised identity semantics in partial verification", () => {
    const surnameFirstText = "DETAILED CURRICULUM VITAE — COMPANY PERSONNEL REGISTER. " +
      "BEKELE, Dawit (MSc). Proposed position: Team Leader. Civil engineering and water supply specialist.";
    const bytes = Buffer.from(surnameFirstText);
    const result = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: {
        ...(sourceDocument as object),
        id: "surname-first-cv",
        extractedText: surnameFirstText,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        contentByteLength: bytes.byteLength,
      },
      fields: [
        { field: "fullName", value: "Dawit Bekele" },
        { field: "yearsExperience", value: "99" },
      ],
      priorTrustLevel: "AI_DRAFT",
    });

    assert.equal(result.ok, true, "partial verification must not redefine identity matching");
    assert.deepEqual(
      result.ok ? result.provenance.unverifiedFields : [],
      ["yearsExperience"],
      "the unsupported field must remain explicitly unverified",
    );
  });

  it("returns one canonical quote and coordinates for identity-token fallback", () => {
    const text = "CV register: Dr. BEKELE,   Dawit, MSc — Team Leader.";
    const first = matchReviewEvidenceField(text, "fullName", "Dawit Bekele", "EXPERT");
    const second = matchReviewEvidenceField(text, "fullName", "Dawit Bekele", "EXPERT");

    assert.equal(first?.matchMode, "IDENTITY_TOKENS");
    assert.deepEqual(second, first, "every verifier must receive identical evidence coordinates and quote data");
    assert.match(first?.quote ?? "", /BEKELE, Dawit/i);
  });

  it("treats canonically equivalent Unicode identity text consistently", () => {
    const decomposed = "DETAILED CURRICULUM VITAE AND PROFESSIONAL PERSONNEL REGISTER. Dr. Jose\u0301  Ayele, PhD — proposed position: Team Leader and senior engineer.";
    const bytes = Buffer.from(decomposed);
    const result = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: {
        ...(sourceDocument as object),
        id: "unicode-cv",
        extractedText: decomposed,
        contentSha256: createHash("sha256").update(bytes).digest("hex"),
        contentByteLength: bytes.byteLength,
      },
      fields: [{ field: "fullName", value: "José Ayele" }],
      priorTrustLevel: "REGEX_DRAFT",
    });
    assert.equal(result.ok, true);
  });
});

describe("the anti-fabrication gate still holds", () => {
  it("rejects a name that is not in the source at all", () => {
    assert.equal(verify([{ field: "fullName", value: "Someone Not Present" }]).ok, false);
  });

  it("rejects a name whose tokens are only PARTLY present", () => {
    // "Dawit" is in the source; "Tesfaye" is not. Requiring EVERY token is
    // what keeps the relaxation from inventing people.
    assert.equal(verify([{ field: "fullName", value: "Dawit Tesfaye" }]).ok, false);
  });

  it("does not relax non-identity fields to order-independent matching", () => {
    // "Water" and "2021" both appear in the source, in that order, but not as
    // this project's name. Only the identity field gets the fallback; if this
    // ever passes, the relaxation has leaked beyond identity.
    const r = deriveAutomaticSourceVerification({
      recordType: "PROJECT" as never,
      sourceDocument,
      fields: [{ field: "name", value: "Adama Water Supply Design" }, { field: "contractValue", value: "2021 Water" }] as never,
      priorTrustLevel: "AI_DRAFT",
    });
    const provenance = (r as { provenance?: { unverifiedFields?: string[] } }).provenance;
    assert.ok(
      !r.ok || (provenance?.unverifiedFields ?? []).includes("contractValue"),
      "contractValue must not verify from scattered tokens",
    );
  });
});
