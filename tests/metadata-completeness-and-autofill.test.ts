// Coverage-ratio reclassification + auto-fill expansion source-level tests.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessTenderMetadataCompleteness } from "../lib/engine/metadata/tender-metadata-completeness";

describe("Coverage ratio no longer punishes missing budget / bidBondAmount", () => {
  it("a tender with everything except budget+bidBond hits 100% — not 86%", () => {
    const r = assessTenderMetadataCompleteness({
      clientName: "Pharo Foundation",
      title: "Health-sector consultancy",
      reference: "PHARO-2026-001",
      country: "Ethiopia",
      submissionMethod: "PORTAL",
      submissionAddress: "Addis Ababa, Ethiopia",
      submissionEmails: "procurement@pharo.org",
      deadline: new Date("2026-09-12T14:00:00Z"),
      clientContactName: "Procurement Lead",
      clientContactEmail: "lead@pharo.org",
      clientContactPhone: "+251 11 555 0000",
      pageLimit: 25,
      validityDays: 90,
      mandatorySiteVisit: true,
      // budget + bidBondAmount intentionally omitted — financial-only.
      requirementCount: 12,
      hasEvaluationMethodology: true,
      hasSubmissionRules: true,
    });
    assert.equal(r.overallRatio, 1, "tender with no budget should still hit 100% coverage");
    // Budget/bidBond remain in missingNonCritical so they show as warnings —
    // but don't block generation.
    assert.equal(r.blockingForGeneration, false);
  });

  it("budget + bidBondAmount remain non-critical warnings (not blockers)", () => {
    const r = assessTenderMetadataCompleteness({
      clientName: "Acme",
      title: "Consulting",
      submissionMethod: "EMAIL",
      submissionEmails: "bids@acme.org",
      deadline: new Date(),
      requirementCount: 5,
      hasEvaluationMethodology: true,
      hasSubmissionRules: true,
    });
    const budgetFinding = r.missingNonCritical.find((f) => f.field === "budget");
    const bidBondFinding = r.missingNonCritical.find((f) => f.field === "bidBond");
    assert.ok(budgetFinding, "budget should still surface as a non-critical warning");
    assert.ok(bidBondFinding, "bidBond should still surface as a non-critical warning");
    assert.equal(r.blockingForGeneration, false);
  });
});

describe("Source-level wiring assertions", () => {
  it("tender-metadata-completeness drops budget + bidBondAmount from the ratio denominator", () => {
    const src = readFileSync("lib/engine/tender-metadata-completeness.ts", "utf8");
    // The new tracked array must NOT contain `input.budget` or `input.bidBondAmount`.
    const trackedBlock = src.match(/const tracked: Array<unknown> = \[[\s\S]*?\];/);
    assert.ok(trackedBlock, "tracked array block must be present");
    assert.doesNotMatch(trackedBlock![0], /input\.budget\b/);
    assert.doesNotMatch(trackedBlock![0], /input\.bidBondAmount\b/);
    // But cross-tender fields stay in the denominator.
    assert.match(trackedBlock![0], /input\.pageLimit\b/);
    assert.match(trackedBlock![0], /input\.validityDays\b/);
    assert.match(trackedBlock![0], /input\.mandatorySiteVisit\b/);
  });

  it("auto-fill helper now also fills submissionEmails / pageLimit / validityDays / bidBond* / copies / siteVisit", () => {
    const src = readFileSync("lib/engine/auto-fill-tender-metadata.ts", "utf8");
    for (const field of [
      "submissionEmails", "validityDays", "pageLimit",
      "bidBondAmount", "bidBondCurrency", "numberOfCopiesRequired", "mandatorySiteVisit",
    ]) {
      assert.match(src, new RegExp(`tryFill\\("${field}"|patch\\["${field}"\\]`), `${field} must be wired into the auto-fill patch`);
    }
  });
});

describe("repair-metadata endpoint now dispatches the multi-field extractor framework", () => {
  const src = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

  it("imports SUPPORTED_EXTRACTORS + runExtractorByField", () => {
    assert.match(src, /SUPPORTED_EXTRACTORS,\s*runExtractorByField/);
  });

  it("includes the framework fields in SUPPORTED_FIELDS", () => {
    assert.match(src, /SUPPORTED_FIELDS = \["evaluationMethodology",\s*\.\.\.SUPPORTED_EXTRACTORS\]/);
  });

  it("never overwrites populated values without force:true ADMIN", () => {
    assert.match(src, /alreadyPopulated\s*&&\s*!force/);
    assert.match(src, /\.force === true && actor\.role === "ADMIN"/);
  });

  it("bidBondAmount splits into amount + currency persistence", () => {
    assert.match(src, /v\.amount\s*>\s*0\s*&&\s*v\.currency\s*!==\s*"PERCENT"/);
    assert.match(src, /\.bidBondAmount = v\.amount/);
    assert.match(src, /\.bidBondCurrency = v\.currency/);
  });

  it("each repair logs TENDER_METADATA_REPAIRED with source/confidence/quote", () => {
    assert.match(src, /action:\s*"TENDER_METADATA_REPAIRED"/);
    assert.match(src, /extractionSource:\s*"DETERMINISTIC_SOURCE_EXTRACTOR"/);
    assert.match(src, /sourceQuote:\s*extraction\.sourceQuote/);
  });
});
