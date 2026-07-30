import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  buildReviewProvenance,
  buildSourceVerificationProvenance,
  expertReviewFields,
} from "../lib/vault-review-provenance";
import {
  fallbackProposal,
  selectReviewedEvidenceForAIDraft,
} from "../lib/engine/ai-proposal-fallback";

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

describe("selectReviewedEvidenceForAIDraft uses canonical generation authority", () => {
  it("accepts durably SOURCE_VERIFIED evidence without a human click", () => {
    const selection = selectReviewedEvidenceForAIDraft([sourceVerifiedExpert("Alice Upload")], []);
    assert.equal(selection.evidence.length, 1);
    assert.equal(selection.usedReviewedVaultFallback, false);
  });

  it("also accepts genuine authenticated human-reviewed evidence", () => {
    const selection = selectReviewedEvidenceForAIDraft([humanReviewedExpert("Bob Reviewed")], []);
    assert.equal(selection.evidence.length, 1);
  });

  it("rejects a REVIEWED label without durable provenance", () => {
    const selection = selectReviewedEvidenceForAIDraft([unbackedReviewedExpert("Carol Unbacked")], []);
    assert.deepEqual(selection.evidence, []);
  });

  it("falls back from unusable selected records to source-verified Vault evidence", () => {
    const selection = selectReviewedEvidenceForAIDraft(
      [unbackedReviewedExpert("Carol Unbacked")],
      [sourceVerifiedExpert("Dana Vault")],
    );
    assert.equal(selection.evidence.length, 1);
    assert.equal(selection.usedReviewedVaultFallback, true);
  });

  it("returns no evidence when both selected and Vault records are unsupported", () => {
    const selection = selectReviewedEvidenceForAIDraft(
      [unbackedReviewedExpert("Carol Unbacked")],
      [unbackedReviewedExpert("Eve Also Unbacked")],
    );
    assert.deepEqual(selection.evidence, []);
    assert.equal(selection.usedReviewedVaultFallback, false);
  });
});

describe("proposal fallback copy reflects automatic source verification", () => {
  it("does not state that human review is mandatory", () => {
    const draft = fallbackProposal({
      tenderTitle: "Sample Tender",
      requirements: ["Provide expert CVs and similar projects"],
      companyName: "Hope",
      companyProfile: "Profile",
      serviceLines: "Engineering",
      expertLines: [],
      projectLines: [],
      differentiators: [],
      submissionRules: [],
    });
    assert.match(draft, /source-verified/i);
    assert.doesNotMatch(draft, /must be reviewed and confirmed|must be reviewed and selected/i);
  });
});

describe("the ai-proposal route has no competing trust-level rule", () => {
  const route = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");

  it("has no naive trustLevel comparison", () => {
    assert.doesNotMatch(route, /trustLevel === "REVIEWED"/);
    assert.doesNotMatch(route, /trustLevel !== "REVIEWED"/);
  });

  it("loads provenance and source documents", () => {
    assert.match(route, /trustLevel: \{ in: \["REVIEWED", "SOURCE_VERIFIED"\] \}/);
    assert.match(route, /sourceDocument: true/);
  });
});
