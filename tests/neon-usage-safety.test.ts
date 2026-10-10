import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifestPanel = fs.readFileSync(
  "components/final-package-manifest-panel.tsx",
  "utf8",
);
const companyDocsApi = fs.readFileSync(
  "app/api/company/documents/route.ts",
  "utf8",
);
const cleanupCron = fs.readFileSync(
  "app/api/cron/cleanup-old-records/route.ts",
  "utf8",
);

describe("Neon usage safety — no large blob reads in manifest/document queries", () => {
  it("final-package-manifest-panel selects fileContent for deriveDocumentOutputState", () => {
    // fileContent is required: deriveDocumentOutputState returns CONTROL_RECORD_ONLY
    // when both fileContent and storagePath are absent (docs with only fileContent break otherwise)
    assert.match(
      manifestPanel,
      /fileContent\s*:\s*true/,
      "final-package-manifest-panel.tsx must select fileContent so deriveDocumentOutputState works for non-storagePath docs",
    );
  });

  it("company documents API does not select fileContent", () => {
    assert.ok(
      !/fileContent\s*:\s*true/.test(companyDocsApi),
      "company documents API must not select fileContent",
    );
  });

  it("company documents API has an explicit select clause on findMany", () => {
    // Verify the explicit select is present — check both keywords appear in the file
    assert.match(companyDocsApi, /findMany/);
    assert.match(
      companyDocsApi,
      /select\s*:\s*\{[\s\S]*?id\s*:\s*true/,
      "company documents API findMany must have an explicit select clause",
    );
  });

  it("company documents API select includes metadata fields needed for display", () => {
    assert.match(companyDocsApi, /originalFileName\s*:\s*true/);
    assert.match(companyDocsApi, /size\s*:\s*true/);
    assert.match(companyDocsApi, /category\s*:\s*true/);
    assert.match(companyDocsApi, /createdAt\s*:\s*true/);
  });
});

describe("Neon usage safety — AiJob + TenderCopilotMessage cleanup cron", () => {
  it("cleanup cron deletes only terminal AiJob rows — SUCCEEDED, PARTIAL_SUCCESS, FAILED, CANCELED", () => {
    // Must include all four terminal statuses
    assert.match(cleanupCron, /SUCCEEDED/);
    assert.match(cleanupCron, /PARTIAL_SUCCESS/);
    assert.match(cleanupCron, /FAILED/);
    assert.match(cleanupCron, /CANCELED/);
  });

  it("cleanup cron never deletes RUNNING or QUEUED AiJob rows", () => {
    // RUNNING and QUEUED must not appear inside the deleteMany status filter
    // They may appear in comments but not as values in the status filter
    assert.ok(
      !/status.*in.*RUNNING/.test(cleanupCron),
      "cleanup cron must not delete RUNNING jobs",
    );
    assert.ok(
      !/status.*in.*QUEUED/.test(cleanupCron),
      "cleanup cron must not delete QUEUED jobs",
    );
  });

  it("cleanup cron deletes TenderCopilotMessage older than 90 days", () => {
    // Must reference a 90-day cutoff
    assert.match(
      cleanupCron,
      /90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
      "cleanup cron must use a 90-day retention window for TenderCopilotMessage",
    );
    assert.match(cleanupCron, /tenderCopilotMessage\.deleteMany/);
  });

  it("cleanup cron deletes AiJob rows older than 30 days", () => {
    assert.match(
      cleanupCron,
      /30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/,
      "cleanup cron must use a 30-day retention window for AiJob",
    );
    assert.match(cleanupCron, /aiJob\.deleteMany/);
  });

  it("cleanup cron is secured by CRON_SECRET bearer token", () => {
    assert.match(cleanupCron, /CRON_SECRET/);
    assert.match(cleanupCron, /Bearer/);
    assert.match(cleanupCron, /Unauthorized/);
  });

  it("cleanup cron returns deleted counts in response", () => {
    assert.match(cleanupCron, /deleted/);
    assert.match(cleanupCron, /aiJobs/);
    assert.match(cleanupCron, /copilotMessages/);
  });

  it("cleanup cron wraps DB operations in try/catch and returns 500 on error", () => {
    assert.match(cleanupCron, /try\s*\{/);
    assert.match(cleanupCron, /catch/);
    assert.match(cleanupCron, /status:\s*500/);
  });
});
