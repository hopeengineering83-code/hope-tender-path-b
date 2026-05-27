// Tender-metadata completeness gate — verifies the rules that mirror
// the screenshot regression ("Bid-Team to confirm" placeholders, 5/16
// auto-fill coverage, missing submission method).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessTenderMetadataCompleteness,
  looksLikeMetadataPlaceholder,
  stripMetadataPlaceholders,
} from "../lib/engine/tender-metadata-completeness";

describe("looksLikeMetadataPlaceholder", () => {
  it("detects Bid-Team to confirm", () => {
    assert.equal(looksLikeMetadataPlaceholder("Bid-Team to confirm"), true);
    assert.equal(looksLikeMetadataPlaceholder("Bid Team to confirm"), true);
  });
  it("detects TBC / TBD / placeholder / fill_in", () => {
    assert.equal(looksLikeMetadataPlaceholder("TBC"), true);
    assert.equal(looksLikeMetadataPlaceholder("TBD"), true);
    assert.equal(looksLikeMetadataPlaceholder("placeholder"), true);
    assert.equal(looksLikeMetadataPlaceholder("[fill in]"), true);
  });
  it("does not false-positive on normal values", () => {
    assert.equal(looksLikeMetadataPlaceholder("Ministry of Health"), false);
    assert.equal(looksLikeMetadataPlaceholder("RFP-2026-001"), false);
    assert.equal(looksLikeMetadataPlaceholder(""), false);
    assert.equal(looksLikeMetadataPlaceholder(null), false);
  });
});

describe("stripMetadataPlaceholders", () => {
  it("removes Bid-Team to confirm phrases", () => {
    const out = stripMetadataPlaceholders("Procuring entity: Ministry of Health. Contact: Bid-Team to confirm.");
    assert.ok(!/Bid-Team to confirm/i.test(out));
    assert.match(out, /Ministry of Health/i);
  });
});

describe("assessTenderMetadataCompleteness — screenshot regression (5/16 auto-fill)", () => {
  it("returns blockingForGeneration when critical fields are missing", () => {
    const report = assessTenderMetadataCompleteness({
      clientName: "Ministry of Health",
      title: "Tender for X",
      reference: "Bid-Team to confirm",
      country: null,
      submissionMethod: null,
      submissionAddress: null,
      submissionEmails: null,
      deadline: null,
      clientContactName: "Bid-Team to confirm",
      clientContactEmail: null,
      clientContactPhone: null,
      pageLimit: null,
      budget: null,
      validityDays: null,
      bidBondAmount: null,
      mandatorySiteVisit: null,
      requirementCount: 0,
      hasEvaluationMethodology: false,
      hasSubmissionRules: false,
    });
    assert.equal(report.blockingForGeneration, true);
    assert.ok(report.missingCritical.length >= 4);
    assert.ok(report.placeholderCount >= 2);
    assert.ok(report.overallRatio < 0.5);
  });
  it("returns blockingForGeneration when only placeholders are present", () => {
    const report = assessTenderMetadataCompleteness({
      clientName: "Bid-Team to confirm",
      title: "Tender for X",
      submissionMethod: "Sealed envelope",
      submissionEmails: "submissions@example.com",
      deadline: new Date(),
      requirementCount: 12,
      hasEvaluationMethodology: true,
      technicalWeight: 70,
      financialWeight: 30,
    });
    assert.equal(report.blockingForGeneration, true);
    assert.ok(report.invalidFields.some((f) => f.field === "clientName"));
  });
  it("returns ok=true (no blockingForGeneration) on a fully populated tender", () => {
    const report = assessTenderMetadataCompleteness({
      clientName: "Ministry of Health",
      title: "Consulting services for X",
      reference: "RFP-2026-001",
      country: "Ethiopia",
      submissionMethod: "Sealed envelope",
      submissionAddress: "Addis Ababa, Ethiopia",
      submissionEmails: "submissions@example.com",
      deadline: new Date(),
      clientContactName: "Dr. Alemu",
      clientContactEmail: "alemu@example.com",
      clientContactPhone: "+251 11 555 0123",
      pageLimit: 60,
      budget: 250_000,
      currency: "USD",
      validityDays: 90,
      bidBondAmount: 5_000,
      mandatorySiteVisit: false,
      requirementCount: 18,
      hasEvaluationMethodology: true,
      technicalWeight: 70,
      financialWeight: 30,
    });
    assert.equal(report.blockingForGeneration, false);
    assert.equal(report.invalidFields.length, 0);
    assert.ok(report.overallRatio >= 0.85);
  });
});
