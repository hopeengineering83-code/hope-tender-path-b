import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasRestoredInlineFileContent, hasVisibleStoredFile } from "../lib/restored-record-visibility";
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
});
