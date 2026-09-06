import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildReviewProvenance,
  expertReviewFields,
} from "../lib/vault-review-provenance";
import {
  capabilityScore,
  detectDominantFamily,
} from "../lib/engine/matching";
import {
  isEligibleForMatching,
  enforceMatchingEligibility,
  checkMatchingEligibility,
} from "../lib/engine/matching-eligibility";

const HEALTHCARE_QUERY = `
  Pharo Health Ethiopia Specialty Medical Center
  Request for Technical Proposal
  Healthcare facility design, hospital architecture, medical equipment planning,
  biomedical engineering, clinical workflow, patient flow, infection control,
  pharmacy design, radiology, surgical suite, ICU, OPD, ministry of health.
`;

function durableExpertRecord() {
  const companyId = "company-durable";
  const reviewedAt = new Date("2026-01-01T00:00:00.000Z");
  const sourceText = "Hana Durable is a Structural Engineer with 20 years of experience in Buildings and holds PE certification.";
  const sourceDocument = {
    id: "doc-durable",
    companyId,
    extractedText: sourceText,
    contentSha256: createHash("sha256").update(sourceText, "utf8").digest("hex"),
    contentByteLength: Buffer.byteLength(sourceText),
    integrityStatus: "VERIFIED",
  };
  const record = {
    id: "expert-durable",
    companyId,
    fullName: "Hana Durable",
    title: "Structural Engineer",
    yearsExperience: 20,
    disciplines: JSON.stringify(["Structural Engineer"]),
    sectors: JSON.stringify(["Buildings"]),
    certifications: JSON.stringify(["PE"]),
    trustLevel: "REVIEWED",
    sourceDocumentId: sourceDocument.id,
    reviewedBy: "user-durable",
    reviewedAt,
    sourceDocument,
  };
  const provenance = buildReviewProvenance({
    recordType: "EXPERT",
    sourceDocument,
    fields: expertReviewFields(record),
    reviewerId: record.reviewedBy,
    reviewedAt,
  });
  assert.equal(provenance.ok, true);
  if (!provenance.ok) throw new Error("durable fixture provenance failed");
  return { ...record, reviewNotes: provenance.serialized };
}

describe("healthcare matching rejects off-sector candidates", () => {
  for (const [label, candidate] of [
    ["abattoir", "livestock slaughter facility and meat processing plant"],
    ["residential", "residential apartment and housing project"],
    ["warehouse", "warehouse logistics and cargo storage"],
    ["factory", "industrial manufacturing facility and production plant"],
    ["commercial", "retail office and shopping mall"],
  ] as const) {
    it(`${label} evidence remains below the healthcare selection threshold`, () => {
      assert.ok(capabilityScore(HEALTHCARE_QUERY, candidate, "project") < 0.75);
    });
  }

  it("detects the healthcare capability family", () => {
    assert.equal(detectDominantFamily(HEALTHCARE_QUERY), "HEALTHCARE_FACILITIES");
  });

  it("generic overlap cannot create a high-confidence match", () => {
    assert.ok(capabilityScore(HEALTHCARE_QUERY, "engineering design supervision infrastructure planning", "expert") < 0.75);
  });
});

describe("matching authority is automatic but fail-closed", () => {
  it("accepts a durably grounded REVIEWED record", () => {
    assert.equal(isEligibleForMatching(durableExpertRecord()), true);
    assert.equal(enforceMatchingEligibility(0.85, durableExpertRecord()), 0.85);
  });

  it("rejects a REVIEWED label without a source document", () => {
    const record = {
      id: "expert-no-source",
      trustLevel: "REVIEWED",
      sourceDocumentId: null,
      reviewedBy: "user-1",
      reviewedAt: new Date("2026-01-01"),
    };
    assert.equal(isEligibleForMatching(record), false);
    assert.equal(enforceMatchingEligibility(0.95, record), 0);
    assert.equal(checkMatchingEligibility(record).eligible, false);
  });

  it("rejects incomplete human review metadata", () => {
    assert.equal(isEligibleForMatching({
      id: "expert-no-reviewer",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: null,
      reviewedAt: new Date("2026-01-01"),
    }), false);
    assert.equal(isEligibleForMatching({
      id: "expert-no-time",
      trustLevel: "REVIEWED",
      sourceDocumentId: "doc-1",
      reviewedBy: "user-1",
      reviewedAt: null,
    }), false);
  });

  it("rejects AI and regex drafts until automatic source verification succeeds", () => {
    for (const trustLevel of ["AI_DRAFT", "REGEX_DRAFT"] as const) {
      assert.equal(isEligibleForMatching({
        id: `expert-${trustLevel}`,
        trustLevel,
        sourceDocumentId: "doc-1",
        reviewedBy: null,
        reviewedAt: null,
      }), false);
    }
  });
});

describe("matching implementation keeps explicit fail-closed contracts", () => {
  it("uses an explicit provenance authority without require fallback", () => {
    const src = readFileSync("lib/engine/matching-eligibility.ts", "utf8");
    assert.ok(!src.includes("require("));
    assert.match(src, /vault-runtime-authority|vault-review-provenance/);
    assert.match(src, /NOT_REVIEWED/);
    assert.match(src, /NO_SOURCE_DOCUMENT/);
    assert.match(src, /NO_REVIEWER/);
    assert.match(src, /NO_REVIEW_TIMESTAMP/);
    assert.match(src, /NO_DURABLE_PROVENANCE/);
  });

  it("generation readiness retains evidence-related blockers", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(/evidence|reviewed|grounded|SOURCE_VERIFIED/i.test(src));
    assert.match(src, /return fail\(/);
  });

  it("empty eligible sets remain unselected", () => {
    const src = readFileSync("lib/engine/matching.ts", "utf8");
    assert.match(src, /eligible\.length === 0[\s\S]*?isSelected:\s*false/);
    assert.ok(!src.includes("MIN_FLOOR_SCORE"));
    assert.ok(!src.includes("FALLBACK_MIN_SCORE"));
  });
});
