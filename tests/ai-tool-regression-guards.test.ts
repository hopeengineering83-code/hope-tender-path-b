import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("AI tool regression guards", () => {
  it("download route keeps real export gates and file responses", () => {
    const source = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(source.includes("readGeneratedDocumentContent"));
    assert.ok(source.includes("getFinalSubmissionReadiness"));
    assert.ok(source.includes("runAuthorityReview"));
    assert.ok(source.includes("validateFileSignature"));
    assert.ok(source.includes("EXPORT_READINESS_BLOCKED"));
    assert.ok(source.includes("AUTHORITY_REVIEW_BLOCKED"));
    assert.ok(!source.includes("Simplified for audit"));
    assert.ok(!source.includes("return NextResponse.json({ ok: true, docId"));
    assert.ok(!source.includes("return NextResponse.json({ ok: true, tenderId"));
  });

  it("AI rematch and matcher engines keep substantive logic", () => {
    const route = read("app/api/tenders/[id]/ai-rematch/route.ts");
    const matcher = read("lib/engine/ai-multi-perspective-matcher.ts");
    assert.ok(route.includes("aiMultiPerspectiveMatch") || route.includes("multiPerspective"));
    assert.ok(!route.includes("Simplified for audit"));
    assert.ok(matcher.includes("sector") || matcher.includes("Sector"));
    assert.ok(matcher.includes("evidence") || matcher.includes("Evidence"));
    assert.ok(!matcher.includes("return []"));
  });

  it("export readiness keeps document state checks", () => {
    const source = read("lib/engine/export-readiness.ts");
    assert.ok(source.includes("checkExportReadiness"));
    assert.ok(source.includes("isDocumentExportable"));
    assert.ok(source.includes("generationStatus"));
    assert.ok(source.includes("validationStatus"));
    assert.ok(source.includes("reviewStatus"));
  });

  it("generate route keeps empty-vault hard blocker", () => {
    const source = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(source.includes("EMPTY_VAULT"));
    assert.ok(source.includes("reviewed") || source.includes("trustLevel"));
  });
});
