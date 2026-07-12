import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  persistGeneratedDocumentContent,
} from "../lib/generated-document-content";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("generated-document-storage-compensation"),
]);

type Call = { storagePath?: string | null; fileContent?: string | null; fileName: string };

function harness(options: {
  previousStoragePath?: string | null;
  savedStoragePath?: string;
  savedFileContent?: string;
  updateError?: Error;
  deleteError?: Error;
  missingDocument?: boolean;
} = {}) {
  const calls = {
    findUnique: 0,
    update: 0,
    put: 0,
    deletes: [] as Call[],
    updateArgs: null as unknown,
  };

  const prismaClient = {
    generatedDocument: {
      async findUnique() {
        calls.findUnique += 1;
        if (options.missingDocument) return null;
        return {
          id: "doc-1",
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.docx",
          storagePath: options.previousStoragePath ?? null,
        };
      },
      async update(args: unknown) {
        calls.update += 1;
        calls.updateArgs = args;
        if (options.updateError) throw options.updateError;
        return { id: "doc-1" };
      },
    },
  };

  const storageAdapter = {
    async putFile() {
      calls.put += 1;
      return {
        storagePath: options.savedStoragePath ?? "blob://new-object.docx",
        fileContent: options.savedFileContent,
        provider: options.savedFileContent ? "db-base64" as const : "blob" as const,
      };
    },
    async getFile() {
      throw new Error("not used");
    },
    async deleteFile(record: Call) {
      calls.deletes.push(record);
      if (options.deleteError) throw options.deleteError;
    },
  };

  return { calls, prismaClient, storageAdapter };
}

async function persist(h: ReturnType<typeof harness>) {
  return persistGeneratedDocumentContent({
    docId: "doc-1",
    buffer: DOCX_BYTES,
    filename: "Technical-Proposal.docx",
    mimeType: DOCX_MIME,
    prismaClient: h.prismaClient as any,
    storageAdapter: h.storageAdapter as any,
  });
}

describe("generated document storage compensation", () => {
  it("deletes the newly uploaded object when the database rejects the update", async () => {
    const updateError = new Error("database write failed");
    const h = harness({ updateError, savedStoragePath: "blob://new-object.docx" });

    await assert.rejects(() => persist(h), updateError);

    assert.equal(h.calls.findUnique, 1);
    assert.equal(h.calls.put, 1);
    assert.equal(h.calls.update, 1);
    assert.deepEqual(h.calls.deletes, [{
      storagePath: "blob://new-object.docx",
      fileContent: null,
      fileName: "Technical-Proposal.docx",
    }]);
  });

  it("preserves the original database error even when compensation cleanup also fails", async () => {
    const updateError = new Error("database write failed");
    const h = harness({
      updateError,
      deleteError: new Error("cleanup failed"),
      savedStoragePath: "blob://new-object.docx",
    });

    await assert.rejects(
      () => persist(h),
      (error: unknown) => error === updateError,
    );
    assert.equal(h.calls.deletes.length, 1);
  });

  it("deletes the replaced external object only after the new row is durable", async () => {
    const h = harness({
      previousStoragePath: "blob://old-object.docx",
      savedStoragePath: "blob://new-object.docx",
    });

    const result = await persist(h);

    assert.equal(result.storagePath, "blob://new-object.docx");
    assert.equal(result.bytes, DOCX_BYTES.length);
    assert.equal(result.integrity.integrityStatus, "VERIFIED");
    assert.equal(h.calls.update, 1);
    assert.deepEqual(h.calls.deletes, [{
      storagePath: "blob://old-object.docx",
      fileContent: null,
      fileName: "Technical-Proposal.docx",
    }]);
  });

  it("does not delete when the provider reuses the same external path", async () => {
    const h = harness({
      previousStoragePath: "blob://same-object.docx",
      savedStoragePath: "blob://same-object.docx",
    });

    await persist(h);
    assert.deepEqual(h.calls.deletes, []);
  });

  it("does not perform external cleanup for database-base64 replacement", async () => {
    const inline = DOCX_BYTES.toString("base64");
    const h = harness({
      previousStoragePath: null,
      savedStoragePath: "",
      savedFileContent: inline,
    });

    const result = await persist(h);

    assert.equal(result.fileContent, inline);
    assert.deepEqual(h.calls.deletes, []);
  });

  it("fails before upload when the generated document row does not exist", async () => {
    const h = harness({ missingDocument: true });

    await assert.rejects(() => persist(h), /GENERATED_DOCUMENT_NOT_FOUND/);
    assert.equal(h.calls.findUnique, 1);
    assert.equal(h.calls.put, 0);
    assert.equal(h.calls.update, 0);
    assert.deepEqual(h.calls.deletes, []);
  });

  it("fails invalid bytes before database lookup or storage upload", async () => {
    const h = harness();

    await assert.rejects(
      () => persistGeneratedDocumentContent({
        docId: "doc-1",
        buffer: Buffer.from("not a docx"),
        filename: "Technical-Proposal.docx",
        mimeType: DOCX_MIME,
        prismaClient: h.prismaClient as any,
        storageAdapter: h.storageAdapter as any,
      }),
      /FILE_SIGNATURE_MISMATCH/,
    );

    assert.equal(h.calls.findUnique, 0);
    assert.equal(h.calls.put, 0);
    assert.equal(h.calls.update, 0);
  });
});
