import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("release gap audit regressions", () => {
  it("does not mutate process-wide storage policy during upload requests", () => {
    const route = source("app/api/tenders/upload-first/route.ts");
    assert.ok(!route.includes("process.env.ALLOW_DB_FILE_STORAGE ="));
  });

  it("scopes document review reads and writes to the authenticated tender owner", () => {
    const route = source("app/api/tenders/[id]/documents/[docId]/route.ts");
    assert.match(route, /tender:\s*\{\s*userId:\s*actor\.id\s*\}/);
    assert.match(route, /rateLimitPersistent\(/);
    assert.ok(!route.includes("select: { id: true, name: true, email: true, role: true }"));
  });

  it("scopes document comment reads and mutations to the authenticated tender owner", () => {
    const route = source("app/api/tenders/[id]/documents/[docId]/comments/route.ts");
    assert.match(route, /tender:\s*\{\s*userId:\s*actor\.id\s*\}/);
    assert.match(route, /rateLimitPersistent\(/);
    assert.ok(!route.includes("email: true"));
  });

  it("authorizes AI job access before any stuck-job recovery mutation", () => {
    const route = source("app/api/ai-jobs/[id]/route.ts");
    const accessIndex = route.indexOf("const accessRow");
    const recoveryIndex = route.indexOf("await recoverIfStuck");
    assert.ok(accessIndex >= 0 && recoveryIndex > accessIndex);
    assert.match(route, /accessRow\.userId\s*!==\s*actor\.id/);
  });

  it("protects pricing mutations with persistent limits, tenant scoping, and owned expert references", () => {
    for (const path of [
      "app/api/tenders/[id]/pricing/route.ts",
      "app/api/tenders/[id]/pricing/lines/route.ts",
      "app/api/tenders/[id]/pricing/lines/[lineId]/route.ts",
    ]) {
      assert.match(source(path), /rateLimitPersistent\(/, path);
    }
    const createLine = source("app/api/tenders/[id]/pricing/lines/route.ts");
    const updateLine = source("app/api/tenders/[id]/pricing/lines/[lineId]/route.ts");
    assert.match(createLine, /company:\s*\{\s*userId:\s*actor\.id\s*\}/);
    assert.match(updateLine, /company:\s*\{\s*userId:\s*actor\.id\s*\}/);
    assert.match(createLine, /MAX_TOTAL/);
    assert.match(updateLine, /MAX_TOTAL/);
  });

  it("bounds bulk review input and uses a persistent limiter", () => {
    const route = source("app/api/tenders/[id]/documents/bulk-review/route.ts");
    assert.match(route, /rateLimitPersistent\(/);
    assert.match(route, /MAX_BULK_DOCUMENTS/);
    assert.match(route, /MAX_REVIEW_NOTES/);
  });

  it("fails closed in production when the persistent limiter is unavailable", () => {
    const limiter = source("lib/rate-limit.ts");
    assert.ok(!limiter.includes("$queryRawUnsafe"));
    assert.match(limiter, /RATE_LIMIT_ALLOW_DEGRADED/);
    assert.match(limiter, /production\s*&&\s*!emergencyFailOpen/);
    assert.match(limiter, /allowed:\s*false/);
  });

  it("explicitly rejects company assets shorter than their declared magic signature", () => {
    const security = source("lib/company-asset-security.ts");
    assert.match(security, /buffer\.length\s*<\s*signature\.length/);
  });

  it("validates AI-returned source file tokens before persisting source linkage", () => {
    const route = source("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.match(route, /validTenderFileIds\s*=\s*new Set\(tenderRecord\.files\.map\(\(f\)\s*=>\s*f\.id\)\)/);
    assert.match(route, /validTenderFileIds\.has\(req\.sourceFileToken\)/);
    assert.ok(!route.includes("sourceTenderFileId: req.sourceFileToken ?? null"));
  });

  it("changes AI analysis content hashes when vault text changes", () => {
    // The vault-document digest now lives in the shared content builder
    // (lib/engine/tender-analysis-content.ts), consumed by BOTH the route and
    // the durable job service. The digest still folds vault text into the hash.
    const builder = source("lib/engine/tender-analysis-content.ts");
    assert.match(builder, /createHash\("sha256"\)\.update\(d\.extractedText\.slice\(0, 10_000\)\)/);
    assert.match(builder, /\[digest:\$\{textDigest\}\]/);
    // And the route delegates to the shared builder.
    const route = source("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.match(route, /buildTenderAnalysisContent\(tenderRecord, company\)/);
  });
});
