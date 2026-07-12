import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { finalizeApprovedDocumentsZip } from "../lib/engine/workflow/zip-finalizer";
import {
  computeByteSha256,
  inspectActualFileBytes,
} from "../lib/engine/persisted-byte-integrity";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_BYTES_A = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("technical-proposal-current-bytes"),
]);
const DOCX_BYTES_B = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("financial-proposal-current-bytes"),
]);

function readyDoc(
  overrides: Record<string, unknown> = {},
) {
  const fileName = String(overrides.exactFileName ?? "Technical-Proposal.docx");
  const bytes = (overrides.bytes as Buffer | undefined) ?? DOCX_BYTES_A;
  const integrity = inspectActualFileBytes({
    bytes,
    filename: fileName,
    claimedMimeType: fileName.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : DOCX_MIME,
  });

  return {
    id: String(overrides.id ?? "doc-1"),
    name: String(overrides.name ?? "Technical Proposal"),
    exactFileName: fileName,
    exactOrder: Number(overrides.exactOrder ?? 1),
    documentType: String(overrides.documentType ?? "TECHNICAL_PROPOSAL"),
    format: String(overrides.format ?? "DOCX"),
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    fileContent: bytes.toString("base64"),
    storagePath: null,
    ...integrity,
    ...overrides,
  } as any;
}

describe("current final ZIP behavioral acceptance", () => {
  it("rejects an empty final document set", async () => {
    const result = await finalizeApprovedDocumentsZip([]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "NO_DOCUMENTS");
  });

  it("rejects duplicate filenames case-insensitively", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ id: "doc-a", exactFileName: "Proposal.docx" }),
      readyDoc({ id: "doc-b", exactFileName: "proposal.docx", exactOrder: 2 }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, "DUPLICATE_FILENAME");
  });

  it("rejects path traversal and platform path separators", async () => {
    const traversal = await finalizeApprovedDocumentsZip([
      readyDoc({ exactFileName: "../Proposal.docx" }),
    ]);
    assert.equal(traversal.ok, false);
    assert.equal(traversal.code, "INVALID_FILENAME");

    const windowsPath = await finalizeApprovedDocumentsZip([
      readyDoc({ exactFileName: "folder\\Proposal.docx" }),
    ]);
    assert.equal(windowsPath.ok, false);
    assert.equal(windowsPath.code, "INVALID_FILENAME");
  });

  it("rejects a document that has not passed validation and approval", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ reviewStatus: "PENDING" }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_EXPORT_READY");
  });

  it("rejects a persisted digest that does not match the actual bytes", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ contentSha256: "0".repeat(64) }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, "PERSISTED_BYTE_INTEGRITY_MISMATCH");
  });

  it("rejects extension/byte-format mismatch before archive assembly", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({
        exactFileName: "Technical-Proposal.pdf",
        format: "PDF",
        contentSha256: computeByteSha256(DOCX_BYTES_A),
        contentByteLength: DOCX_BYTES_A.length,
        contentMimeType: DOCX_MIME,
        detectedFormat: "DOCX",
        integrityStatus: "VERIFIED",
        integrityFailureCode: null,
      }),
    ]);

    assert.equal(result.ok, false);
    // The document-output state rejects the contradictory format/integrity
    // record before the later byte-signature check can run. This is the stricter
    // fail-closed ordering and must remain stable.
    assert.equal(result.code, "NOT_EXPORT_READY");
  });

  it("creates an ordered ZIP whose reopened entries exactly match persisted bytes", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({
        id: "financial",
        name: "Financial Proposal",
        exactFileName: "Financial-Proposal.docx",
        exactOrder: 2,
        documentType: "FINANCIAL_PROPOSAL",
        bytes: DOCX_BYTES_B,
      }),
      readyDoc({
        id: "technical",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        bytes: DOCX_BYTES_A,
      }),
    ]);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.fileList, [
      "Technical-Proposal.docx",
      "Financial-Proposal.docx",
    ]);
    assert.equal(result.manifest?.length, 2);
    assert.deepEqual(
      result.manifest?.map((entry) => entry.order),
      [1, 2],
    );
    assert.equal(result.manifest?.[0].byteSize, DOCX_BYTES_A.length);
    assert.equal(result.manifest?.[0].sha256, computeByteSha256(DOCX_BYTES_A));
    assert.equal(result.manifest?.[1].byteSize, DOCX_BYTES_B.length);
    assert.equal(result.manifest?.[1].sha256, computeByteSha256(DOCX_BYTES_B));

    const reopened = await JSZip.loadAsync(result.buffer!);
    const technical = await reopened
      .file("Technical-Proposal.docx")!
      .async("nodebuffer");
    const financial = await reopened
      .file("Financial-Proposal.docx")!
      .async("nodebuffer");

    assert.deepEqual(technical, DOCX_BYTES_A);
    assert.deepEqual(financial, DOCX_BYTES_B);
    assert.deepEqual(
      Object.keys(reopened.files).filter((name) => !reopened.files[name].dir),
      ["Technical-Proposal.docx", "Financial-Proposal.docx"],
    );
  });
});
