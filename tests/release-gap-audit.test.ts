import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildTenderAnalysisContent,
  computeAnalysisContentHash,
} from "../lib/engine/tender-analysis-content";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("release gap audit regressions", () => {
  it("does not mutate process-wide storage policy during upload requests", () => {
    assert.ok(!source("app/api/tenders/upload-first/route.ts").includes("process.env.ALLOW_DB_FILE_STORAGE ="));
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
    ]) assert.match(source(path), /rateLimitPersistent\(/, path);
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
    assert.match(source("lib/company-asset-security.ts"), /buffer\.length\s*<\s*signature\.length/);
  });

  it("validates AI-returned source file tokens against ACTIVE tender files", () => {
    // DIRECTIVE 2: The validation now lives in lib/ai-jobs/analysis-job-service.ts
    // (mapToDraft function). The legacy /ai-analyze route no longer creates
    // fresh jobs, so the validation is in the durable worker path.
    const service = source("lib/ai-jobs/analysis-job-service.ts");
    assert.ok(service.includes("validSet") || service.includes("validTenderFileIds"),
      "analysis-job-service must validate source file tokens against ACTIVE tender files");
  });

  it("changes the canonical analysis revision when bounded Vault text changes", () => {
    const tender = {
      title: "Tender",
      files: [{ id: "file-1", originalFileName: "tender.pdf", extractedText: "Tender requirements and submission instructions." }],
    };
    const first = computeAnalysisContentHash(buildTenderAnalysisContent(tender, {
      documents: [{ originalFileName: "profile.pdf", category: "COMPANY_PROFILE", extractedText: "Vault version one" }],
    }));
    const second = computeAnalysisContentHash(buildTenderAnalysisContent(tender, {
      documents: [{ originalFileName: "profile.pdf", category: "COMPANY_PROFILE", extractedText: "Vault version two" }],
    }));
    assert.notEqual(first, second);

    const builder = source("lib/engine/tender-analysis-content.ts");
    assert.match(builder, /crypto\.createHash\("sha256"\)\.update\(document\.extractedText\.slice\(0, 10_000\)\)/);
    assert.match(builder, /\[digest:\$\{textDigest\}\]/);
    const route = source("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.match(route, /buildTenderAnalysisContent\(\s*\{ \.\.\.tenderRecord, files:[\s\S]*?company,\s*\)/);
  });
});
