// Defect 5 contract test: Plan B import page shows separate import and
// verification results instead of one large warning paragraph.
//
// The page must:
//   1. Render two distinct panels — "Import results" and "Verification results".
//   2. Surface the structured counts the route already returns: documents,
//      experts, projects, legalRecords, financialRecords, complianceRecords.
//   3. Show requestedTrust and persistedTrustRange (not a single trustLevel
//      that could read REVIEWED).
//   4. Split the warnings array into import-level and verification-level
//      buckets and render each as a <ul> of <li> items (not a single
//      paragraph joined by " | ").
//   5. Surface evidenceDowngraded as a distinct count.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/company/plan-b-import/page.tsx", "utf8");

describe("Defect 5 — Plan B import page shows separate import and verification results", () => {
  it("no longer joins warnings into a single paragraph with ' | '", () => {
    // The old pattern was: result.warnings.join(" | ")
    // The new pattern renders each warning as its own <li>.
    assert.doesNotMatch(page, /warnings\.join\(["'|]\s*["'|]\s*\)/);
  });

  it("renders an 'Import results' panel", () => {
    assert.match(page, /Import results/);
  });

  it("renders a 'Verification results' panel distinct from the import panel", () => {
    assert.match(page, /Verification results/);
    // The two headings must both be present — they are in separate
    // <div> panels with different border colors.
    const importIdx = page.indexOf("Import results");
    const verificationIdx = page.indexOf("Verification results");
    assert.ok(importIdx > -1 && verificationIdx > -1);
    assert.ok(verificationIdx > importIdx, "Verification results panel must come after Import results panel");
  });

  it("surfaces the documents count from the route response", () => {
    assert.match(page, /result\.documents/);
  });

  it("surfaces the legalRecords / financialRecords / complianceRecords counts", () => {
    assert.match(page, /result\.legalRecords/);
    assert.match(page, /result\.financialRecords/);
    assert.match(page, /result\.complianceRecords/);
  });

  it("surfaces requestedTrust and persistedTrustRange (not a single trustLevel)", () => {
    assert.match(page, /result\.requestedTrust/);
    assert.match(page, /result\.persistedTrustRange/);
  });

  it("surfaces evidenceDowngraded as a distinct count in the verification panel", () => {
    assert.match(page, /result\.evidenceDowngraded/);
  });

  it("renders import warnings as a <ul> of <li> items (not a joined paragraph)", () => {
    // The import warnings <ul> is rendered inside the Import results panel.
    // Find the panel heading "Import warnings" — it only renders when
    // importWarnings.length > 0.
    const importWarningsIdx = page.indexOf("Import warnings");
    assert.ok(importWarningsIdx > -1, "must have an 'Import warnings' heading");
    const importRegion = page.slice(importWarningsIdx, importWarningsIdx + 1500);
    assert.match(importRegion, /<ul/);
    assert.match(importRegion, /<li/);
    assert.match(importRegion, /importWarnings/);
  });

  it("renders verification warnings as a <ul> of <li> items in the verification panel", () => {
    // Find the "Records downgraded to AI_DRAFT" heading — it only renders
    // when verificationWarnings.length > 0.
    const downgradedIdx = page.indexOf("Records downgraded to AI_DRAFT");
    assert.ok(downgradedIdx > -1, "must have a 'Records downgraded to AI_DRAFT' heading");
    const verificationRegion = page.slice(downgradedIdx, downgradedIdx + 2000);
    assert.match(verificationRegion, /<ul/);
    assert.match(verificationRegion, /<li/);
    assert.match(verificationRegion, /verificationWarnings/);
  });

  it("splits warnings via a splitWarnings helper that classifies by pattern", () => {
    assert.match(page, /function splitWarnings/);
    // The helper must classify "Expert X could not be source-verified" as a
    // verification warning, not an import warning.
    assert.match(page, /could not be source-verified/i);
  });

  it("ImportResult type includes the structured fields the route returns", () => {
    // The type must include documents, legalRecords, financialRecords,
    // complianceRecords, requestedTrust, persistedTrustRange, evidenceDowngraded.
    assert.match(page, /documents\?\:\s*\{\s*received:\s*number;\s*created:\s*number;\s*updated:\s*number;\s*skipped:\s*number\s*\}/);
    assert.match(page, /legalRecords\?\:/);
    assert.match(page, /financialRecords\?\:/);
    assert.match(page, /complianceRecords\?\:/);
    assert.match(page, /requestedTrust\?\:\s*string/);
    assert.match(page, /persistedTrustRange\?\:\s*string\[\]/);
    assert.match(page, /evidenceDowngraded\?\:\s*number/);
  });

  it("renders a per-record-type counts table (not just experts and projects)", () => {
    // The old UI only showed experts and projects counts. The new UI must
    // show a table with all 6 record types.
    assert.match(page, /CountRow/);
    assert.match(page, /label="Documents"/);
    assert.match(page, /label="Experts"/);
    assert.match(page, /label="Projects"/);
    assert.match(page, /label="Legal records"/);
    assert.match(page, /label="Financial records"/);
    assert.match(page, /label="Compliance records"/);
  });
});
