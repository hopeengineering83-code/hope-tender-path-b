import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assessMatchingQuality } from "../lib/matching-quality";
import { buildReviewProvenance, expertReviewFields } from "../lib/vault-review-provenance";

// assessMatchingQuality now delegates to canUseVaultRecord(), the same
// durable-provenance authority the Engine/generate-elite.ts use — a bare
// `{ trustLevel: "REVIEWED" }` object (no sourceDocumentId/reviewedBy/
// reviewedAt/reviewNotes) correctly fails closed, so a fixture that's meant
// to be genuinely reviewed needs a real bound-and-verified provenance
// envelope, not just the trustLevel string.
function durableReviewedExpert(fullName: string) {
  const companyId = "company-readiness-gate-consistency";
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
    reviewedBy: "user-readiness-gate-consistency",
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

describe("readiness gate consistency", () => {
  it("VAULT_AWAITS_ENGINE state is never ready for full proposal generation", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
    });
    assert.equal(report.state, "VAULT_AWAITS_ENGINE");
    assert.equal(report.expertMatches, 0);
    assert.equal(report.projectMatches, 0);
  });

  it("NO_VAULT state is never ready for full proposal generation", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 0,
      vaultReviewedProjects: 0,
    });
    assert.equal(report.state, "NO_VAULT");
    assert.ok(report.severity !== "GOOD", `NO_VAULT severity should not be GOOD, got ${report.severity}`);
  });

  it("MATCHES_WEAK blocks full proposal when selected matches have no reviewed evidence", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [
        { isSelected: true, expert: { trustLevel: "PENDING" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
      ] as Parameters<typeof assessMatchingQuality>[0]["expertMatches"],
      projectMatches: [
        { isSelected: true, project: { trustLevel: "PENDING" } },
        { isSelected: false, project: { trustLevel: "REVIEWED" } },
        { isSelected: false, project: { trustLevel: "REVIEWED" } },
      ] as Parameters<typeof assessMatchingQuality>[0]["projectMatches"],
      vaultReviewedExperts: 10,
      vaultReviewedProjects: 10,
    });
    // When selected matches exist but none are reviewed, quality cannot be GOOD
    assert.ok(report.reviewedSelectedExperts === 0, "No reviewed selected experts");
    assert.ok(report.reviewedSelectedProjects === 0, "No reviewed selected projects");
    assert.ok(report.severity !== "GOOD", `Severity should not be GOOD when no reviewed selections, got ${report.severity}`);
  });

  it("state is MATCHES_STRONG when all selected are reviewed", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [
        { isSelected: true, score: 0.95, expert: durableReviewedExpert("Reviewed Expert One") },
        { isSelected: true, score: 0.88, expert: durableReviewedExpert("Reviewed Expert Two") },
      ] as Parameters<typeof assessMatchingQuality>[0]["expertMatches"],
      projectMatches: [],
      vaultReviewedExperts: 15,
      vaultReviewedProjects: 30,
    });
    assert.equal(report.reviewedSelectedExperts, 2);
    assert.ok(report.score >= 50, `Score should be decent when reviewed experts selected, got ${report.score}`);
  });
});
