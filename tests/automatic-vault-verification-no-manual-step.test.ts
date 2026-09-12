// Uploading a company document must be enough. No approve click.
//
// The product promise is that after uploading company documents and tender
// files, the app runs to a downloadable ZIP on its own. Vault evidence is the
// first place that promise was broken, and not by a missing feature — by a
// feature that existed and was never wired into the automatic path.
//
// deriveAutomaticSourceVerification (the pass that runs on ingest) called only
// buildSourceVerificationProvenance, which requires EVERY field on the record
// to appear in the source text. A real CV names the expert and the position
// but rarely prints a years-of-experience number, so the whole record was
// refused with FIELD_EVIDENCE_REQUIRED and stayed AI_DRAFT. canUseVaultRecord
// refuses AI_DRAFT, so matching and generation could not use that expert, and
// the pipeline stopped until someone opened the record and clicked approve.
//
// That approve button already fell back to buildPartialSourceVerificationProvenance.
// So the click carried no human judgement whatsoever — it just ran the check
// the automatic pass had declined to run. Pure bureaucracy.
//
// The automatic pass now falls back the same way. What must NOT change, and is
// pinned below: identity still has to be proven, no human state is invented,
// unproven fields are recorded rather than assumed, and a field added after
// verification still invalidates it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import { deriveAutomaticSourceVerification } from "../lib/company-auto-verification";
import {
  expertReviewFields,
  isDurablySourceVerified,
  isDurablyReviewed,
  canUseVaultRecord,
} from "../lib/vault-review-provenance";

function sourceDoc(text: string, id = "doc-auto") {
  return {
    id,
    companyId: "company-auto",
    extractedText: text,
    contentSha256: createHash("sha256").update(text, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
  };
}

/** Names the expert and the position; never states a years number. */
const CV_WITHOUT_YEARS =
  "CURRICULUM VITAE\nName of Key Expert: Mara Tesfaye\n" +
  "Proposed Position: Structural Engineer\nBridge rehabilitation across the Roads sector.";

function expertFrom(doc: ReturnType<typeof sourceDoc>) {
  return {
    id: "expert-auto",
    companyId: "company-auto",
    fullName: "Mara Tesfaye",
    title: "Structural Engineer",
    yearsExperience: 14, // nowhere in the CV
    disciplines: JSON.stringify([]),
    sectors: JSON.stringify([]),
    certifications: JSON.stringify([]),
    sourceDocumentId: doc.id,
    sourceDocument: doc,
  };
}

function verifyAutomatically(doc: ReturnType<typeof sourceDoc>, expert: ReturnType<typeof expertFrom>) {
  return deriveAutomaticSourceVerification({
    recordType: "EXPERT",
    sourceDocument: doc,
    fields: expertReviewFields(expert as never),
    priorTrustLevel: "AI_DRAFT",
  });
}

describe("uploading is enough — no approve click for an ordinary CV", () => {
  it("verifies a CV whose years-of-experience is not printed in it", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const decision = verifyAutomatically(doc, expertFrom(doc));
    assert.equal(decision.ok, true, `a normal CV must not need a human click: ${JSON.stringify(decision)}`);
  });

  it("proves the identity and reports the rest as unproven", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const decision = verifyAutomatically(doc, expertFrom(doc));
    if (!decision.ok) throw new Error("fixture must verify");
    assert.ok(decision.provenance.evidenceFields.includes("fullName"));
    assert.ok(decision.provenance.unverifiedFields.includes("yearsExperience"));
    assert.equal(decision.provenance.partial, true);
  });

  it("the resulting record is usable by matching, generation and export", () => {
    // This is the whole point: an unusable record stops the automatic chain.
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const expert = expertFrom(doc);
    const decision = verifyAutomatically(doc, expert);
    if (!decision.ok) throw new Error("fixture must verify");
    const record = { ...expert, ...decision.reviewState } as never;

    assert.equal(isDurablySourceVerified(record), true);
    for (const purpose of ["MATCHING", "GENERATION", "EXPORT"] as const) {
      assert.equal(canUseVaultRecord(record, purpose), true, `must be usable for ${purpose}`);
    }
  });
});

