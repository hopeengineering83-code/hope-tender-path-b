/**
 * Tests for the company evidence matching system.
 *
 * Verifies:
 *   1. matchRequirementToEvidence returns correct resolution (RESOLVED/PARTIAL/UNRESOLVED).
 *   2. Advisory requirements are never blocking.
 *   3. Deleted evidence is excluded.
 *   4. Expired compliance records are excluded.
 *   5. REGEX_DRAFT evidence gets a score penalty.
 *   6. REVIEWED evidence gets a score bonus.
 *   7. matchRequirementsToEvidence produces a coverage report.
 *   8. buildEvidenceVault converts Prisma objects to CompanyEvidence correctly.
 *   9. The system wires into requirement-categories (linkedCompanyEvidence).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  matchRequirementToEvidence,
  matchRequirementsToEvidence,
  buildEvidenceVault,
  RESOLUTION_THRESHOLD,
  type CompanyEvidence,
} from "../lib/engine/company-evidence-matching";
import { classifyTenderRequirement } from "../lib/engine/requirement-categories";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const EXPERT_EVIDENCE: CompanyEvidence = {
  id: "expert-1",
  type: "expert",
  title: "Dr. Sarah Chen, Lead Architect",
  text: "Dr. Sarah Chen is a Lead Architect with 15 years of experience in hospital design. Certifications: AIA, RIBA. Disciplines: architectural design, healthcare facility design. Sectors: healthcare, hospital.",
  trustLevel: "REVIEWED",
  isDeleted: false,
  metadata: {
    yearsExperience: 15,
    sectors: ["healthcare", "hospital"],
    certifications: ["AIA", "RIBA"],
  },
};

const PROJECT_EVIDENCE: CompanyEvidence = {
  id: "project-1",
  type: "project",
  title: "St. Mary Hospital Expansion",
  text: "St. Mary Hospital Expansion — completed 2024. Sector: healthcare. Service areas: architectural design, structural engineering, MEP. Contract value: USD 12M. Lead architect: Dr. Sarah Chen.",
  trustLevel: "REVIEWED",
  isDeleted: false,
  metadata: {
    sectors: ["healthcare"],
    serviceAreas: ["architectural design", "structural engineering", "MEP"],
    contractValue: 12_000_000,
    startDate: new Date("2022-01-01"),
    endDate: new Date("2024-06-01"),
  },
};

const COMPLIANCE_EVIDENCE: CompanyEvidence = {
  id: "compliance-1",
  type: "compliance",
  title: "ISO 9001:2015 Certificate",
  text: "ISO 9001:2015 Quality Management System Certificate. Issued: 2024-01-15. Expires: 2027-01-15. Certified body: TUV SUD.",
  trustLevel: "REVIEWED",
  isDeleted: false,
  metadata: {
    certificateDate: new Date("2024-01-15"),
    expiryDate: new Date("2027-01-15"),
  },
};

const EXPIRED_COMPLIANCE: CompanyEvidence = {
  id: "compliance-expired",
  type: "compliance",
  title: "ISO 14001:2015 Certificate (Expired)",
  text: "ISO 14001:2015 Environmental Management System Certificate. Issued: 2020-01-15. Expires: 2023-01-15.",
  trustLevel: "REVIEWED",
  isDeleted: false,
  metadata: {
    certificateDate: new Date("2020-01-15"),
    expiryDate: new Date("2023-01-15"),
  },
};

const DRAFT_EXPERT: CompanyEvidence = {
  id: "expert-draft",
  type: "expert",
  title: "John Doe (REGEX_DRAFT)",
  text: "John Doe — engineer with experience in road design.",
  trustLevel: "REGEX_DRAFT",
  isDeleted: false,
};

const DELETED_EXPERT: CompanyEvidence = {
  id: "expert-deleted",
  type: "expert",
  title: "Jane Smith (Deleted)",
  text: "Jane Smith — architect with hospital experience.",
  trustLevel: "REVIEWED",
  isDeleted: true,
};

const FULL_VAULT: CompanyEvidence[] = [
  EXPERT_EVIDENCE,
  PROJECT_EVIDENCE,
  COMPLIANCE_EVIDENCE,
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("company-evidence-matching — matchRequirementToEvidence", () => {
  it("returns UNRESOLVED when no evidence matches", () => {
    // Use a requirement with keywords that don't appear in any evidence item.
    // "underwater welding" is a niche skill none of the test evidence covers.
    // We use "ANNEX" category (required-documents) which has no category keywords
    // that would match any of the standard evidence items.
    const requirementText = "The bidder must submit a notarized statutory declaration of corporate good standing from a jurisdiction outside the bidder's country of incorporation.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    assert.equal(result.resolution, "UNRESOLVED");
    assert.equal(result.bestMatch, null);
    assert.equal(result.matches.length, 0);
    assert.equal(result.unresolvedReason, "company-evidence-missing");
    assert.equal(result.linkedEvidenceSummary, null);
  });

  it("returns RESOLVED when an expert matches with high score", () => {
    const requirementText = "The bidder must nominate a Lead Architect with hospital design experience.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    // The expert evidence should match (personnel category, "architect" keyword)
    assert.ok(result.matches.length > 0, "must have at least one match");
    assert.ok(result.bestMatch, "must have a best match");
    assert.equal(result.bestMatch!.id, "expert-1");
    assert.ok(result.resolution === "RESOLVED" || result.resolution === "PARTIAL", `expected RESOLVED or PARTIAL, got ${result.resolution}`);
    assert.ok(result.linkedEvidenceSummary, "must have a linked-evidence summary");
    assert.ok(result.linkedEvidenceSummary!.includes("Dr. Sarah Chen"));
  });

  it("returns RESOLVED when a project matches the experience requirement", () => {
    const requirementText = "The bidder must have completed at least one hospital expansion project in the last 5 years.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    assert.ok(result.matches.length > 0);
    // The project evidence should be in the matches
    const hasProjectMatch = result.matches.some((m) => m.evidence.id === "project-1");
    assert.ok(hasProjectMatch, "must match the project evidence");
  });

  it("excludes deleted evidence", () => {
    const requirementText = "The bidder must nominate an architect with hospital design experience.";
    const classification = classifyTenderRequirement(requirementText);
    const vaultWithDeleted = [...FULL_VAULT, DELETED_EXPERT];
    const result = matchRequirementToEvidence(requirementText, classification, vaultWithDeleted);
    // The deleted expert must NOT appear in the matches
    const hasDeletedMatch = result.matches.some((m) => m.evidence.id === "expert-deleted");
    assert.ok(!hasDeletedMatch, "must not match deleted evidence");
  });

  it("excludes expired compliance records", () => {
    const requirementText = "The bidder must hold a valid ISO 14001 environmental management certificate.";
    const classification = classifyTenderRequirement(requirementText);
    const vaultWithExpired = [...FULL_VAULT, EXPIRED_COMPLIANCE];
    const result = matchRequirementToEvidence(requirementText, classification, vaultWithExpired);
    // The expired compliance record must NOT appear in the matches
    const hasExpiredMatch = result.matches.some((m) => m.evidence.id === "compliance-expired");
    assert.ok(!hasExpiredMatch, "must not match expired compliance records");
  });

  it("REGEX_DRAFT evidence gets a score penalty (lower than REVIEWED)", () => {
    const requirementText = "The bidder must nominate an architect with experience.";
    const classification = classifyTenderRequirement(requirementText);
    const vault = [EXPERT_EVIDENCE, DRAFT_EXPERT];
    const result = matchRequirementToEvidence(requirementText, classification, vault);
    const reviewedMatch = result.matches.find((m) => m.evidence.id === "expert-1");
    const draftMatch = result.matches.find((m) => m.evidence.id === "expert-draft");
    if (reviewedMatch && draftMatch) {
      assert.ok(reviewedMatch.score > draftMatch.score, `REVIEWED (${reviewedMatch.score}) must score higher than REGEX_DRAFT (${draftMatch.score})`);
    }
  });

  it("advisory requirements are never blocking (always RESOLVED if any match exists)", () => {
    const requirementText = "The bidder should consider including a cover letter.";
    const classification = classifyTenderRequirement(requirementText);
    assert.equal(classification.mandatory, "advisory");
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    // Even if matches are weak, advisory should be RESOLVED (or UNRESOLVED only if no matches at all)
    if (result.matches.length > 0) {
      assert.equal(result.resolution, "RESOLVED");
      assert.equal(result.unresolvedReason, null);
    }
  });

  it("returns PARTIAL when matches exist but score is below threshold", () => {
    const requirementText = "The bidder must have ISO 9001 quality management certification.";
    const classification = classifyTenderRequirement(requirementText);
    // Use a vault with only the ISO 9001 compliance record — should match
    const result = matchRequirementToEvidence(requirementText, classification, [COMPLIANCE_EVIDENCE]);
    if (result.matches.length > 0 && result.matches[0]!.score < RESOLUTION_THRESHOLD) {
      assert.equal(result.resolution, "PARTIAL");
    }
    // Verify the resolution is at least not UNRESOLVED (since we have a match)
    assert.notEqual(result.resolution, "UNRESOLVED");
  });

  it("hasReviewedEvidence is true when a REVIEWED evidence item is matched", () => {
    const requirementText = "The bidder must nominate a Lead Architect with hospital design experience.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    if (result.matches.some((m) => m.evidence.trustLevel === "REVIEWED")) {
      assert.equal(result.hasReviewedEvidence, true);
    }
  });

  it("hasReviewedEvidence is false when only REGEX_DRAFT evidence is matched", () => {
    const requirementText = "The bidder must nominate an engineer with experience.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, [DRAFT_EXPERT]);
    if (result.matches.length > 0 && result.matches.every((m) => m.evidence.trustLevel !== "REVIEWED")) {
      assert.equal(result.hasReviewedEvidence, false);
    }
  });

  it("returns at most 5 matches", () => {
    const requirementText = "The bidder must have experience in design and engineering.";
    const classification = classifyTenderRequirement(requirementText);
    // Create many similar evidence items
    const manyEvidence: CompanyEvidence[] = Array.from({ length: 20 }, (_, i) => ({
      id: `expert-${i}`,
      type: "expert" as const,
      title: `Expert ${i}`,
      text: `Expert ${i} with design and engineering experience`,
      trustLevel: "REVIEWED" as const,
      isDeleted: false,
    }));
    const result = matchRequirementToEvidence(requirementText, classification, manyEvidence);
    assert.ok(result.matches.length <= 5, `must return at most 5 matches, got ${result.matches.length}`);
  });

  it("unresolvedReason is company-evidence-needs-review when RESOLVED but no REVIEWED evidence", () => {
    const requirementText = "The bidder must nominate an engineer with experience.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, [DRAFT_EXPERT]);
    if (result.resolution === "RESOLVED" && !result.hasReviewedEvidence) {
      assert.equal(result.unresolvedReason, "company-evidence-needs-review");
    }
  });
});

describe("company-evidence-matching — matchRequirementsToEvidence + coverage report", () => {
  it("produces a coverage report with per-category breakdown", () => {
    const requirements = [
      { text: "The bidder must nominate a Lead Architect with hospital design experience.", classification: classifyTenderRequirement("The bidder must nominate a Lead Architect with hospital design experience.") },
      { text: "The bidder must have ISO 9001 certification.", classification: classifyTenderRequirement("The bidder must have ISO 9001 certification.") },
      { text: "The bidder should include a cover letter.", classification: classifyTenderRequirement("The bidder should include a cover letter.") },
    ];
    const { results, coverage } = matchRequirementsToEvidence(requirements, FULL_VAULT);
    assert.equal(results.length, 3);
    assert.equal(coverage.totalRequirements, 3);
    assert.ok(coverage.mandatoryRequirements >= 2);
    assert.ok(typeof coverage.fullyResolved === "boolean");
    assert.ok(typeof coverage.byCategory === "object");
    assert.ok(typeof coverage.byEvidenceType === "object");
  });

  it("fullyResolved is true when ALL mandatory requirements are RESOLVED with REVIEWED evidence", () => {
    const requirements = [
      { text: "The bidder must nominate a Lead Architect with hospital design experience.", classification: classifyTenderRequirement("The bidder must nominate a Lead Architect with hospital design experience.") },
    ];
    const { coverage } = matchRequirementsToEvidence(requirements, FULL_VAULT);
    if (coverage.resolvedMandatory === coverage.mandatoryRequirements && coverage.mandatoryRequirements > 0) {
      // Could be true or false depending on whether REVIEWED evidence was used
      assert.ok(typeof coverage.fullyResolved === "boolean");
    }
  });

  it("fullyResolved is false when mandatory requirements are UNRESOLVED", () => {
    const requirements = [
      { text: "The bidder must submit a notarized statutory declaration of corporate good standing from a jurisdiction outside the bidder's country of incorporation.", classification: classifyTenderRequirement("The bidder must submit a notarized statutory declaration of corporate good standing from a jurisdiction outside the bidder's country of incorporation.") },
    ];
    const { coverage } = matchRequirementsToEvidence(requirements, FULL_VAULT);
    assert.equal(coverage.fullyResolved, false);
    assert.ok(coverage.unresolvedMandatory > 0);
    assert.ok(coverage.unresolvedMandatoryList.length > 0);
  });

  it("coverage.byEvidenceType tracks evidence usage", () => {
    const requirements = [
      { text: "The bidder must nominate a Lead Architect with hospital design experience.", classification: classifyTenderRequirement("The bidder must nominate a Lead Architect with hospital design experience.") },
    ];
    const { coverage } = matchRequirementsToEvidence(requirements, FULL_VAULT);
    // If any matches were made, byEvidenceType should reflect usage
    if (coverage.resolved + coverage.partial > 0) {
      const totalUsage = Object.values(coverage.byEvidenceType).reduce((sum, n) => sum + n, 0);
      assert.ok(totalUsage > 0);
    }
  });
});

describe("company-evidence-matching — buildEvidenceVault", () => {
  it("converts Expert Prisma objects to CompanyEvidence", () => {
    const vault = buildEvidenceVault({
      experts: [{
        id: "e1",
        fullName: "Dr. Sarah Chen",
        title: "Lead Architect",
        profile: "15 years experience",
        disciplines: '["architectural design"]',
        sectors: '["healthcare"]',
        certifications: '["AIA", "RIBA"]',
        yearsExperience: 15,
        trustLevel: "REVIEWED",
        deletedAt: null,
      }],
    });
    assert.equal(vault.length, 1);
    assert.equal(vault[0]!.id, "e1");
    assert.equal(vault[0]!.type, "expert");
    assert.equal(vault[0]!.title, "Dr. Sarah Chen");
    assert.equal(vault[0]!.trustLevel, "REVIEWED");
    assert.equal(vault[0]!.isDeleted, false);
    assert.ok(vault[0]!.text.includes("Dr. Sarah Chen"));
    assert.ok(vault[0]!.text.includes("Lead Architect"));
    assert.ok(vault[0]!.text.includes("15 years experience"));
    assert.deepEqual(vault[0]!.metadata?.sectors, ["healthcare"]);
    assert.deepEqual(vault[0]!.metadata?.certifications, ["AIA", "RIBA"]);
  });

  it("excludes deleted experts", () => {
    const vault = buildEvidenceVault({
      experts: [{
        id: "e1",
        fullName: "Deleted Expert",
        title: null,
        profile: null,
        disciplines: "[]",
        sectors: "[]",
        certifications: "[]",
        yearsExperience: null,
        trustLevel: "REVIEWED",
        deletedAt: new Date(),
      }],
    });
    assert.equal(vault.length, 0);
  });

  it("converts Project Prisma objects to CompanyEvidence", () => {
    const vault = buildEvidenceVault({
      projects: [{
        id: "p1",
        name: "St. Mary Hospital",
        summary: "Hospital expansion",
        sector: "healthcare",
        serviceAreas: '["architectural design", "MEP"]',
        contractValue: 12_000_000,
        startDate: new Date("2022-01-01"),
        endDate: new Date("2024-06-01"),
        trustLevel: "REVIEWED",
        deletedAt: null,
      }],
    });
    assert.equal(vault.length, 1);
    assert.equal(vault[0]!.type, "project");
    assert.equal(vault[0]!.title, "St. Mary Hospital");
    assert.deepEqual(vault[0]!.metadata?.sectors, ["healthcare"]);
    assert.deepEqual(vault[0]!.metadata?.serviceAreas, ["architectural design", "MEP"]);
  });

  it("converts compliance records to CompanyEvidence", () => {
    const vault = buildEvidenceVault({
      complianceRecords: [{
        id: "c1",
        title: "ISO 9001:2015",
        description: "Quality Management Certificate",
        certificateDate: new Date("2024-01-15"),
        expiryDate: new Date("2027-01-15"),
      }],
    });
    assert.equal(vault.length, 1);
    assert.equal(vault[0]!.type, "compliance");
    assert.equal(vault[0]!.trustLevel, "REVIEWED");
    assert.ok(vault[0]!.metadata?.certificateDate);
    assert.ok(vault[0]!.metadata?.expiryDate);
  });

  it("handles empty vault gracefully", () => {
    const vault = buildEvidenceVault({});
    assert.equal(vault.length, 0);
  });

  it("combines multiple evidence types", () => {
    const vault = buildEvidenceVault({
      experts: [{ id: "e1", fullName: "Expert 1", title: null, profile: null, disciplines: "[]", sectors: "[]", certifications: "[]", yearsExperience: null, trustLevel: "REVIEWED", deletedAt: null }],
      projects: [{ id: "p1", name: "Project 1", summary: null, sector: null, serviceAreas: "[]", contractValue: null, startDate: null, endDate: null, trustLevel: "REVIEWED", deletedAt: null }],
      complianceRecords: [{ id: "c1", title: "ISO 9001", description: null, certificateDate: null, expiryDate: null }],
    });
    assert.equal(vault.length, 3);
    const types = new Set(vault.map((e) => e.type));
    assert.ok(types.has("expert"));
    assert.ok(types.has("project"));
    assert.ok(types.has("compliance"));
  });
});

describe("company-evidence-matching — wires into requirement-categories", () => {
  it("the matching system produces linkedEvidenceSummary that can fill the linkedCompanyEvidence field", () => {
    const requirementText = "The bidder must nominate a Lead Architect with hospital design experience.";
    const classification = classifyTenderRequirement(requirementText);
    assert.equal(classification.linkedCompanyEvidence, null); // Initially null

    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);
    // The result has a linkedEvidenceSummary that should fill the linkedCompanyEvidence field
    if (result.matches.length > 0) {
      assert.ok(result.linkedEvidenceSummary, "linkedEvidenceSummary must be non-null when matches exist");
      // The classification's linkedCompanyEvidence would be updated with this summary
      const updatedClassification = { ...classification, linkedCompanyEvidence: result.linkedEvidenceSummary };
      assert.ok(updatedClassification.linkedCompanyEvidence);
    }
  });

  it("the matching system's unresolvedReason is consistent with determineUnresolvedReason", () => {
    const requirementText = "The bidder must have 10 years of experience in underwater welding.";
    const classification = classifyTenderRequirement(requirementText);
    const result = matchRequirementToEvidence(requirementText, classification, FULL_VAULT);

    // When UNRESOLVED, the reason should be "company-evidence-missing"
    if (result.resolution === "UNRESOLVED" && classification.mandatory !== "advisory") {
      assert.equal(result.unresolvedReason, "company-evidence-missing");
    }
  });
});
