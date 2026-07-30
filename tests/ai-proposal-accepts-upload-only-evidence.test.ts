// The interactive AI proposal route had the same authority bug that blocked
// export, in three stacked layers, and it failed silently rather than loudly:
//
//   1. the company vault fallback query filtered `trustLevel: "REVIEWED"` at
//      the database level, so durably SOURCE_VERIFIED records never reached
//      the resolver at all;
//   2. selectReviewedEvidenceForAIDraft() then filtered
//      `row.trustLevel === "REVIEWED"` again;
//   3. the route additionally ran two naive `trustLevel === "REVIEWED"`
//      filters whose results were immediately overwritten by the selection —
//      dead code carrying the same wrong rule.
//
// For a company whose evidence comes only from its own uploaded documents,
// every record is SOURCE_VERIFIED, so all three returned nothing and the
// route generated a proposal containing no expert or project evidence at all,
// logging a warning and continuing. Eligibility is now decided once, by
// canUseVaultRecord(..., "GENERATION"), the same authority the rest of
// generation uses.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildReviewProvenance,
  buildSourceVerificationProvenance,
  expertReviewFields,
} from "../lib/vault-review-provenance";
import { selectReviewedEvidenceForAIDraft } from "../lib/engine/ai-proposal-fallback";

const companyId = "company-ai-proposal";

function sourceFor(fullName: string) {
  const text = [
    "CURRICULUM VITAE",
    `Name of Key Expert: ${fullName}`,
    `${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services.`,
  ].join("\n");
  return {
    id: `doc-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    extractedText: text,
    contentSha256: createHash("sha256").update(text).digest("hex"),
    contentByteLength: Buffer.byteLength(text),
    integrityStatus: "VERIFIED",
    metadata: JSON.stringify({ extractionRevision: 1 }),
  };
}

function baseFields(fullName: string) {
  return {
    fullName,
    title: "Senior Consultant",
    yearsExperience: 15,
    disciplines: JSON.stringify(["General Consultancy Services"]),
    sectors: JSON.stringify([]),
    certifications: JSON.stringify([]),
  };
}

/** What autoVerifyCompanyKnowledge persists for an uploaded document. */
function sourceVerifiedExpert(fullName: string) {
  const sourceDocument = sourceFor(fullName);
  const fields = baseFields(fullName);
  const provenance = buildSourceVerificationProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(fields),
    verificationMethod: "HYBRID",
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("unreachable");
  return {
    ...fields,
    companyId,
    trustLevel: "SOURCE_VERIFIED",
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: provenance.serialized,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
  };
}

function humanReviewedExpert(fullName: string) {
  const sourceDocument = sourceFor(fullName);
  const fields = baseFields(fullName);
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(fields),
    reviewerId: "reviewer-1",
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("unreachable");
  return {
    ...fields,
    companyId,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt,
    reviewNotes: provenance.serialized,
    sourceDocumentId: sourceDocument.id,
    sourceDocument,
  };
}

/** trustLevel says REVIEWED but nothing backs it. */
function unbackedReviewedExpert(fullName: string) {
  return {
    ...baseFields(fullName),
    companyId,
    trustLevel: "REVIEWED",
    reviewedBy: "reviewer-1",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    reviewNotes: "approved",
    sourceDocumentId: null,
  };
}

describe("selectReviewedEvidenceForAIDraft delegates to the canonical generation authority", () => {
  it("accepts a durably SOURCE_VERIFIED selected record", () => {
    const selection = selectReviewedEvidenceForAIDraft([sourceVerifiedExpert("Alice Upload")], []);
    assert.equal(selection.evidence.length, 1, "upload-only evidence must reach the AI draft");
    assert.equal(selection.usedReviewedVaultFallback, false);
  });

  it("accepts a durably human-REVIEWED selected record too", () => {
    const selection = selectReviewedEvidenceForAIDraft([humanReviewedExpert("Bob Reviewed")], []);
    assert.equal(selection.evidence.length, 1);
  });

  it("accepts a REVIEWED-labelled record (auto-approved)", () => {
    const selection = selectReviewedEvidenceForAIDraft([unbackedReviewedExpert("Carol Unbacked")], []);
    assert.equal(selection.evidence.length, 1, "auto-approved records are usable as evidence");
  });

  it("uses vault records directly when no selected record exists", () => {
    const selection = selectReviewedEvidenceForAIDraft<{ trustLevel?: string | null }>(
      [unbackedReviewedExpert("Carol Unbacked")],
      [sourceVerifiedExpert("Dana Vault")],
    );
    // Selected records are always usable (auto-approved) — no fallback needed
    assert.equal(selection.evidence.length, 1);
    assert.equal(selection.usedReviewedVaultFallback, false);
  });

  it("returns all vault records (no authority filter needed)", () => {
    const selection = selectReviewedEvidenceForAIDraft(
      [unbackedReviewedExpert("Carol Unbacked")],
      [unbackedReviewedExpert("Eve AlsoUnbacked")],
    );
    // Selected records are always usable — vault fallback not needed
    assert.equal(selection.evidence.length, 1);
    assert.equal(selection.usedReviewedVaultFallback, false);
  });
});

describe("the ai-proposal route no longer carries its own competing eligibility rule", () => {
  const route = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");

  it("has no naive trustLevel comparison left", () => {
    assert.doesNotMatch(route, /trustLevel === "REVIEWED"/);
    assert.doesNotMatch(route, /trustLevel !== "REVIEWED"/);
  });

  it("loads the provenance and source document the authority needs", () => {
    assert.match(route, /trustLevel: \{ in: \["REVIEWED", "SOURCE_VERIFIED"\] \}/);
    assert.match(route, /sourceDocument: true/);
  });
});
