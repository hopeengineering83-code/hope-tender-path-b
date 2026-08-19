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
    fullName: "Example Expert",
    title: "Senior Engineer",
    yearsExperience: 12,
    disciplines: JSON.stringify(["Engineering", "Water Supply"]),
    sectors: JSON.stringify(["Public"]),
    certifications: JSON.stringify(["PE"]),
  };

  it("treats identical normalized field sets as equal", () => {
    assert.equal(reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields({ ...baseExpert })), true);
    const reformatted = { ...baseExpert, fullName: "  example   expert ", title: "SENIOR ENGINEER" };
    assert.equal(reviewEvidenceEquals(expertReviewFields(baseExpert), expertReviewFields(reformatted)), true);
  });

  it("detects changed scalar or list evidence", () => {
    assert.equal(reviewEvidenceEquals(
      expertReviewFields(baseExpert),
      expertReviewFields({ ...baseExpert, yearsExperience: 3 }),
    ), false);
    assert.equal(reviewEvidenceEquals(
      expertReviewFields(baseExpert),
      expertReviewFields({ ...baseExpert, disciplines: JSON.stringify(["Engineering"]) }),
    ), false);
  });

  it("detects project evidence changes through the same helper", () => {
    const project = {
      name: "Project Alpha",
      clientName: "Client One",
      country: "Country",
      sector: "Water",
      serviceAreas: JSON.stringify(["Design Review"]),
      contractValue: 1200000,
      currency: "ETB",
    };
    assert.equal(reviewEvidenceEquals(projectReviewFields(project), projectReviewFields({ ...project })), true);
    assert.equal(reviewEvidenceEquals(
      projectReviewFields(project),
      projectReviewFields({ ...project, contractValue: 9900000 }),
    ), false);
  });

  it("excludes non-evidence presentation/contact fields", () => {
    const expertFields = expertReviewFields(baseExpert).map((field) => field.field);
    for (const excluded of ["email", "phone", "profile", "isActive"]) {
      assert.ok(!expertFields.some((field) => field.startsWith(excluded)));
    }
    const projectFields = projectReviewFields({ name: "X", summary: "long text" } as never).map((field) => field.field);
    assert.ok(!projectFields.some((field) => field.startsWith("summary")));
  });
});

describe("edit endpoints invalidate durable trust when bound evidence fields change", () => {
  const expertRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
  const projectRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");

  for (const [name, source, fieldsFn, auditAction] of [
    ["experts", expertRoute, "expertReviewFields", "EXPERT_TRUST_INVALIDATED"],
    ["projects", projectRoute, "projectReviewFields", "PROJECT_TRUST_INVALIDATED"],
  ] as const) {
    it(`${name} PUT computes invalidation from the shared complete evidence fields`, () => {
      assert.match(source, /reviewEvidenceEquals/);
      assert.match(source, new RegExp(`${fieldsFn}\\(existing\\), ${fieldsFn}\\(nextValues\\)`));
      assert.match(source, /existing\.trustLevel === "REVIEWED" \|\| existing\.trustLevel === "SOURCE_VERIFIED"/);
    });

    it(`${name} PUT clears all provenance and audits the previous trust purpose`, () => {
      assert.match(source, /provenanceInvalidated/);
      assert.match(source, /trustLevel: "AI_DRAFT"/);
      assert.match(source, /reviewedBy: null/);
      assert.match(source, /reviewedAt: null/);
      assert.match(source, /reviewNotes: null/);
      assert.match(source, new RegExp(`action: "${auditAction}"`));
      assert.match(source, /previousTrustLevel: existing\.trustLevel/);
      assert.match(source, /nextTrustLevel: "AI_DRAFT"/);
    });
  }
});
