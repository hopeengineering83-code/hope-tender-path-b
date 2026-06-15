// Regression tests for quality gap fixes — Phase 20.
//
// Phase 20 covers three targeted hardening improvements:
//
//   1. Extraction quality gate threshold alignment:
//      EXPORT_BLOCK_SCORE raised from 20 → 40 so export cannot proceed
//      on extraction quality that would have blocked generation.
//
//   2. CLAUDE.md entity fields added to metadata completeness:
//      legalClientName, donorAgency, implementingAgency, clientAddress
//      are now tracked as non-critical warnings (CLAUDE.md items 2–4, 9).
//      Placeholder values in these fields are flagged and counted.
//
//   3. Source traceability tolerance tightened:
//      Mandatory-requirement untraced threshold lowered from 20% → 10%.
//      The old tolerance allowed 4 of 5 critical requirements to be
//      untraceable before raising a blocker.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isExtractionAcceptableForExport, isExtractionAcceptableForGeneration } from "../lib/engine/quality/extraction-quality-gate";
import { assessTenderMetadataCompleteness } from "../lib/engine/metadata/tender-metadata-completeness";
import { readFileSync } from "node:fs";

// ── 1. Extraction threshold alignment ────────────────────────────────────────

describe("phase 20 — extraction threshold alignment (export = generation)", () => {
  it("export blocks on extractionScore of 39 (below new threshold)", () => {
    const files = [{ extractionScore: 39, totalPages: 10, extractedPages: 9, ocrPages: 0, failedPages: 0 }];
    assert.equal(
      isExtractionAcceptableForExport(files as any),
      false,
      "export must block when extractionScore < 40 (was only blocking < 20 before phase 20)",
    );
  });

  it("export allows on extractionScore of 40 with full page coverage (at new threshold)", () => {
    // extractedPages must equal totalPages to pass the incomplete-page-coverage gate
    const files = [{ extractionScore: 40, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
    assert.equal(
      isExtractionAcceptableForExport(files as any),
      true,
      "export must allow when extractionScore = 40 and all pages extracted",
    );
  });

  it("generation also blocks on extractionScore of 39 (unchanged)", () => {
    const files = [{ extractionScore: 39, totalPages: 10, extractedPages: 9, ocrPages: 0, failedPages: 0 }];
    assert.equal(
      isExtractionAcceptableForGeneration(files as any),
      false,
      "generation threshold (40) must remain unchanged",
    );
  });

  it("export and generation now share the same threshold (both block at < 40)", () => {
    for (const score of [0, 10, 20, 30, 39]) {
      const files = [{ extractionScore: score, totalPages: 5, extractedPages: 4, ocrPages: 0, failedPages: 0 }];
      assert.equal(isExtractionAcceptableForExport(files as any), false, `export must block at score ${score}`);
      assert.equal(isExtractionAcceptableForGeneration(files as any), false, `generation must block at score ${score}`);
    }
  });

  it("EXPORT_BLOCK_SCORE is 40 in source (static audit)", () => {
    const src = readFileSync("lib/engine/extraction-quality-gate.ts", "utf8");
    assert.ok(
      src.includes("const EXPORT_BLOCK_SCORE = 40"),
      "EXPORT_BLOCK_SCORE must be 40 to match CRITICALLY_FAILED_SCORE",
    );
    assert.ok(
      !src.includes("const EXPORT_BLOCK_SCORE = 20"),
      "old EXPORT_BLOCK_SCORE of 20 must not remain",
    );
  });
});

// ── 2. CLAUDE.md entity fields in metadata completeness ─────────────────────

describe("phase 20 — CLAUDE.md entity fields in metadata completeness", () => {
  it("legalClientName tracked as non-critical when missing", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingNonCritical.some((f) => f.field === "legalClientName");
    assert.ok(found, "legalClientName must appear in missingNonCritical when not provided");
  });

  it("donorAgency tracked as non-critical when missing", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingNonCritical.some((f) => f.field === "donorAgency");
    assert.ok(found, "donorAgency must appear in missingNonCritical when not provided");
  });

  it("implementingAgency tracked as non-critical when missing", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingNonCritical.some((f) => f.field === "implementingAgency");
    assert.ok(found, "implementingAgency must appear in missingNonCritical when not provided");
  });

  it("clientAddress tracked as non-critical when missing", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
    } as any);
    const found = result.missingNonCritical.some((f) => f.field === "clientAddress");
    assert.ok(found, "clientAddress must appear in missingNonCritical when not provided");
  });

  it("legalClientName placeholder detected and counted", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
      legalClientName: "Bid-Team to confirm",
    } as any);
    assert.ok(result.placeholderCount >= 1, "placeholder in legalClientName must increment placeholderCount");
    const found = result.invalidFields.some((f) => f.field === "legalClientName");
    assert.ok(found, "legalClientName with placeholder must appear in invalidFields");
  });

  it("donorAgency placeholder detected and counted", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Test Tender",
      clientName: "Client Co",
      submissionMethod: "Email",
      submissionEmails: "tender@client.com",
      deadline: new Date(Date.now() + 86400000),
      donorAgency: "TBD",
    } as any);
    assert.ok(result.placeholderCount >= 1, "placeholder in donorAgency must increment placeholderCount");
    const found = result.invalidFields.some((f) => f.field === "donorAgency");
    assert.ok(found, "donorAgency with TBD placeholder must appear in invalidFields");
  });

  it("provided entity fields do not appear in missingNonCritical", () => {
    const result = assessTenderMetadataCompleteness({
      title: "Water Supply Project",
      clientName: "Ministry of Water",
      submissionMethod: "Sealed envelope",
      submissionAddress: "P.O. Box 100, Addis Ababa",
      deadline: new Date(Date.now() + 86400000),
      legalClientName: "Federal Democratic Republic of Ethiopia, MoWIE",
      donorAgency: "World Bank",
      implementingAgency: "Addis Ababa Water and Sewerage Authority",
      clientAddress: "Churchill Road, Addis Ababa, Ethiopia",
    } as any);
    const entityFields = ["legalClientName", "donorAgency", "implementingAgency", "clientAddress"];
    for (const field of entityFields) {
      const inMissing = result.missingNonCritical.some((f) => f.field === field);
      assert.ok(!inMissing, `${field} with valid value must not appear in missingNonCritical`);
    }
  });
});

