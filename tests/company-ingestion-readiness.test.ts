import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessCompanyIngestionReadiness } from "../lib/company-ingestion-readiness";

describe("assessCompanyIngestionReadiness", () => {
  it("does not require expert or project evidence when the tender does not request it", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "General company profile with detailed service lines covering engineering, design, project management, construction supervision, and advisory services for healthcare facilities and urban planning projects in Ethiopia." }],
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

  it("blocks when only an unverified AI draft exists", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "Company profile with expert details." }],
      experts: [{ trustLevel: "AI_DRAFT" }],
      projects: [],
    }, {
      requireReviewedExperts: true,
      requireReviewedProjects: false,
    });
    assert.equal(readiness.ingestionReady, false);
    assert.match(readiness.blockers.join(" "), /No verified, source-backed experts/i);
  });

  it("allows SOURCE_VERIFIED evidence without a human approval step", () => {
    const readiness = assessCompanyIngestionReadiness({
      docs: [{ extractedText: "The tender requires one structural engineer and one comparable project reference." }],
      experts: [{ trustLevel: "SOURCE_VERIFIED" }],
      projects: [{ trustLevel: "SOURCE_VERIFIED" }],
    }, {
      requireReviewedExperts: true,
      requireReviewedProjects: true,
    });
    assert.equal(readiness.ingestionReady, true);
    assert.equal(readiness.blockers.length, 0);
  });
});
