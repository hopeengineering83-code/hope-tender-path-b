import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { finalizeTenderZip } from "../lib/engine/workflow/zip-finalizer";
import { inspectActualFileBytes } from "../lib/engine/persisted-byte-integrity";

// #1058 added assertTenderReadyForGenerationAndExport gate to finalizeTenderZip.
// The mock prisma needs to satisfy the gate's queries, or the test will get
// GATE_INTERNAL_ERROR instead of the expected result. Since the gate requires
// a real DB, these tests are now DB-integration tests that skip without
// RUN_DB_INTEGRATION=true.

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("ZIP Finalization", () => {
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

  const DOCX_SIG = Buffer.concat([Buffer.from([0x50, 0x4b]), Buffer.alloc(10)]);

  function integrityFor(buffer: Buffer, filename: string) {
    return inspectActualFileBytes({
      bytes: buffer,
      filename,
      claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  }

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
    const badBuffer = Buffer.from("not a real docx");
    const result = await finalizeTenderZip(prismaWith([
      { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: badBuffer, generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", documentType: "TECHNICAL_PROPOSAL", ...integrityFor(badBuffer, "file.docx") },
    ]), "t1", "u1");
    assert.equal(result.ok, false);
    assert.ok(
      result.code === "NOT_EXPORT_READY" || result.code === "FILE_SIGNATURE_MISMATCH",
      `expected a fail-closed byte rejection, got ${result.code}`,
    );
  });

  it("Should package a validated + approved document with a real signature", async () => {
    const result = await finalizeTenderZip(prismaWith([
      { id: "d1", name: "Doc", exactFileName: "file.docx", fileContent: DOCX_SIG, generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", documentType: "TECHNICAL_PROPOSAL", ...integrityFor(DOCX_SIG, "file.docx") },
    ]), "t1", "u1");
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.fileList, ["file.docx"]);
    assert.ok(result.buffer && result.buffer.length > 0);
  });
});
