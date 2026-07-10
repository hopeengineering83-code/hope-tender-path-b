import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { finalizeTenderZip } from "../lib/engine/workflow/zip-finalizer";

describe("ZIP Finalization", () => {
  it("Should reject duplicate filenames", async () => {
    const mockTender = {
      id: "t1",
      userId: "u1",
      generatedDocuments: [
        { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: Buffer.from("abc"), generationStatus: "GENERATED", documentType: "TECHNICAL_PROPOSAL" },
        { id: "d2", name: "Doc", exactFileName: "file.docx", fileContent: Buffer.from("def"), generationStatus: "GENERATED", documentType: "TECHNICAL_PROPOSAL" },
      ]
    };

    const mockPrisma = {
      tender: {
        findFirst: async () => mockTender,
      }
    };

    const result = await finalizeTenderZip(mockPrisma as any, "t1", "u1");
    assert.equal(result.ok, false);
    assert.equal(result.code, "DUPLICATE_FILENAME");
  });

  it("Should reject path traversal", async () => {
    const mockTender = {
      id: "t1",
      userId: "u1",
      generatedDocuments: [
        { id: "d1", name: "Doc", exactFileName: "../etc/passwd", fileContent: Buffer.from("abc"), generationStatus: "GENERATED", documentType: "TECHNICAL_PROPOSAL" },
      ]
    };

    const mockPrisma = {
      tender: {
        findFirst: async () => mockTender,
      }
    };

    const result = await finalizeTenderZip(mockPrisma as any, "t1", "u1");
    assert.equal(result.ok, false);
    assert.equal(result.code, "INVALID_FILENAME");
  });

  // Hardened per-document invariants — same rules as the canonical download
  // route: validated + approved + real byte signature. The helper must never
  // be a weaker side door into a final ZIP.
  const DOCX_SIG = Buffer.concat([Buffer.from([0x50, 0x4b]), Buffer.alloc(10)]);

  function prismaWith(docs: unknown[]) {
    return {
      tender: { findFirst: async () => ({ id: "t1", userId: "u1", generatedDocuments: docs }) },
    } as never;
  }

  it("Should reject a document that is not validated + approved (NOT_EXPORT_READY)", async () => {
    const result = await finalizeTenderZip(prismaWith([
      { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: DOCX_SIG, generationStatus: "GENERATED", validationStatus: "PENDING", reviewStatus: "PENDING", documentType: "TECHNICAL_PROPOSAL" },
    ]), "t1", "u1");
    assert.equal(result.ok, false);
    assert.equal(result.code, "NOT_EXPORT_READY");
  });

  it("Should reject bytes that do not match the extension signature (fail-closed)", async () => {
    const result = await finalizeTenderZip(prismaWith([
      { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: Buffer.from("not a real docx"), generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", documentType: "TECHNICAL_PROPOSAL" },
    ]), "t1", "u1");
    assert.equal(result.ok, false);
    // The output-state machine catches non-DOCX bytes first (NOT_EXPORT_READY);
    // the explicit signature check remains as defense-in-depth. Either way the
    // bytes must never enter the ZIP.
    assert.ok(
      result.code === "NOT_EXPORT_READY" || result.code === "FILE_SIGNATURE_MISMATCH",
      `expected a fail-closed byte rejection, got ${result.code}`,
    );
  });

  it("Should package a validated + approved document with a real signature", async () => {
    const result = await finalizeTenderZip(prismaWith([
      { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: DOCX_SIG, generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", documentType: "TECHNICAL_PROPOSAL" },
    ]), "t1", "u1");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.fileList, ["file.docx"]);
    assert.ok(result.buffer && result.buffer.length > 0);
  });
});