describe("automatic verification still invents nothing", () => {
  it("never writes a reviewer or a review timestamp", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const decision = verifyAutomatically(doc, expertFrom(doc));
    if (!decision.ok) throw new Error("fixture must verify");
    assert.equal(decision.reviewState.trustLevel, "SOURCE_VERIFIED");
    assert.equal(decision.reviewState.reviewedBy, null);
    assert.equal(decision.reviewState.reviewedAt, null);
  });

  it("does not read as human-reviewed", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const expert = expertFrom(doc);
    const decision = verifyAutomatically(doc, expert);
    if (!decision.ok) throw new Error("fixture must verify");
    const record = { ...expert, ...decision.reviewState } as never;
    assert.equal(isDurablyReviewed(record), false, "machine verification is not a human approval");
  });

  it("still refuses a record whose identity cannot be proven", () => {
    // The fallback widens what counts as verified; it must not remove the
    // floor. A document that never names this expert proves nothing about them.
    const doc = sourceDoc("ANNUAL REPORT 2026\nRevenue and staffing summary for the water division.");
    const decision = verifyAutomatically(doc, expertFrom(doc));
    assert.equal(decision.ok, false, "an unnamed expert must stay unverified");
  });

  it("still refuses when there is no owned source document at all", () => {
    const decision = deriveAutomaticSourceVerification({
      recordType: "EXPERT",
      sourceDocument: null,
      fields: expertReviewFields(expertFrom(sourceDoc(CV_WITHOUT_YEARS)) as never),
      priorTrustLevel: "AI_DRAFT",
    });
    assert.equal(decision.ok, false);
  });
});

describe("the staleness guarantee survives the automatic path", () => {
  it("a certification added after verification invalidates the record", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const expert = expertFrom(doc);
    const decision = verifyAutomatically(doc, expert);
    if (!decision.ok) throw new Error("fixture must verify");
    const record = { ...expert, ...decision.reviewState };

    const overclaimed = { ...record, certifications: JSON.stringify(["PMP"]) } as never;
    assert.equal(
      isDurablySourceVerified(overclaimed),
      false,
      "a credential nobody verified must not inherit the record's verified status",
    );
    assert.equal(canUseVaultRecord(overclaimed, "EXPORT"), false);
  });

  it("editing a field recorded as unproven does not invalidate it", () => {
    // yearsExperience was never authoritative, so correcting it cannot
    // invalidate what the source actually proved.
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const expert = expertFrom(doc);
    const decision = verifyAutomatically(doc, expert);
    if (!decision.ok) throw new Error("fixture must verify");
    const record = { ...expert, ...decision.reviewState };

    assert.equal(isDurablySourceVerified({ ...record, yearsExperience: 15 } as never), true);
  });

  it("changing the source document invalidates it", () => {
    const doc = sourceDoc(CV_WITHOUT_YEARS);
    const expert = expertFrom(doc);
    const decision = verifyAutomatically(doc, expert);
    if (!decision.ok) throw new Error("fixture must verify");
    const record = { ...expert, ...decision.reviewState };

    const rewritten = sourceDoc("CURRICULUM VITAE\nName of Key Expert: Someone Else", doc.id);
    assert.equal(isDurablySourceVerified({ ...record, sourceDocument: rewritten } as never), false);
  });
});

describe("the audit trail says what was and was not proven", () => {
  it("records the unproven field names and the partial flag", () => {
    const src = require("node:fs").readFileSync("lib/company-auto-verification.ts", "utf8") as string;
    assert.match(src, /unverifiedFields: provenance\.unverifiedFields/);
    assert.match(src, /partialVerification: provenance\.partial/);
  });
});
