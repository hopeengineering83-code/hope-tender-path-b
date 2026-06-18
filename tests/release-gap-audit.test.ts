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
    const route = source("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.match(route, /createHash\("sha256"\)\.update\(d\.extractedText\.slice\(0, 10_000\)\)/);
    assert.match(route, /\[digest:\$\{textDigest\}\]/);
  });
});
