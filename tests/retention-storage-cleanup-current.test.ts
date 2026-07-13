import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  purgeExpiredSupersededDocuments,
  purgeExpiredTenderFiles,
} from "../lib/engine/retention-storage-cleanup";

const cutoff = new Date("2026-06-12T00:00:00.000Z");

type Candidate = {
  id: string;
  storagePath: string | null;
  fileContent: string | null;
  fileName: string;
};

function tenderFileHarness(options: {
  candidates?: Candidate[];
  storageFailures?: Set<string>;
  updateFailures?: Set<string>;
  deleteFailures?: Set<string>;
} = {}) {
  const candidates = options.candidates ?? [{
    id: "file-1",
    storagePath: "blob://file-1.pdf",
    fileContent: null,
    fileName: "file-1.pdf",
  }];
  const events: string[] = [];
  const failureUpdates: string[] = [];

  const prisma = {
    tenderFile: {
      async findMany() {
        events.push("query:candidates");
        return candidates.map((candidate) => ({
          id: candidate.id,
          storagePath: candidate.storagePath ?? "",
          fileContent: candidate.fileContent,
          originalFileName: candidate.fileName,
        }));
      },
      async updateMany(args: any) {
        const id = args.where.id as string;
        if (args.data.lastDeletionError === "RETENTION_STORAGE_OR_ROW_PURGE_FAILED") {
          events.push(`retry:${id}`);
          failureUpdates.push(id);
          return { count: 1 };
        }
        events.push(`clear:${id}`);
        if (options.updateFailures?.has(id)) throw new Error(`update failed ${id}`);
        return { count: 1 };
      },
      async deleteMany(args: any) {
        const id = args.where.id as string;
        events.push(`delete:${id}`);
        if (options.deleteFailures?.has(id)) throw new Error(`delete failed ${id}`);
        return { count: 1 };
      },
    },
  };

  const storage = {
    async putFile() { throw new Error("not used"); },
    async getFile() { throw new Error("not used"); },
    async deleteFile(record: { fileName: string }) {
      const candidate = candidates.find((item) => item.fileName === record.fileName)!;
      events.push(`storage:${candidate.id}`);
      if (options.storageFailures?.has(candidate.id)) {
        throw new Error(`storage failed ${candidate.id}`);
      }
    },
  };

  return { prisma, storage, events, failureUpdates };
}

function generatedDocumentHarness(options: {
  candidates?: Candidate[];
  storageFailures?: Set<string>;
  updateFailures?: Set<string>;
  deleteFailures?: Set<string>;
} = {}) {
  const candidates = options.candidates ?? [{
    id: "doc-1",
    storagePath: "blob://doc-1.docx",
    fileContent: null,
    fileName: "doc-1.docx",
  }];
  const events: string[] = [];

  const prisma = {
    generatedDocument: {
      async findMany() {
        events.push("query:candidates");
        return candidates.map((candidate) => ({
          id: candidate.id,
          storagePath: candidate.storagePath,
          fileContent: candidate.fileContent,
          exactFileName: candidate.fileName,
        }));
      },
      async updateMany(args: any) {
        const id = args.where.id as string;
        events.push(`clear:${id}`);
        if (options.updateFailures?.has(id)) throw new Error(`update failed ${id}`);
        return { count: 1 };
      },
      async deleteMany(args: any) {
        const id = args.where.id as string;
        events.push(`delete:${id}`);
        if (options.deleteFailures?.has(id)) throw new Error(`delete failed ${id}`);
        return { count: 1 };
      },
    },
  };

  const storage = {
    async putFile() { throw new Error("not used"); },
    async getFile() { throw new Error("not used"); },
    async deleteFile(record: { fileName: string }) {
      const candidate = candidates.find((item) => item.fileName === record.fileName)!;
      events.push(`storage:${candidate.id}`);
      if (options.storageFailures?.has(candidate.id)) {
        throw new Error(`storage failed ${candidate.id}`);
      }
    },
  };

  return { prisma, storage, events };
}

describe("retention cleanup for old tender files", () => {
  it("retains the database row and pointer when Blob cleanup fails", async () => {
    const h = tenderFileHarness({ storageFailures: new Set(["file-1"]) });
    const result = await purgeExpiredTenderFiles({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 0,
      blobsCleaned: 0,
      failures: 1,
    });
    assert.deepEqual(h.events, [
      "query:candidates",
      "storage:file-1",
      "retry:file-1",
    ]);
    assert.deepEqual(h.failureUpdates, ["file-1"]);
  });

  it("deletes storage before clearing claims and purging the row", async () => {
    const h = tenderFileHarness();
    const result = await purgeExpiredTenderFiles({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 0,
    });
    assert.deepEqual(h.events, [
      "query:candidates",
      "storage:file-1",
      "clear:file-1",
      "delete:file-1",
    ]);
  });

  it("reports actual successes and keeps failed candidates retryable", async () => {
    const h = tenderFileHarness({
      candidates: [
        { id: "file-a", storagePath: "blob://a.pdf", fileContent: null, fileName: "a.pdf" },
        { id: "file-b", storagePath: "blob://b.pdf", fileContent: null, fileName: "b.pdf" },
      ],
      storageFailures: new Set(["file-b"]),
    });
    const result = await purgeExpiredTenderFiles({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 2,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 1,
    });
    assert.ok(!h.events.includes("delete:file-b"));
  });
});

describe("retention cleanup for superseded generated documents", () => {
  it("does not delete the row after storage failure", async () => {
    const h = generatedDocumentHarness({ storageFailures: new Set(["doc-1"]) });
    const result = await purgeExpiredSupersededDocuments({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 0,
      blobsCleaned: 0,
      failures: 1,
    });
    assert.deepEqual(h.events, ["query:candidates", "storage:doc-1"]);
  });

  it("cleans bytes and clears claims before row purge", async () => {
    const h = generatedDocumentHarness();
    const result = await purgeExpiredSupersededDocuments({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 0,
    });
    assert.deepEqual(h.events, [
      "query:candidates",
      "storage:doc-1",
      "clear:doc-1",
      "delete:doc-1",
    ]);
  });

  it("counts database-base64 cleanup without inventing a Blob cleanup", async () => {
    const h = generatedDocumentHarness({
      candidates: [{
        id: "doc-inline",
        storagePath: null,
        fileContent: Buffer.from("inline").toString("base64"),
        fileName: "inline.docx",
      }],
    });
    const result = await purgeExpiredSupersededDocuments({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 0,
    });
  });
});

describe("cleanup cron wiring", () => {
  const source = readFileSync("app/api/cron/cleanup-old-records/route.ts", "utf8");

  it("uses retryable helpers instead of deleting rows before storage", () => {
    assert.match(source, /purgeExpiredTenderFiles\(/);
    assert.match(source, /purgeExpiredSupersededDocuments\(/);
    assert.doesNotMatch(source, /const filesToDelete =/);
    assert.doesNotMatch(source, /const supersededDocCandidates =/);
  });

  it("reports actual row, Blob, candidate, and failure counts", () => {
    assert.match(source, /tenderFiles: tenderFileCleanup\.rowsDeleted/);
    assert.match(source, /blobsCleaned: tenderFileCleanup\.blobsCleaned/);
    assert.match(source, /tenderFileBlobFailures: tenderFileCleanup\.failures/);
    assert.match(source, /supersededDocs: supersededDocumentCleanup\.rowsDeleted/);
    assert.match(source, /supersededDocBlobFailures: supersededDocumentCleanup\.failures/);
  });
});
