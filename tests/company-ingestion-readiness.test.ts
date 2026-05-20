import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";

describe("assessCompanyIngestionReadiness", () => {
  it("does not block expert/project review when tender does not require them", () => {
    const readiness = assessCompanyIngestionReadiness({ docs: [{ extractedText: "General company profile with detailed service lines covering engineering, design, project management, construction supervision, and advisory services." }], experts: [], projects: [] }, {
      requireDocuments: true,
      requireReviewedExperts: false,
      requireReviewedProjects: false,
    });
    assert.equal(readiness.ingestionReady, true);
    assert.equal(readiness.blockers.length, 0);
  });

  it("blocks when reviewed experts are required but missing", () => {
    const readiness = assessCompanyIngestionReadiness({ docs: [{ extractedText: "Need 2 experts" }], experts: [{ trustLevel: "AI_DRAFT" }], projects: [{ trustLevel: "REVIEWED" }] }, {
      requireReviewedExperts: true,
      requireReviewedProjects: false,
    });
    assert.equal(readiness.ingestionReady, false);
    assert.ok(readiness.blockers.some((b) => /reviewed experts/i.test(b)));
  });
});
