// Plan B result contract after Company Vault restoration.
//
// The page must keep structured import reporting while presenting the new
// canonical truth:
// - sourceDocuments are staged descriptors, never official documents;
// - restored records are reported distinctly;
// - canonical Company Vault counts are refreshed immediately;
// - official-source links and SOURCE_VERIFIED totals are visible;
// - repeated per-record missing-source warnings are suppressed in favor of
//   one precise company-level blocker.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/company/plan-b-import/page.tsx", "utf8");

describe("Plan B import page reports restored Company Vault truth", () => {
  it("does not join warnings into a single paragraph", () => {
    assert.doesNotMatch(page, /warnings\.join\(["'|]\s*["'|]\s*\)/);
    assert.match(page, /warnings\.slice\(0, 25\)\.map/);
    assert.match(page, /<ul/);
    assert.match(page, /<li/);
  });

  it("labels Plan B sourceDocuments as staging descriptors, not Documents", () => {
    assert.match(page, /Source descriptors staged/);
    assert.match(page, /sourceDocuments<\/code> are staging descriptors, not uploaded files/);
    assert.match(page, /never becomes an official Company Vault document/);
    assert.doesNotMatch(page, /label="Documents"/);
  });

  it("shows a structured per-record-type table with RESTORED counts", () => {
    assert.match(page, /CountRow/);
    assert.match(page, /Record type/);
    assert.match(page, /Received/);
    assert.match(page, /Created/);
    assert.match(page, /Updated/);
    assert.match(page, /Restored/);
    assert.match(page, /Skipped/);
    assert.match(page, /label="Experts"/);
    assert.match(page, /label="Projects"/);
    assert.match(page, /label="Legal records"/);
    assert.match(page, /label="Financial records"/);
    assert.match(page, /label="Compliance records"/);
    assert.match(page, /restored=\{result\.finalized\.restored\?\.experts\}/);
    assert.match(page, /restored=\{result\.finalized\.restored\?\.projects\}/);
  });

  it("keeps the structured legacy response fields used by the result table", () => {
    assert.match(page, /type LegacyImportResult/);
    assert.match(page, /documents\?: RecordCounts/);
    assert.match(page, /experts\?: RecordCounts/);
    assert.match(page, /projects\?: RecordCounts/);
    assert.match(page, /legalRecords\?: RecordCounts/);
    assert.match(page, /financialRecords\?: RecordCounts/);
    assert.match(page, /complianceRecords\?: RecordCounts/);
    assert.match(page, /requestedTrust\?: string/);
    assert.match(page, /persistedTrustRange\?: string\[\]/);
    assert.match(page, /evidenceDowngraded\?: number/);
  });

  it("calls the finalization endpoint and refreshes canonical Company Vault counts", () => {
    assert.match(page, /fetch\("\/api\/company\/plan-b-import\/finalize"/);
    assert.match(page, /fetch\("\/api\/company", \{ cache: "no-store" \}\)/);
    assert.match(page, /Active and visible now:/);
    assert.match(page, /activeCounts\?\.experts/);
    assert.match(page, /activeCounts\?\.projects/);
    assert.match(page, /company-vault-refresh/);
  });

  it("shows official links and source-verification totals separately", () => {
    assert.match(page, /Official links/);
    assert.match(page, /result\.finalized\.linked\?\.total/);
    assert.match(page, /Source verified/);
    assert.match(page, /result\.finalized\.sourceVerified\?\.total/);
  });

  it("renders one company-level missing-source blocker", () => {
    assert.match(page, /Company source blocker/);
    assert.match(page, /result\.finalized\.sourceBlocker/);
    assert.equal((page.match(/Company source blocker/g) ?? []).length, 1);
  });

  it("filters repeated legacy per-record upload-source warnings", () => {
    assert.match(page, /function visibleWarnings/);
    assert.match(page, /could not be source-verified\.\*upload the source document/i);
    assert.match(page, /const warnings = visibleWarnings\(result\?\.imported\.warnings\)/);
  });

  it("keeps validation issues visible as structured list items", () => {
    assert.match(page, /validationIssues/);
    assert.match(page, /validationIssues\.slice\(0, 10\)\.map/);
    assert.match(page, /<strong>\{issue\.path \|\| "payload"\}:<\/strong>/);
  });
});
