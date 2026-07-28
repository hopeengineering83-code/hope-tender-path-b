// Regression tests for Gap 5 — matching-quality structural state.
//
// Before the fix, a tender whose engine hadn't run yet showed
// "Matching Quality 0/100 POOR" even when the company vault had 28
// reviewed experts and 112 reviewed projects ready to be picked up by
// the next Run Engine click. These tests pin the state machine so the
// UI can render the right message ("VAULT_AWAITS_ENGINE", not "POOR").

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { assessMatchingQuality } from "../lib/matching-quality";
import { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";

// A durable REVIEWED fixture — genuinely bound to a real, byte-verified
// source document with a matching quote, not just a bare trustLevel
// string. assessMatchingQuality now delegates to canUseVaultRecord(), the
// same durable-provenance authority the Engine and generate-elite.ts use,
// so a naive `{ trustLevel: "REVIEWED" }` object (missing
// sourceDocumentId/reviewedBy/reviewedAt/reviewNotes) would correctly fail
// closed here just like everywhere else in the app.
function durableReviewedExpert(fullName: string) {
  const companyId = "company-matching-quality-state";
  const sourceText = `CURRICULUM VITAE\nName of Key Expert: ${fullName}\n${fullName} is a Senior Consultant with 15 years of experience in General Consultancy Services, proposed for the technical team.`;
  const sourceDocument = {
    id: `doc-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: `expert-${fullName.replace(/\s+/g, "-").toLowerCase()}`,
    companyId,
    fullName,
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-matching-quality-state",
    reviewedAt: new Date("2026-01-01T00:00:00.000Z"),
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt: record.reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

describe("matching-quality state machine", () => {
  it("MATCHING_NOT_REQUIRED when tender has no expert/project requirements", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "FINANCIAL" }, { requirementType: "DECLARATION" }],
      expertMatches: [],
      projectMatches: [],
    });
    assert.equal(r.state, "MATCHING_NOT_REQUIRED");
    assert.equal(r.score, 100, "no requirements means no penalty");
  });

  it("VAULT_AWAITS_ENGINE when vault has reviewed evidence but engine hasn't run", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
    });
    assert.equal(r.state, "VAULT_AWAITS_ENGINE");
    // Softer penalty (−18 each instead of −35 each) because the situation
    // is fixable by clicking Run Engine, not by importing more evidence.
    assert.ok(r.score >= 60, `Expected >= 60 with vault fallback, got ${r.score}`);
    assert.ok(r.warnings.some((w) => /await\s+engine\s+run/i.test(w)));
  });

  it("NO_VAULT when no evidence exists at all", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 0,
      vaultReviewedProjects: 0,
    });
    assert.equal(r.state, "NO_VAULT");
    // Hard penalty — score must reflect real-world: cannot generate proposal at all.
    assert.ok(r.score <= 30, `Expected <= 30 with no vault, got ${r.score}`);
  });

  it("MATCHES_WEAK when matches exist but none reviewed", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }],
      expertMatches: [
        {
          score: 0.4, isSelected: false,
          expert: {
            trustLevel: "AI_DRAFT", fullName: "Draft Expert", companyId: "company-matching-quality-state",
            sourceDocumentId: null, reviewedBy: null, reviewedAt: null, reviewNotes: null,
          },
        },
      ],
      projectMatches: [],
      vaultReviewedExperts: 0,
      vaultReviewedProjects: 0,
    });
    assert.equal(r.state, "MATCHES_WEAK");
  });

  it("MATCHES_REVIEWED when at least one reviewed match is available", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }],
      expertMatches: [
        { score: 0.82, isSelected: true, expert: durableReviewedExpert("Jane Doe") },
      ],
      projectMatches: [],
      vaultReviewedExperts: 1,
    });
    assert.equal(r.state, "MATCHES_REVIEWED");
  });

  it("report includes vaultReviewed counts so the UI can render them", () => {
    const r = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
    });
    assert.equal(r.vaultReviewedExperts, 28);
    assert.equal(r.vaultReviewedProjects, 112);
  });
});
