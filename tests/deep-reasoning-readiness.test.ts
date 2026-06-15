// Unit tests for the deep-reasoning readiness assessor (round 9).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  assessDeepReasoningReadiness,
  type ReadinessInput,
} from "../lib/engine/deep-reasoning/deep-reasoning-readiness";

function fullyReady(): ReadinessInput {
  return {
    company: {
      name: "ABC Engineering",
      legalName: "ABC Engineering Consultants Ltd",
      foundingYear: 2008,
      headcount: 42,
      licenseGrade: "I",
      tin: "0001234567",
      gmName: "Dr. Hope Mekonnen",
      profileSummary: "Specialist water consultancy founded in 2008 with a track record in donor-funded WASH projects across East Africa.",
    },
    expertCount: 8,
    reviewedExpertCount: 6,
    projectCount: 12,
    reviewedProjectCount: 10,
    legalRecordCount: 5,
  };
}

describe("assessDeepReasoningReadiness — fully-ready firm", () => {
  it("reports ready=true when every dimension passes", () => {
    const r = assessDeepReasoningReadiness(fullyReady());
    assert.equal(r.ready, true);
    assert.equal(r.minimallyViable, true);
    for (const dim of Object.values(r.dimensions)) {
      assert.equal(dim.status, "ok");
      assert.equal(dim.suggestion, null);
    }
    assert.match(r.summary, /READY/);
  });
});

describe("assessDeepReasoningReadiness — minimally viable firm", () => {
  it("reports minimallyViable=true when every dimension is at least 'partial'", () => {
    const input: ReadinessInput = {
      ...fullyReady(),
      reviewedExpertCount: 1,
      reviewedProjectCount: 1,
      legalRecordCount: 1,
    };
    const r = assessDeepReasoningReadiness(input);
    assert.equal(r.ready, false);
    assert.equal(r.minimallyViable, true);
    assert.match(r.summary, /MINIMALLY VIABLE/);
    assert.equal(r.dimensions.experts.status, "partial");
    assert.equal(r.dimensions.projects.status, "partial");
    assert.equal(r.dimensions["legal-records"].status, "partial");
    // Suggestions should be present for non-ok dimensions.
    assert.ok(r.dimensions.experts.suggestion && r.dimensions.experts.suggestion.length > 30);
  });
});

describe("assessDeepReasoningReadiness — not ready", () => {
  it("reports not-ready when company record is missing", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      company: null,
    });
    assert.equal(r.ready, false);
    assert.equal(r.minimallyViable, false);
    assert.equal(r.dimensions["company-profile"].status, "missing");
    assert.match(r.summary, /NOT READY/);
  });

  it("reports not-ready when no experts are reviewed", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      reviewedExpertCount: 0,
      expertCount: 5,
    });
    assert.equal(r.ready, false);
    assert.equal(r.minimallyViable, false);
    assert.equal(r.dimensions.experts.status, "missing");
    assert.match(r.dimensions.experts.detail, /0 reviewed expert\(s\) of 5 total/);
  });

  it("reports not-ready when no projects are reviewed", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      reviewedProjectCount: 0,
      projectCount: 5,
    });
    assert.equal(r.dimensions.projects.status, "missing");
    assert.equal(r.minimallyViable, false);
  });
});

describe("assessDeepReasoningReadiness — company profile completeness", () => {
  it("partial when 3–5 of 8 institutional fields are present", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      company: {
        name: "ABC",
        legalName: "ABC Ltd",
        foundingYear: 2010,
        // Missing: headcount, licenseGrade, TIN/VAT, gmName, profileSummary
        headcount: null,
        licenseGrade: null,
        tin: null,
        vat: null,
        gmName: null,
        profileSummary: null,
      },
    });
    assert.equal(r.dimensions["company-profile"].status, "partial");
    assert.match(r.dimensions["company-profile"].detail, /3\/8/);
  });

  it("ok when ≥6 of 8 institutional fields are present", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      company: {
        name: "ABC",
        legalName: "ABC Ltd",
        foundingYear: 2010,
        headcount: 30,
        licenseGrade: "II",
        tin: "12345",
        // Missing 2: gmName, profileSummary
        gmName: null,
        profileSummary: null,
      },
    });
    assert.equal(r.dimensions["company-profile"].status, "ok");
  });

  it("missing when <3 institutional fields are present", () => {
    const r = assessDeepReasoningReadiness({
      ...fullyReady(),
      company: {
        name: "ABC",
        // Only one field
      },
    });
    assert.equal(r.dimensions["company-profile"].status, "missing");
  });
});

describe("assessDeepReasoningReadiness — suggestion text", () => {
  it("every non-ok dimension has an actionable suggestion", () => {
    const input: ReadinessInput = {
      company: null,
      expertCount: 0, reviewedExpertCount: 0,
      projectCount: 0, reviewedProjectCount: 0,
      legalRecordCount: 0,
    };
    const r = assessDeepReasoningReadiness(input);
    for (const [key, dim] of Object.entries(r.dimensions)) {
      assert.ok(dim.suggestion && dim.suggestion.length > 30, `dimension ${key} missing suggestion`);
      assert.match(dim.suggestion, /\/dashboard\//, `suggestion for ${key} should point to a dashboard path`);
    }
  });

  it("ok dimensions get a null suggestion", () => {
    const r = assessDeepReasoningReadiness(fullyReady());
    for (const dim of Object.values(r.dimensions)) {
      assert.equal(dim.suggestion, null);
    }
  });
});
