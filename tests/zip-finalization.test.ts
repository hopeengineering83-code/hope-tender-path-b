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
});
