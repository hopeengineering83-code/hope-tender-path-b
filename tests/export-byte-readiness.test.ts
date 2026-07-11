import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { checkExportFileByteReadiness } from "../lib/engine/export-byte-readiness";

describe("deep export file-byte readiness", () => {
  it("blocks documents with no inline or storage-backed bytes", async () => {
    const failures = await checkExportFileByteReadiness([
      {
        id: "doc-1",
        name: "Technical Proposal",
        exactFileName: "Technical-Proposal.docx",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent: null,
        storagePath: null,
      },
    ]);

    assert.equal(failures.length, 1);
    assert.match(failures[0].reasons.join(" "), /MISSING_FILE_BYTES/);
  });

  it("blocks mismatched signatures", async () => {
    const plainTextAsBase64 = Buffer.from("not a real docx").toString("base64");
    const failures = await checkExportFileByteReadiness([
      {
        id: "doc-2",
        name: "Official Form",
        exactFileName: "Official-Form.docx",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent: plainTextAsBase64,
        storagePath: null,
      },
    ]);

    assert.equal(failures.length, 1);
    assert.match(failures[0].reasons.join(" "), /FILE_SIGNATURE_MISMATCH/);
  });

  it("passes valid OOXML signatures", async () => {
    const docxBase64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).toString("base64");
    // #1058 added persisted byte integrity verification (requireVerifiedIntegrity: true
    // in checkExportFileByteReadiness). The test doc needs integrityStatus=VERIFIED
    // + matching contentSha256/contentByteLength to pass the integrity check.
    const docxBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const { inspectActualFileBytes } = require("../lib/engine/persisted-byte-integrity");
    const integrity = inspectActualFileBytes({ bytes: docxBuffer, filename: "Technical-Proposal.docx", claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const failures = await checkExportFileByteReadiness([
      {
        id: "doc-3",
        name: "Technical Proposal",
        exactFileName: "Technical-Proposal.docx",
        generationStatus: "GENERATED",
        validationStatus: "VALIDATED",
        reviewStatus: "READY_FOR_EXPORT",
        fileContent: docxBase64,
        storagePath: null,
        ...integrity,
      },
    ]);

    assert.equal(failures.length, 0);
  });
});
