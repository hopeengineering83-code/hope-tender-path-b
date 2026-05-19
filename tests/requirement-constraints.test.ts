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

  it("does not trigger strict ICT domain from generic digital submission wording", () => {
    const requirements: RequirementDraft[] = [
      {
        title: "Submission",
        description: "Bidders must submit through the digital platform and include a signed form.",
        requirementType: "GENERAL",
        priority: "MANDATORY",
      },
      {
        title: "Project references",
        description: "Provide two similar building projects.",
        requirementType: "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
      },
    ];

    const profile = deriveRequirementConstraintProfile(requirements);
    assert.equal(profile.domainTags.includes("ict"), false);
    assert.equal(profile.strictDomain, false);
  });

  it("ignores ICT tokens that appear only in GENERAL/compliance wording", () => {
    const requirements: RequirementDraft[] = [
      {
        title: "Submission instruction",
        description: "Upload to the information system portal and confirm the digital platform receipt.",
        requirementType: "GENERAL",
        priority: "MANDATORY",
      },
      {
        title: "Project references",
        description: "At least 2 similar road construction projects.",
        requirementType: "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
      },
    ];

    const profile = deriveRequirementConstraintProfile(requirements);
    assert.equal(profile.domainTags.includes("ict"), false);
    assert.equal(profile.strictDomain, false);
  });

});
