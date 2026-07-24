import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";

describe("assessCompanyIngestionReadiness", () => {
  it("does not require expert/project evidence when the tender does not request it", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "General company profile with detailed service lines covering engineering, design, project management, construction supervision, and advisory services." }],
      experts: [],
      projects: [],
    }, {
      requireDocuments: true,
      requireReviewedExperts: false,
      requireReviewedProjects: false,
    });
    assert.equal(readiness.ingestionReady, true);
    assert.equal(readiness.blockers.length, 0);
  });

  it("blocks when durable expert evidence is required but only an AI draft exists", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "Need 2 experts supported by their curriculum vitae and professional registrations." }],
      experts: [{ trustLevel: "AI_DRAFT" }],
      projects: [{ trustLevel: "REVIEWED" }],
    }, {
      requireReviewedExperts: true,
      requireReviewedProjects: false,
    });
    assert.equal(readiness.ingestionReady, false);
    assert.ok(readiness.blockers.some((blocker) => /source-verified or human-reviewed experts/i.test(blocker)));
  });

  it("allows SOURCE_VERIFIED evidence for matching and draft generation", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "The tender requires one structural engineer and one comparable project reference, both supported by source evidence." }],
      experts: [{ trustLevel: "SOURCE_VERIFIED" }],
      projects: [{ trustLevel: "SOURCE_VERIFIED" }],
    }, {
      requireReviewedExperts: true,
      requireReviewedProjects: true,
    });

    assert.equal(readiness.ingestionReady, true);
    assert.equal(readiness.totals.sourceVerifiedExperts, 1);
    assert.equal(readiness.totals.sourceVerifiedProjects, 1);
    assert.equal(readiness.totals.humanReviewedExperts, 0);
    assert.equal(readiness.totals.humanReviewedProjects, 0);
    assert.ok(readiness.warnings.some((warning) => /require human review for final export/i.test(warning)));
  });
});
