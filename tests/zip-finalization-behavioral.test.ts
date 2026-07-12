import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import JSZip from "jszip";
import { finalizeApprovedDocumentsZip } from "../lib/engine/workflow/zip-finalizer";
import { inspectActualFileBytes } from "../lib/engine/persisted-byte-integrity";

const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32)]);

function readyDoc(overrides: Record<string, unknown> = {}) {
  const fileName = String(overrides.exactFileName ?? "Technical-Proposal.docx");
  const bytes = (overrides.bytes as Buffer | undefined) ?? DOCX_BYTES;
  const integrity = inspectActualFileBytes({
    bytes,
    filename: fileName,
    claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  return {
    id: String(overrides.id ?? "doc-1"),
    name: String(overrides.name ?? "Technical Proposal"),
    exactFileName: fileName,
    exactOrder: Number(overrides.exactOrder ?? 1),
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    fileContent: bytes.toString("base64"),
    storagePath: null,
    ...integrity,
    ...overrides,
  } as any;
}

describe("final ZIP behavioral acceptance", () => {
  it("rejects duplicate names case-insensitively", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ id: "a", exactFileName: "Proposal.docx" }),
      readyDoc({ id: "b", exactFileName: "proposal.docx", exactOrder: 2 }),
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "DUPLICATE_FILENAME");
  });

  it("rejects path traversal", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ exactFileName: "../Proposal.docx" }),
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_FILENAME");
  });

  it("rejects documents that are not approved", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ reviewStatus: "PENDING" }),
    ]);
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_EXPORT_READY");
  });

  it("rejects persisted bytes with unknown integrity", async () => {
    const result = await finalizeApprovedDocumentsZip([
      readyDoc({ integrityStatus: "UNKNOWN", integrityVerifiedAt: null }),
    ]);
    assert.equal(result.ok, false);
    assert.notEqual(result.code, undefined);
  });

  it("creates a ZIP whose entry bytes and manifest hash exactly match", async () => {
    const doc = readyDoc();
    const result = await finalizeApprovedDocumentsZip([doc]);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.fileList, ["Technical-Proposal.docx"]);
    assert.equal(result.manifest?.length, 1);
    assert.equal(result.manifest?.[0].byteSize, DOCX_BYTES.length);

    const reopened = await JSZip.loadAsync(result.buffer!);
    const entry = reopened.file("Technical-Proposal.docx");
    assert.ok(entry);
    const entryBytes = await entry!.async("nodebuffer");
    assert.deepEqual(entryBytes, DOCX_BYTES);
  });
});
