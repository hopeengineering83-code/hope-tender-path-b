import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  purgeExpiredSupersededDocuments,
  purgeExpiredTenderFiles,
} from "../lib/engine/retention-storage-cleanup";

const cutoff = new Date("2026-06-12T00:00:00.000Z");
const now = new Date("2026-07-12T00:00:00.000Z");

type Candidate = {
  id: string;
  storagePath: string | null;
  fileContent: string | null;
  fileName: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Single-worker harness (mirrors the previous behavior but with stateful claim
// tracking so the atomic-claim WHERE is exercised correctly).
// ─────────────────────────────────────────────────────────────────────────────

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

  // Stateful row map so claim/update/delete see the effect of prior mutations.
  const rows = new Map<string, {
    id: string;
    storagePath: string;
    fileContent: string | null;
    originalFileName: string;
    integrityFailureCode: string | null;
    integrityVerifiedAt: Date | null;
    deletedAt: Date;
    deletionStatus: string;
  }>();
  for (const c of candidates) {
    rows.set(c.id, {
      id: c.id,
      storagePath: c.storagePath ?? "",
      fileContent: c.fileContent,
      originalFileName: c.fileName,
      integrityFailureCode: null,
      integrityVerifiedAt: null,
      deletedAt: new Date("2026-06-01"),
      deletionStatus: "DELETED",
    });
  }

  const prisma = {
    tenderFile: {
      async findMany() {
        events.push("query:candidates");
        return Array.from(rows.values()).map((r) => ({
          id: r.id,
          storagePath: r.storagePath,
          fileContent: r.fileContent,
          originalFileName: r.originalFileName,
        }));
      },
      async updateMany(args: any) {
        const id = args.where.id as string;
        const row = rows.get(id);
        if (!row) return { count: 0 };

        // Claim phase: conditional WHERE on integrityFailureCode
        const isClaim = args.data.integrityFailureCode === "RETENTION_PURGE_CLAIMED";
        if (isClaim) {
          if (row.integrityFailureCode === "RETENTION_PURGE_CLAIMED") {
            return { count: 0 }; // Already claimed
          }
          row.integrityFailureCode = "RETENTION_PURGE_CLAIMED";
          row.integrityVerifiedAt = args.data.integrityVerifiedAt;
          return { count: 1 };
        }

        // Failure-restore or clear phase
        if (args.data.lastDeletionError === "RETENTION_STORAGE_DELETE_FAILED" ||
            args.data.lastDeletionError === "RETENTION_ROW_PURGE_FAILED") {
          events.push(`retry:${id}`);
          failureUpdates.push(id);
          Object.assign(row, args.data);
          if (options.updateFailures?.has(id)) throw new Error(`update failed ${id}`);
          return { count: 1 };
        }

        events.push(`clear:${id}`);
        Object.assign(row, args.data);
        if (options.updateFailures?.has(id)) throw new Error(`update failed ${id}`);
        return { count: 1 };
      },
      async deleteMany(args: any) {
        const id = args.where.id as string;
        if (!rows.has(id)) return { count: 0 };
        events.push(`delete:${id}`);
        if (options.deleteFailures?.has(id)) throw new Error(`delete failed ${id}`);
        rows.delete(id);
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

  return { prisma, storage, events, failureUpdates, rows };
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

  const rows = new Map<string, {
    id: string;
    storagePath: string | null;
    fileContent: string | null;
    exactFileName: string;
    integrityFailureCode: string | null;
    integrityVerifiedAt: Date | null;
    generationStatus: string;
    updatedAt: Date;
  }>();
  for (const c of candidates) {
    rows.set(c.id, {
      id: c.id,
      storagePath: c.storagePath,
      fileContent: c.fileContent,
      exactFileName: c.fileName,
      integrityFailureCode: null,
      integrityVerifiedAt: null,
      generationStatus: "SUPERSEDED",
      updatedAt: new Date("2026-06-01"),
    });
  }

  const prisma = {
    generatedDocument: {
      async findMany() {
        events.push("query:candidates");
        return Array.from(rows.values()).map((r) => ({
          id: r.id,
          storagePath: r.storagePath,
          fileContent: r.fileContent,
          exactFileName: r.exactFileName,
        }));
      },
      async updateMany(args: any) {
        const id = args.where.id as string;
        const row = rows.get(id);
        if (!row) return { count: 0 };

        const isClaim = args.data.integrityFailureCode === "RETENTION_PURGE_CLAIMED";
        if (isClaim) {
          if (row.integrityFailureCode === "RETENTION_PURGE_CLAIMED") {
            return { count: 0 };
          }
          row.integrityFailureCode = "RETENTION_PURGE_CLAIMED";
          row.integrityVerifiedAt = args.data.integrityVerifiedAt;
          return { count: 1 };
        }

        events.push(`clear:${id}`);
        Object.assign(row, args.data);
        if (options.updateFailures?.has(id)) throw new Error(`update failed ${id}`);
        return { count: 1 };
      },
      async deleteMany(args: any) {
        const id = args.where.id as string;
        if (!rows.has(id)) return { count: 0 };
        events.push(`delete:${id}`);
        if (options.deleteFailures?.has(id)) throw new Error(`delete failed ${id}`);
        rows.delete(id);
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

  return { prisma, storage, events, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-worker behavior tests
// ─────────────────────────────────────────────────────────────────────────────

describe("retention cleanup for old tender files", () => {
  it("retains the database row and pointer when Blob cleanup fails", async () => {
    const h = tenderFileHarness({ storageFailures: new Set(["file-1"]) });
    const result = await purgeExpiredTenderFiles({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
      now,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 0,
      blobsCleaned: 0,
      failures: 1,
    });
    // Row must still exist with a retryable failure code and original pointer.
    assert.equal(h.rows.size, 1);
    const row = h.rows.get("file-1")!;
    assert.equal(row.integrityFailureCode, "RETENTION_STORAGE_DELETE_FAILED");
    assert.equal(row.storagePath, "blob://file-1.pdf");
    assert.deepEqual(h.failureUpdates, ["file-1"]);
  });

  it("deletes storage before clearing claims and purging the row", async () => {
    const h = tenderFileHarness();
    const result = await purgeExpiredTenderFiles({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
      now,
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
    assert.equal(h.rows.size, 0);
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
      now,
    });

    assert.deepEqual(result, {
      candidates: 2,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 1,
    });
    assert.ok(!h.events.includes("delete:file-b"));
    // file-b must still exist with its original pointer for retry.
    assert.ok(h.rows.has("file-b"));
    assert.equal(h.rows.get("file-b")!.storagePath, "blob://b.pdf");
  });
});

describe("retention cleanup for superseded generated documents", () => {
  it("does not delete the row after storage failure", async () => {
    const h = generatedDocumentHarness({ storageFailures: new Set(["doc-1"]) });
    const result = await purgeExpiredSupersededDocuments({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
      now,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 0,
      blobsCleaned: 0,
      failures: 1,
    });
    assert.equal(h.rows.size, 1);
  });

  it("cleans bytes and clears claims before row purge", async () => {
    const h = generatedDocumentHarness();
    const result = await purgeExpiredSupersededDocuments({
      prisma: h.prisma as any,
      storage: h.storage as any,
      cutoff,
      now,
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
      now,
    });

    assert.deepEqual(result, {
      candidates: 1,
      rowsDeleted: 1,
      blobsCleaned: 1,
      failures: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Two-worker concurrency tests (the real race-condition reproduction)
// ─────────────────────────────────────────────────────────────────────────────

describe("two-worker concurrency safety for tender file purge", () => {
  it("two concurrent workers do not double-delete storage or double-count rows", async () => {
    // Shared stateful mock: both workers read the same row and race on it.
    const rows = new Map<string, {
      id: string;
      storagePath: string;
      fileContent: string | null;
      originalFileName: string;
      integrityFailureCode: string | null;
      integrityVerifiedAt: Date | null;
      deletedAt: Date;
      deletionStatus: string;
    }>();
    rows.set("file-1", {
      id: "file-1",
      storagePath: "blob://file-1.pdf",
      fileContent: null,
      originalFileName: "file-1.pdf",
      integrityFailureCode: null,
      integrityVerifiedAt: null,
      deletedAt: new Date("2026-06-01"),
      deletionStatus: "DELETED",
    });

    let storageDeleteCount = 0;
    const events: string[] = [];

    const prisma = {
      tenderFile: {
        async findMany() {
          events.push("query:candidates");
          return Array.from(rows.values()).map((r) => ({
            id: r.id,
            storagePath: r.storagePath,
            fileContent: r.fileContent,
            originalFileName: r.originalFileName,
          }));
        },
        async updateMany(args: any) {
          const id = args.where.id as string;
          const row = rows.get(id);
          if (!row) return { count: 0 };

          const isClaim = args.data.integrityFailureCode === "RETENTION_PURGE_CLAIMED";
          if (isClaim) {
            // Atomic claim: only one worker wins.
            if (row.integrityFailureCode === "RETENTION_PURGE_CLAIMED") {
              return { count: 0 };
            }
            row.integrityFailureCode = "RETENTION_PURGE_CLAIMED";
            row.integrityVerifiedAt = args.data.integrityVerifiedAt;
            return { count: 1 };
          }

          Object.assign(row, args.data);
          return { count: 1 };
        },
        async deleteMany(args: any) {
          const id = args.where.id as string;
          if (!rows.has(id)) return { count: 0 };
          events.push(`delete:${id}`);
          rows.delete(id);
          return { count: 1 };
        },
      },
    };

    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile(record: { fileName: string }) {
        storageDeleteCount++;
        events.push(`storage:${record.fileName}`);
      },
    };

    // Run two workers concurrently against the SAME shared state.
    const [r1, r2] = await Promise.all([
      purgeExpiredTenderFiles({ prisma: prisma as any, storage: storage as any, cutoff, now }),
      purgeExpiredTenderFiles({ prisma: prisma as any, storage: storage as any, cutoff, now }),
    ]);

    // Storage must be deleted exactly once.
    assert.equal(storageDeleteCount, 1,
      `storage was deleted ${storageDeleteCount} times — two workers raced on the same blob`);

    // Total rowsDeleted across both workers must be 1.
    assert.equal(r1.rowsDeleted + r2.rowsDeleted, 1,
      `rowsDeleted was ${r1.rowsDeleted + r2.rowsDeleted} — one row was counted twice`);

    // Total blobsCleaned across both workers must be 1.
    assert.equal(r1.blobsCleaned + r2.blobsCleaned, 1,
      `blobsCleaned was ${r1.blobsCleaned + r2.blobsCleaned} — one blob was counted twice`);

    // Total failures must be 0.
    assert.equal(r1.failures + r2.failures, 0,
      `unexpected failures: worker1=${r1.failures} worker2=${r2.failures}`);

    // Row must be gone.
    assert.equal(rows.size, 0, "row should have been deleted exactly once");
  });

  it("two concurrent workers do not double-delete superseded document storage", async () => {
    const rows = new Map<string, {
      id: string;
      storagePath: string | null;
      fileContent: string | null;
      exactFileName: string;
      integrityFailureCode: string | null;
      integrityVerifiedAt: Date | null;
      generationStatus: string;
      updatedAt: Date;
    }>();
    rows.set("doc-1", {
      id: "doc-1",
      storagePath: "blob://doc-1.docx",
      fileContent: null,
      exactFileName: "doc-1.docx",
      integrityFailureCode: null,
      integrityVerifiedAt: null,
      generationStatus: "SUPERSEDED",
      updatedAt: new Date("2026-06-01"),
    });

    let storageDeleteCount = 0;

    const prisma = {
      generatedDocument: {
        async findMany() {
          return Array.from(rows.values()).map((r) => ({
            id: r.id,
            storagePath: r.storagePath,
            fileContent: r.fileContent,
            exactFileName: r.exactFileName,
          }));
        },
        async updateMany(args: any) {
          const id = args.where.id as string;
          const row = rows.get(id);
          if (!row) return { count: 0 };

          const isClaim = args.data.integrityFailureCode === "RETENTION_PURGE_CLAIMED";
          if (isClaim) {
            if (row.integrityFailureCode === "RETENTION_PURGE_CLAIMED") {
              return { count: 0 };
            }
            row.integrityFailureCode = "RETENTION_PURGE_CLAIMED";
            row.integrityVerifiedAt = args.data.integrityVerifiedAt;
            return { count: 1 };
          }

          Object.assign(row, args.data);
          return { count: 1 };
        },
        async deleteMany(args: any) {
          const id = args.where.id as string;
          if (!rows.has(id)) return { count: 0 };
          rows.delete(id);
          return { count: 1 };
        },
      },
    };

    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile() {
        storageDeleteCount++;
      },
    };

    const [r1, r2] = await Promise.all([
      purgeExpiredSupersededDocuments({ prisma: prisma as any, storage: storage as any, cutoff, now }),
      purgeExpiredSupersededDocuments({ prisma: prisma as any, storage: storage as any, cutoff, now }),
    ]);

    assert.equal(storageDeleteCount, 1,
      `storage was deleted ${storageDeleteCount} times — two workers raced on the same blob`);
    assert.equal(r1.rowsDeleted + r2.rowsDeleted, 1,
      `rowsDeleted was ${r1.rowsDeleted + r2.rowsDeleted} — one row was counted twice`);
    assert.equal(r1.blobsCleaned + r2.blobsCleaned, 1,
      `blobsCleaned was ${r1.blobsCleaned + r2.blobsCleaned} — one blob was counted twice`);
    assert.equal(r1.failures + r2.failures, 0);
    assert.equal(rows.size, 0);
  });

  it("a stale claim from a crashed worker is re-claimable on the next run", async () => {
    // Row has a stale claim (worker crashed mid-purge) — claim is older than
    // the stale-claim threshold.
    const rows = new Map<string, {
      id: string;
      storagePath: string;
      fileContent: string | null;
      originalFileName: string;
      integrityFailureCode: string | null;
      integrityVerifiedAt: Date | null;
      deletedAt: Date;
      deletionStatus: string;
    }>();
    rows.set("file-stale", {
      id: "file-stale",
      storagePath: "blob://file-stale.pdf",
      fileContent: null,
      originalFileName: "file-stale.pdf",
      integrityFailureCode: "RETENTION_PURGE_CLAIMED",
      integrityVerifiedAt: new Date("2026-07-01"), // 11 days ago — stale
      deletedAt: new Date("2026-06-01"),
      deletionStatus: "DELETED",
    });

    let storageDeleteCount = 0;
    const prisma = {
      tenderFile: {
        async findMany() {
          return Array.from(rows.values()).map((r) => ({
            id: r.id, storagePath: r.storagePath, fileContent: r.fileContent, originalFileName: r.originalFileName,
          }));
        },
        async updateMany(args: any) {
          const id = args.where.id as string;
          const row = rows.get(id);
          if (!row) return { count: 0 };

          const isClaim = args.data.integrityFailureCode === "RETENTION_PURGE_CLAIMED";
          if (isClaim) {
            // Stale claim check: allow re-claim if integrityVerifiedAt < (now - 10min)
            const staleCutoff = new Date(now.getTime() - 10 * 60 * 1000);
            if (row.integrityFailureCode === "RETENTION_PURGE_CLAIMED" &&
                row.integrityVerifiedAt && row.integrityVerifiedAt > staleCutoff) {
              return { count: 0 }; // Fresh claim — skip
            }
            row.integrityFailureCode = "RETENTION_PURGE_CLAIMED";
            row.integrityVerifiedAt = args.data.integrityVerifiedAt;
            return { count: 1 };
          }
          Object.assign(row, args.data);
          return { count: 1 };
        },
        async deleteMany(args: any) {
          const id = args.where.id as string;
          if (!rows.has(id)) return { count: 0 };
          rows.delete(id);
          return { count: 1 };
        },
      },
    };
    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile() { storageDeleteCount++; },
    };

    const result = await purgeExpiredTenderFiles({
      prisma: prisma as any, storage: storage as any, cutoff, now,
    });

    assert.equal(result.rowsDeleted, 1, "stale-claimed row should be re-claimed and purged");
    assert.equal(result.blobsCleaned, 1);
    assert.equal(storageDeleteCount, 1);
    assert.equal(rows.size, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cron wiring tests (unchanged from the prior contract)
// ─────────────────────────────────────────────────────────────────────────────

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
