import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/approve-analysis/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("approve-analysis safe runtime errors", () => {
  it("keeps exception-derived detail out of POST and DELETE responses", () => {
    assert.doesNotMatch(source, /sanitizeError/);
    assert.doesNotMatch(source, /detail:\s*(?:error|message|sanitizeError)/);
    assert.doesNotMatch(source, /error:\s*`[^`]*\$\{(?:error|message)/);
    assert.match(source, /ANALYSIS_APPROVAL_RUNTIME_ERROR/);
    assert.match(source, /requestId/);
  });

  it("logs only correlated server-side error class diagnostics", () => {
    assert.match(source, /extractRequestId\(req\)/);
    assert.match(source, /approve-analysis POST failed/);
    assert.match(source, /approve-analysis DELETE failed/);
    assert.match(source, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
  });

  it("keeps fallback approval audit-only and release-blocked", () => {
    assert.match(source, /auditOnly: true/);
    assert.match(source, /does NOT authorize generation, export, download, regeneration, AI proposal, missing-file generation, or ZIP/i);
    assert.match(source, /recordFallbackApproval/);
    assert.match(source, /resolveCurrentAnalysisBinding/);
  });

  it("keeps mutation roles restricted to ADMIN and PROPOSAL_MANAGER", () => {
    const roleMatches = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/g) ?? [];
    assert.equal(roleMatches.length, 2);
    assert.doesNotMatch(source, /requireRole\([^)]*"REVIEWER"/);
    assert.doesNotMatch(source, /requireRole\([^)]*"VIEWER"/);
  });

  it("keeps Vercel Git deployments enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