// ── 3. Source traceability threshold tightened to 10% ────────────────────────

describe("phase 20 — source traceability tolerance tightened 20% → 10%", () => {
  it("threshold is 0.1 (10%) in source (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    // New threshold
    assert.ok(
      src.includes("missingRatio > 0.1"),
      "source traceability threshold must be > 0.1 (10%) after phase 20",
    );
    // Old threshold must not remain
    assert.ok(
      !src.includes("missingRatio > 0.2"),
      "old 20% threshold must be removed",
    );
  });

  it("comment reflects new 10% threshold", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("10%"),
      "comment must mention the new 10% threshold",
    );
  });
});

// ── 4. Regression: existing extraction gates unchanged ───────────────────────

describe("phase 20 — regression: existing extraction gate behaviour preserved", () => {
  it("generation still blocks on score 0", () => {
    const files = [{ extractionScore: 0, totalPages: 0, extractedPages: 0, ocrPages: 0, failedPages: 1 }];
    assert.equal(isExtractionAcceptableForGeneration(files as any), false);
  });

  it("generation still allows on score 95 with no failed pages", () => {
    const files = [{ extractionScore: 95, totalPages: 10, extractedPages: 10, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForGeneration(files as any), true);
  });

  it("export still blocks when files array is empty", () => {
    assert.equal(isExtractionAcceptableForExport([]), false);
  });

  it("export still blocks when totalPages is unknown (null)", () => {
    const files = [{ extractionScore: 90, totalPages: null, extractedPages: 5, ocrPages: 0, failedPages: 0 }];
    assert.equal(isExtractionAcceptableForExport(files as any), false);
  });

  it("export still blocks when any file has failedPages > 0", () => {
    const files = [{ extractionScore: 90, totalPages: 10, extractedPages: 9, ocrPages: 0, failedPages: 1 }];
    assert.equal(isExtractionAcceptableForExport(files as any), false);
  });
});
