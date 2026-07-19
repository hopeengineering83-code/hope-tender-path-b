// Immutable reviewed evidence — edit-time enforcement.
//
// isDurablyReviewed() already DETECTS a REVIEWED record whose evidence
// fields drifted from the stored provenance hashes, but nothing ENFORCED
// anything at edit time: the expert/project PUT handlers rewrote the
// substantive fields while leaving trustLevel = "REVIEWED", so the record
// kept presenting as reviewed (and kept passing the structural matching
// eligibility check) with provenance describing content that no longer
// exists. These tests lock the edit-time demotion contract: editing a
// reviewed-evidence field on a REVIEWED record demotes it to draft,
// while non-evidence fields (email, phone, profile, summary, isActive)
// stay freely editable without invalidating the review.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  expertReviewFields,
  projectReviewFields,
  reviewEvidenceEquals,
} from "../lib/vault-review-provenance";

describe("reviewEvidenceEquals", () => {
  const baseExpert = {
    fullName: "Alemu Bekele",
    title: "Senior Hydrologist",
    yearsExperience: 12,
    disciplines: JSON.stringify(["Hydrology", "Water Supply"]),
    sectors: JSON.stringify(["Public"]),
    certifications: JSON.stringify(["PE"]),
  };

  it("identical field sets are equal", () => {
    assert.equal(
      reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields({ ...baseExpert })),
      true,
    );
  });

  it("whitespace and case differences do not invalidate (matches verifier normalization)", () => {
    const reformatted = { ...baseExpert, fullName: "  alemu   bekele ", title: "SENIOR HYDROLOGIST" };
    assert.equal(
      reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields(reformatted)),
      true,
    );
  });

  it("a changed evidence value is detected", () => {
    const edited = { ...baseExpert, yearsExperience: 3 };
    assert.equal(
      reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields(edited)),
      false,
    );
  });

  it("an added or removed list entry is detected", () => {
    const edited = { ...baseExpert, disciplines: JSON.stringify(["Hydrology"]) };
    assert.equal(
      reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields(edited)),
      false,
    );
  });

  it("project evidence changes are detected the same way", () => {
    const baseProject = {
      name: "Adama Water Supply Phase II",
      clientName: "Ministry of Water",
      country: "Ethiopia",
      sector: "Water",
      serviceAreas: JSON.stringify(["Design Review"]),
      contractValue: 1200000,
      currency: "ETB",
    };
    assert.equal(
      reviewEvidenceEquals(projectReviewFields(baseProject), projectReviewFields({ ...baseProject })),
      true,
    );
    assert.equal(
      reviewEvidenceEquals(
        projectReviewFields(baseProject),
        projectReviewFields({ ...baseProject, contractValue: 9900000 }),
      ),
      false,
    );
  });

  it("non-evidence expert fields are not part of the hashed evidence set", () => {
    // email/phone/profile are intentionally absent from expertReviewFields —
    // editing them must never demote a reviewed record.
    const fields = expertReviewFields(baseExpert).map((f) => f.field);
    for (const excluded of ["email", "phone", "profile", "isActive"]) {
      assert.ok(!fields.some((f) => f.startsWith(excluded)), `${excluded} must not be review evidence`);
    }
  });

  it("non-evidence project fields are not part of the hashed evidence set", () => {
    const fields = projectReviewFields({ name: "X", summary: "long text" } as never).map((f) => f.field);
    assert.ok(!fields.some((f) => f.startsWith("summary")), "summary must not be review evidence");
  });
});

describe("edit endpoints demote REVIEWED records when evidence fields change", () => {
  const expertRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
  const projectRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");

  for (const [name, src, fieldsFn] of [
    ["experts", expertRoute, "expertReviewFields"],
    ["projects", projectRoute, "projectReviewFields"],
  ] as const) {
    it(`${name} PUT computes review invalidation from the shared evidence comparison`, () => {
      assert.match(src, /reviewEvidenceEquals/);
      assert.match(src, new RegExp(`${fieldsFn}\\(existing\\), ${fieldsFn}\\(nextValues\\)`));
      assert.match(src, /existing\.trustLevel === "REVIEWED"/);
    });

    it(`${name} PUT demotes to draft and audits the invalidation`, () => {
      assert.match(src, /reviewInvalidated \? \{ trustLevel: "AI_DRAFT" \} : \{\}/);
      assert.match(src, /review invalidated — reviewed evidence fields were edited/);
    });
  }
});
