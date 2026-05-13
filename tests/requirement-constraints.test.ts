import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deriveRequirementConstraintProfile } from "../lib/engine/requirement-constraints";
import type { RequirementDraft } from "../lib/engine/types";

describe("deriveRequirementConstraintProfile", () => {
  it("extracts role-driven expert count and strict domain for healthcare tenders", () => {
    const requirements: RequirementDraft[] = [
      {
        title: "Key experts",
        description: "Provide Team Leader, Architect, Biomedical specialist and MEP engineer for hospital design.",
        requirementType: "EXPERT",
        priority: "MANDATORY",
      },
      {
        title: "Similar references",
        description: "At least 2 similar hospital projects completed in the last 5 years.",
        requirementType: "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
      },
    ];

    const profile = deriveRequirementConstraintProfile(requirements);
    assert.equal(profile.strictDomain, true);
    assert.ok(profile.expertCount >= 4);
    assert.equal(profile.projectCount, 2);
    assert.ok(profile.roleSignals.includes("team_leader"));
    assert.ok(profile.roleSignals.includes("biomedical"));
  });

  it("respects explicit requiredQuantity when present", () => {
    const requirements: RequirementDraft[] = [
      {
        title: "Personnel",
        description: "Provide key staff.",
        requirementType: "EXPERT",
        priority: "MANDATORY",
        requiredQuantity: 3,
      },
    ];

    const profile = deriveRequirementConstraintProfile(requirements);
    assert.equal(profile.expertCount, 3);
  });

  it("does not trigger strictDomain from generic digital submission wording", () => {
    const requirements: RequirementDraft[] = [
      {
        title: "Submission method",
        description: "Bidders shall submit via the digital procurement platform before the deadline.",
        requirementType: "ADMINISTRATIVE",
        priority: "MANDATORY",
      },
      {
        title: "Eligibility",
        description: "Provide valid tax clearance and company registration documents.",
        requirementType: "ELIGIBILITY",
        priority: "MANDATORY",
      },
    ];

    const profile = deriveRequirementConstraintProfile(requirements);
    assert.equal(profile.domainTags.includes("ict"), true);
    assert.equal(profile.strictDomain, false);
  });
});
