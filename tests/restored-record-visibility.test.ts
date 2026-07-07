import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { hasRestoredInlineFileContent, hasVisibleStoredFile } from "../lib/restored-record-visibility";
import { checkExportReadiness } from "../lib/engine/export-readiness";
import { deriveDocumentOutputState } from "../lib/engine/document-output-state";

const DOCX_HEADER_BASE64 = "UEsDBAoAAAAAA";

describe("restored record visibility", () => {
  it("treats inline CompanyDocument/CompanyAsset/TenderFile content as visible when storagePath is empty", () => {
    const restoredRows = [
      { storagePath: "", fileContent: "Y29tcGFueS1kb2M=" },
      { storagePath: null, fileContent: "YXNzZXQ=" },
      { storagePath: "   ", fileContent: "dGVuZGVyLWZpbGU=" },
    ];

    for (const row of restoredRows) {
      assert.equal(hasRestoredInlineFileContent(row), true);
      assert.equal(hasVisibleStoredFile(row), true);
    }
  });

  it("supports metadata-only inline-content hints so generated-document queries need not load fileContent", () => {
    const restoredGeneratedDocument = {
      name: "Technical Proposal",
      exactFileName: "Technical Proposal.docx",
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      storagePath: "",
      hasInlineFileContent: true,
    };

    assert.equal(hasVisibleStoredFile(restoredGeneratedDocument), true);
    assert.equal(deriveDocumentOutputState(restoredGeneratedDocument), "READY_FOR_EXPORT");
  });

  it("still recognizes generated documents when inline bytes are selected directly", () => {
    const restoredGeneratedDocument = {
      name: "Cover Letter",
      exactFileName: "Cover Letter.docx",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "APPROVED",
      storagePath: "",
      fileContent: DOCX_HEADER_BASE64,
    };

    assert.equal(hasVisibleStoredFile(restoredGeneratedDocument), true);
    assert.equal(deriveDocumentOutputState(restoredGeneratedDocument), "READY_FOR_EXPORT");
  });

  it("does not expose records owned by a different company or tender in restored visibility fixtures", () => {
    const ownerCompanyId = "company-owner";
    const ownerTenderId = "tender-owner";
    const restoredRows = [
      { id: "doc-1", companyId: ownerCompanyId, storagePath: "", fileContent: "YQ==" },
      { id: "asset-1", companyId: ownerCompanyId, storagePath: "", fileContent: "Yg==" },
      { id: "file-1", tenderId: ownerTenderId, storagePath: "", fileContent: "Yw==" },
      { id: "doc-other", companyId: "company-other", storagePath: "", fileContent: "ZA==" },
      { id: "file-other", tenderId: "tender-other", storagePath: "", fileContent: "ZQ==" },
    ];

    const visibleToOwner = restoredRows.filter((row) =>
      (("companyId" in row && row.companyId === ownerCompanyId) || ("tenderId" in row && row.tenderId === ownerTenderId))
      && hasVisibleStoredFile(row),
    );

    assert.deepEqual(visibleToOwner.map((row) => row.id), ["doc-1", "asset-1", "file-1"]);
  });

  it("keeps metadata-only inline hints visible but does not let them bypass strict export byte validation", () => {
    const metadataOnlyDoc = {
      id: "doc-inline",
      name: "Cover Letter",
      exactFileName: "Cover Letter.docx",
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      storagePath: "",
      fileContent: null,
      hasInlineFileContent: true,
    };

    assert.equal(deriveDocumentOutputState(metadataOnlyDoc), "READY_FOR_EXPORT");

    const result = checkExportReadiness([metadataOnlyDoc], { requireFileContent: true });
    assert.equal(result.ok, false);
    assert.match(result.failures[0]?.reasons.join(" "), /fileContent is missing/);
  });

  it("accepts actual restored inline bytes for strict export byte validation", () => {
    const result = checkExportReadiness([{
      id: "doc-inline",
      name: "Cover Letter",
      exactFileName: "Cover Letter.docx",
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      storagePath: "",
      fileContent: DOCX_HEADER_BASE64,
      hasInlineFileContent: true,
    }], { requireFileContent: true });

    assert.equal(result.ok, true);
  });

  it("keeps restored inline hints wired into document archive and tender dashboard APIs", () => {
    const archiveRoute = readFileSync("app/api/documents/route.ts", "utf8");
    assert.match(archiveRoute, /storagePath:\s*true/);
    // Lightweight presence check (IS NOT NULL) instead of expensive char_length scan
    assert.match(archiveRoute, /"fileContent" IS NOT NULL/);
    assert.match(archiveRoute, /hasInlineFileContent/);

    const tenderApiRoute = readFileSync("app/api/tenders/[id]/route.ts", "utf8");
    assert.match(tenderApiRoute, /storagePath:\s*true/);
    assert.match(tenderApiRoute, /"fileContent" IS NOT NULL/);
    assert.match(tenderApiRoute, /hasInlineFileContent/);
  });
});
