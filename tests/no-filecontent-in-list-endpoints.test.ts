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
    // generatedDocumentDashboardSelect should not include fileContent.
    // The DELETE handler's blob-cleanup select (reads fileContent before the
    // rows are deleted so blobs can be removed) is a legitimate non-dashboard
    // use — pin the GET/PUT portion only.
    const dashboardPortion = src.split("export async function DELETE")[0];
    assert.ok(
      !/fileContent\s*:\s*true/.test(dashboardPortion),
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

    // The tender-wide projection must stay conditional — that is the blob-size
    // property this test exists for. A separate, id-scoped load is not the same
    // thing: the quality gate must read the bytes of the documents it is about
    // to judge, and scoring a row whose content was deliberately not selected
    // produced "3 generated document(s) failed the quality gate" about
    // documents the Document Validator scores 100/100, because no content was
    // consulted at all. Forbidding the literal `fileContent: true` anywhere in
    // the module would forbid reading bytes even for a handful of rows, which
    // is not what "exclude large fields from list endpoints" means.
    for (const match of src.matchAll(/fileContent:\s*true/g)) {
      const window = src.slice(Math.max(0, match.index - 400), match.index);
      assert.match(
        window,
        /where:\s*\{\s*id:\s*\{\s*in:/,
        "any explicit fileContent load must be scoped to an explicit list of document ids",
      );
    }
  });

  it("tender detail page reuses precomputed generation readiness instead of rendering a second DB query", () => {
    const pageSrc = readRoute("app/dashboard/tenders/[id]/page.tsx");
    const panelSrc = readRoute("components/generation-readiness-panel.tsx");
    assert.match(pageSrc, /<GenerationReadinessPanel tenderId=\{tender\.id\} readiness=\{generationReadiness\} \/>/);
    assert.match(panelSrc, /readiness:\s*providedReadiness/);
    assert.match(panelSrc, /providedReadiness\s*===\s*undefined/);
  });

});
