// Verifies that large blob/text fields (extractedText, fileContent) are not
// loaded in list or dashboard endpoints where they would waste memory and
// bandwidth. These fields can be MB-scale per document and must only appear
// in single-document fetch/download paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

function readRoute(relPath: string): string {
  return existsSync(relPath) ? readFileSync(relPath, "utf-8") : "";
}

describe("Large fields excluded from list/dashboard endpoints", () => {
  it("company documents list does not select extractedText", () => {
    const src = readRoute("app/api/company/documents/route.ts");
    assert.ok(src.length > 0, "company documents route must exist");
    assert.ok(
      !/extractedText\s*:\s*true/.test(src),
      "company documents list must not select extractedText",
    );
  });

  it("tender list route does not select fileContent", () => {
    const src = readRoute("app/api/tenders/route.ts");
    assert.ok(src.length > 0, "tenders list route must exist");
    assert.ok(
      !/fileContent\s*:\s*true/.test(src),
      "tender list route must not select fileContent",
    );
  });

  it("tender detail route does not select fileContent from generatedDocuments", () => {
    const src = readRoute("app/api/tenders/[id]/route.ts");
    assert.ok(src.length > 0, "tender detail route must exist");
    // generatedDocumentDashboardSelect should not include fileContent
    assert.ok(
      !/fileContent\s*:\s*true/.test(src),
      "tender detail route must not select fileContent from generatedDocuments",
    );
  });

  it("readiness score endpoint does not load document content", () => {
    const src = readRoute("app/api/tenders/[id]/readiness-score/route.ts");
    if (src) {
      assert.ok(
        !/fileContent\s*:\s*true/.test(src),
        "readiness score endpoint must not select fileContent",
      );
      assert.ok(
        !/extractedText\s*:\s*true/.test(src),
        "readiness score endpoint must not select extractedText",
      );
    }
  });
  it("final submission readiness conditionally loads document content only when explicitly required", () => {
    const src = readRoute("lib/engine/final-submission-readiness.ts");
    assert.ok(src.length > 0, "final submission readiness helper must exist");
    assert.match(src, /const shouldLoadFileContent = opts\.requireFileContent \?\? false/);
    assert.match(src, /fileContent:\s*shouldLoadFileContent/);
    assert.doesNotMatch(
      src,
      /fileContent:\s*true/,
      "final submission readiness must not unconditionally select generatedDocument.fileContent",
    );
  });

  it("tender detail page reuses precomputed generation readiness instead of rendering a second DB query", () => {
    const pageSrc = readRoute("app/dashboard/tenders/[id]/page.tsx");
    const panelSrc = readRoute("components/generation-readiness-panel.tsx");
    assert.match(pageSrc, /<GenerationReadinessPanel tenderId=\{tender\.id\} readiness=\{generationReadiness\} \/>/);
    assert.match(panelSrc, /readiness:\s*providedReadiness/);
    assert.match(panelSrc, /providedReadiness\s*===\s*undefined/);
  });

});
