import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/company/knowledge/repair/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const getStart = source.indexOf("export async function GET");
const postStart = source.indexOf("export async function POST");
const getRegion = source.slice(getStart, postStart);
const postRegion = source.slice(postStart);

describe("company knowledge repair mutation RBAC", () => {
  it("keeps paginated diagnostics GET available to authenticated readers", () => {
    assert.match(getRegion, /getSession\(\)/);
    assert.match(getRegion, /new URL\(req\.url\)/);
    assert.match(getRegion, /buildDiagnostics\(company\.id,\s*\{/);
    assert.match(getRegion, /expertPage: requestedPage\(searchParams, "expertPage"\)/);
    assert.match(getRegion, /projectPage: requestedPage\(searchParams, "projectPage"\)/);
    assert.doesNotMatch(getRegion, /ingestCompanyVault/);
  });

  it("requires ADMIN or PROPOSAL_MANAGER for POST", () => {
    assert.match(postRegion, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(postRegion, /forbiddenResponse\(\)/);
    assert.match(postRegion, /unauthorizedResponse\(\)/);
    assert.doesNotMatch(postRegion, /getSession/);
    assert.doesNotMatch(postRegion, /"REVIEWER"|"VIEWER"/);
  });

  it("uses the role-approved actor for persistent throttling and company scope", () => {
    assert.match(postRegion, /rateLimitPersistent\(`knowledge-repair:\$\{actor\.id\}`/);
    assert.match(postRegion, /getCompany\(actor\.id\)/);
    assert.match(postRegion, /userId: actor\.id/);
  });

  it("enqueues the single canonical ingestion owner via VAULT_INGEST and returns paginated diagnostics", () => {
    // ingestCompanyVault used to run inline in this request; it now runs in
    // the VAULT_INGEST background job (lib/ai-job-handlers.ts) so a large
    // vault's AI extraction pass cannot exceed the request's time budget.
    // The job handler is the one canonical owner — this route must enqueue
    // it, not call ingestCompanyVault directly.
    assert.doesNotMatch(postRegion, /ingestCompanyVault\(/);
    assert.match(postRegion, /enqueueJob\(\{/);
    assert.match(postRegion, /jobType: "VAULT_INGEST"/);
    assert.match(postRegion, /auditAction: "COMPANY_KNOWLEDGE_REPROCESS"/);
    assert.match(postRegion, /buildDiagnostics\(company\.id\)/);
    assert.match(postRegion, /status: "QUEUED", jobId: job\.id, diagnostics/);
  });

  it("returns stable correlated failures on enqueue failure; audit persistence moved to the job handler", () => {
    assert.match(postRegion, /COMPANY_KNOWLEDGE_REPROCESS_FAILED/);
    assert.match(postRegion, /extractRequestId\(req\)/);
    assert.match(postRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(postRegion, /error:\s*(?:error\.message|String\(error\))/);
    // The route no longer logs COMPANY_KNOWLEDGE_REPROCESS itself — the
    // VAULT_INGEST job handler does, once the real outcome is known (see
    // tests/vault-ingest-job.test.ts for real end-to-end coverage of that
    // audit entry, gated on auditAction in the job input).
    assert.doesNotMatch(postRegion, /logAction\(/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
