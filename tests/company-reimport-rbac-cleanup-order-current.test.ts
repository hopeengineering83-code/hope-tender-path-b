import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/company/reimport/route.ts", "utf8");
const cleanup = readFileSync("lib/company-support-doc-cleanup.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("company reimport safety", () => {
  it("requires approved mutation roles with no session-only fallback", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(route, /forbiddenResponse\(\)/);
    assert.match(route, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(route, /getSession/);
    assert.doesNotMatch(route, /"REVIEWER"|"VIEWER"/);
  });

  it("enqueues re-extraction + the single canonical ingestion owner as one background job", () => {
    // Re-extracting bytes for every company document and then ingesting them
    // used to run inline (inspectActualFileBytes -> ingestCompanyVault ->
    // cleanupSupportDocImportedRecords), which could exceed the request's
    // time budget for a large vault. All three now run inside the
    // VAULT_INGEST job handler (lib/ai-job-handlers-legacy.ts, reExtractAll: true)
    // instead — this route only enqueues it.
    const postStart = route.indexOf("export async function POST");
    assert.ok(postStart >= 0);
    const postRegion = route.slice(postStart);
    assert.doesNotMatch(postRegion, /inspectActualFileBytes/);
    assert.doesNotMatch(postRegion, /ingestCompanyVault\(/);
    assert.doesNotMatch(postRegion, /cleanupSupportDocImportedRecords\(/);
    assert.match(postRegion, /enqueueJob\(\{/);
    assert.match(postRegion, /jobType: "VAULT_INGEST"/);
    assert.match(postRegion, /reExtractAll: true/);
    assert.match(postRegion, /auditAction: "COMPANY_KNOWLEDGE_REPAIR"/);
  });

  it("treats mixed/support document handling as a non-destructive audit", () => {
    assert.match(cleanup, /uncertain claim must remain available to the Review Inbox/);
    assert.match(cleanup, /prisma\.expert\.count/);
    assert.match(cleanup, /prisma\.project\.count/);
    assert.match(cleanup, /expertsPreservedForReview/);
    assert.match(cleanup, /projectsPreservedForReview/);
    assert.match(cleanup, /expertsDeleted: 0/);
    assert.match(cleanup, /projectsDeleted: 0/);
    assert.doesNotMatch(cleanup, /deleteMany|\.delete\(/);
  });

  it("keeps every support-evidence audit query company-scoped", () => {
    const scopes = cleanup.match(/companyId/g) ?? [];
    assert.ok(scopes.length >= 4, `expected repeated company scoping, found ${scopes.length}`);
    assert.match(cleanup, /companyId,\s*sourceDocumentId: \{ in: supportDocIds \}/s);
  });

  it("uses persistent throttling and stable correlated runtime errors", () => {
    assert.match(route, /rateLimitPersistent\(`reimport:\$\{actor\.id\}`/);
    assert.match(route, /COMPANY_REIMPORT_FAILED/);
    assert.match(route, /extractRequestId\(req\)/);
    assert.match(route, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(route, /error:\s*(?:error\.message|String\(error\))/);
  });

  it("the audit entry moved to the job handler (real outcome, not a pre-run guess)", () => {
    // The route can no longer log real counts synchronously because
    // ingestion hasn't run yet at response time. lib/ai-job-handlers.ts's
    // VAULT_INGEST handler logs COMPANY_KNOWLEDGE_REPAIR once the job
    // actually completes, gated on the auditAction this route passes in.
    assert.doesNotMatch(route, /logAction\(/);
    // VAULT_INGEST's implementation lives in ai-job-handlers-legacy.ts —
    // lib/ai-job-handlers.ts now only re-exports it and locally overrides
    // EXTRACT_TEXT's getHandler branch.
    const handlers = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");
    assert.match(handlers, /auditAction === "COMPANY_KNOWLEDGE_REPAIR"/);
    assert.match(handlers, /\.catch\(\(error\) => \{/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
