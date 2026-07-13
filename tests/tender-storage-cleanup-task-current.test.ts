import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  TENDER_STORAGE_CLEANUP_COMPLETED,
  TENDER_STORAGE_CLEANUP_PENDING,
  TENDER_STORAGE_CLEANUP_RUNNING,
  createTenderStorageCleanupTask,
  processTenderStorageCleanupTask,
} from "../lib/tender/tender-storage-cleanup-task";

function manifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    status: "PENDING",
    tenderId: "11111111-1111-4111-8111-111111111111",
    correlationId: "corr-1",
    attempts: 0,
    files: [
      { storagePath: "blob://source.pdf", fileName: "source.pdf" },
      { storagePath: "blob://proposal.docx", fileName: "proposal.docx" },
    ],
    createdAt: "2026-07-12T17:00:00.000Z",
    ...overrides,
  });
}

function processorHarness(options: {
  action?: string;
  metadata?: string;
  storageFailures?: Set<string>;
  claimCount?: number;
} = {}) {
  const events: string[] = [];
  let action = options.action ?? TENDER_STORAGE_CLEANUP_PENDING;
  let metadata = options.metadata ?? manifest();

  const prisma = {
    auditLog: {
      async findFirst() {
        events.push("db:read");
        return { id: "task-1", action, metadata };
      },
      async updateMany(args: any) {
        events.push(`db:claim:${args.data.action}`);
        if ((options.claimCount ?? 1) !== 1) return { count: options.claimCount ?? 0 };
        action = args.data.action;
        metadata = args.data.metadata;
        return { count: 1 };
      },
      async update(args: any) {
        events.push(`db:final:${args.data.action}`);
        action = args.data.action;
        metadata = args.data.metadata;
        return { id: "task-1" };
      },
    },
  };

  const storage = {
    async putFile() { throw new Error("not used"); },
    async getFile() { throw new Error("not used"); },
    async deleteFile(record: { storagePath?: string | null }) {
      const path = record.storagePath ?? "";
      events.push(`storage:${path}`);
      if (options.storageFailures?.has(path)) throw new Error("provider detail must not persist");
    },
  };

  return {
    prisma,
    storage,
    events,
    state: () => ({ action, metadata: JSON.parse(metadata) as Record<string, any> }),
  };
}

describe("durable tender storage cleanup task creation", () => {
  it("stores only deduplicated external paths inside the deletion transaction", async () => {
    let created: any = null;
    const tx = {
      auditLog: {
        async create(args: any) {
          created = args.data;
          return { id: "task-1" };
        },
      },
    };

    const taskId = await createTenderStorageCleanupTask({
      tx: tx as any,
      userId: "user-1",
      tenderId: "11111111-1111-4111-8111-111111111111",
      correlationId: "corr-1",
      now: new Date("2026-07-12T17:00:00.000Z"),
      files: [
        { storagePath: "blob://source.pdf", fileName: "source.pdf" },
        { storagePath: "blob://source.pdf", fileName: "duplicate.pdf" },
        { storagePath: "", fileName: "database-base64.pdf" },
        { storagePath: null, fileName: "inline.docx" },
      ],
    });

    assert.equal(taskId, "task-1");
    assert.equal(created.action, TENDER_STORAGE_CLEANUP_PENDING);
    const saved = JSON.parse(created.metadata);
    assert.deepEqual(saved.files, [
      { storagePath: "blob://source.pdf", fileName: "source.pdf" },
    ]);
    assert.equal(saved.status, "PENDING");
    assert.doesNotMatch(created.metadata, /fileContent/);
  });

  it("does not create a task when deletion has no external storage objects", async () => {
    let creates = 0;
    const taskId = await createTenderStorageCleanupTask({
      tx: { auditLog: { async create() { creates += 1; return { id: "unexpected" }; } } } as any,
      userId: "user-1",
      tenderId: "11111111-1111-4111-8111-111111111111",
      correlationId: "corr-1",
      files: [{ storagePath: "", fileName: "inline.docx" }],
    });
    assert.equal(taskId, null);
    assert.equal(creates, 0);
  });
});

describe("durable tender storage cleanup task processing", () => {
  it("claims, deletes every object, and marks the task completed", async () => {
    const h = processorHarness();
    const result = await processTenderStorageCleanupTask({
      prisma: h.prisma as any,
      storage: h.storage as any,
      taskId: "task-1",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });

    assert.deepEqual(result, {
      found: true,
      claimed: true,
      completed: true,
      cleaned: 2,
      remaining: 0,
      failures: 0,
    });
    assert.equal(h.state().action, TENDER_STORAGE_CLEANUP_COMPLETED);
    assert.deepEqual(h.state().metadata.files, []);
    assert.deepEqual(h.events, [
      "db:read",
      `db:claim:${TENDER_STORAGE_CLEANUP_RUNNING}`,
      "storage:blob://source.pdf",
      "storage:blob://proposal.docx",
      `db:final:${TENDER_STORAGE_CLEANUP_COMPLETED}`,
    ]);
  });

  it("keeps only failed paths in the durable pending manifest", async () => {
    const h = processorHarness({
      storageFailures: new Set(["blob://proposal.docx"]),
    });
    const result = await processTenderStorageCleanupTask({
      prisma: h.prisma as any,
      storage: h.storage as any,
      taskId: "task-1",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });

    assert.deepEqual(result, {
      found: true,
      claimed: true,
      completed: false,
      cleaned: 1,
      remaining: 1,
      failures: 1,
    });
    assert.equal(h.state().action, TENDER_STORAGE_CLEANUP_PENDING);
    assert.deepEqual(h.state().metadata.files, [
      { storagePath: "blob://proposal.docx", fileName: "proposal.docx" },
    ]);
    assert.doesNotMatch(JSON.stringify(h.state().metadata), /provider detail/);
  });

  it("does not double-run a fresh claimed task", async () => {
    const h = processorHarness({
      action: TENDER_STORAGE_CLEANUP_RUNNING,
      metadata: manifest({
        status: "RUNNING",
        lastAttemptAt: "2026-07-12T17:55:00.000Z",
      }),
    });
    const result = await processTenderStorageCleanupTask({
      prisma: h.prisma as any,
      storage: h.storage as any,
      taskId: "task-1",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });

    assert.equal(result.claimed, false);
    assert.equal(result.remaining, 2);
    assert.deepEqual(h.events, ["db:read"]);
  });

  it("uses the exact prior manifest as the optimistic claim version", () => {
    const source = readFileSync("lib/tender/tender-storage-cleanup-task.ts", "utf8");
    const claimStart = source.indexOf("const claim = await args.prisma.auditLog.updateMany");
    const claimRegion = source.slice(claimStart, claimStart + 700);
    assert.match(claimRegion, /metadata: task\.metadata/);
    assert.match(claimRegion, /action: task\.action/);
  });

  it("reclaims a stale running task for retry", async () => {
    const h = processorHarness({
      action: TENDER_STORAGE_CLEANUP_RUNNING,
      metadata: manifest({
        status: "RUNNING",
        lastAttemptAt: "2026-07-12T17:00:00.000Z",
      }),
    });
    const result = await processTenderStorageCleanupTask({
      prisma: h.prisma as any,
      storage: h.storage as any,
      taskId: "task-1",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });
    assert.equal(result.claimed, true);
    assert.equal(result.completed, true);
  });

  it("two concurrent workers do not double-delete storage or double-claim the same task", async () => {
    // Shared stateful mock: both workers see the same PENDING task. The claim
    // updateMany uses WHERE metadata = task.metadata (optimistic concurrency).
    // Only the first worker's claim matches; the second worker's claim
    // returns count=0 and it skips storage deletion entirely.
    let action = TENDER_STORAGE_CLEANUP_PENDING;
    let metadata = manifest();
    let storageDeleteCount = 0;
    const deletedPaths: string[] = [];

    const prisma = {
      auditLog: {
        async findFirst() {
          return { id: "task-1", action, metadata };
        },
        async updateMany(args: any) {
          // Optimistic concurrency: the WHERE must match the current
          // action AND metadata. Once the first worker updates, the second
          // worker's stale metadata no longer matches.
          if (args.where.id !== "task-1") return { count: 0 };
          if (args.where.action !== action) return { count: 0 };
          if (args.where.metadata !== metadata) return { count: 0 };
          // Claim succeeds — update the shared state.
          action = args.data.action;
          metadata = args.data.metadata;
          return { count: 1 };
        },
        async update(args: any) {
          action = args.data.action;
          metadata = args.data.metadata;
          return { id: "task-1" };
        },
      },
    };

    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile(record: { storagePath?: string | null }) {
        storageDeleteCount++;
        deletedPaths.push(record.storagePath ?? "");
      },
    };

    const [r1, r2] = await Promise.all([
      processTenderStorageCleanupTask({
        prisma: prisma as any, storage: storage as any, taskId: "task-1",
        now: new Date("2026-07-12T18:00:00.000Z"),
      }),
      processTenderStorageCleanupTask({
        prisma: prisma as any, storage: storage as any, taskId: "task-1",
        now: new Date("2026-07-12T18:00:00.000Z"),
      }),
    ]);

    // Exactly one worker should have claimed the task.
    const claimedCount = (r1.claimed ? 1 : 0) + (r2.claimed ? 1 : 0);
    assert.equal(claimedCount, 1,
      `both workers claimed — r1.claimed=${r1.claimed} r2.claimed=${r2.claimed}`);

    // Storage should have been deleted exactly 2 times (2 files in manifest),
    // not 4 times (2 files × 2 workers).
    assert.equal(storageDeleteCount, 2,
      `storage was deleted ${storageDeleteCount} times — expected 2 (one per file, single worker)`);

    // Total cleaned across both workers should be 2, not 4.
    assert.equal(r1.cleaned + r2.cleaned, 2,
      `cleaned was ${r1.cleaned + r2.cleaned} — expected 2`);

    // The task should be COMPLETED.
    assert.equal(action, TENDER_STORAGE_CLEANUP_COMPLETED);
  });

  it("failed objects retain their private retry pointers across concurrent workers", async () => {
    // Two workers attempt the same PENDING task. The first claims and
    // processes it; one of the two files fails storage deletion. The
    // manifest must retain the failed file's storagePath for the next retry.
    let action = TENDER_STORAGE_CLEANUP_PENDING;
    let metadata = manifest();
    const failingPath = "blob://proposal.docx";
    let storageDeleteCount = 0;

    const prisma = {
      auditLog: {
        async findFirst() {
          return { id: "task-1", action, metadata };
        },
        async updateMany(args: any) {
          if (args.where.id !== "task-1") return { count: 0 };
          if (args.where.action !== action) return { count: 0 };
          if (args.where.metadata !== metadata) return { count: 0 };
          action = args.data.action;
          metadata = args.data.metadata;
          return { count: 1 };
        },
        async update(args: any) {
          action = args.data.action;
          metadata = args.data.metadata;
          return { id: "task-1" };
        },
      },
    };

    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile(record: { storagePath?: string | null }) {
        storageDeleteCount++;
        if (record.storagePath === failingPath) {
          throw new Error("storage provider error");
        }
      },
    };

    const [r1, r2] = await Promise.all([
      processTenderStorageCleanupTask({
        prisma: prisma as any, storage: storage as any, taskId: "task-1",
        now: new Date("2026-07-12T18:00:00.000Z"),
      }),
      processTenderStorageCleanupTask({
        prisma: prisma as any, storage: storage as any, taskId: "task-1",
        now: new Date("2026-07-12T18:00:00.000Z"),
      }),
    ]);

    // Only one worker should have claimed.
    const claimedCount = (r1.claimed ? 1 : 0) + (r2.claimed ? 1 : 0);
    assert.equal(claimedCount, 1);

    // Storage delete should have been called for both files (2 calls), not 4.
    assert.equal(storageDeleteCount, 2,
      `storage was called ${storageDeleteCount} times — expected 2 (one per file, single worker)`);

    // The task should be PENDING (not COMPLETED) because one file failed.
    assert.equal(action, TENDER_STORAGE_CLEANUP_PENDING);

    // The failed file's storagePath must be retained in the manifest.
    const finalManifest = JSON.parse(metadata);
    assert.deepEqual(finalManifest.files, [
      { storagePath: failingPath, fileName: "proposal.docx" },
    ]);
    assert.equal(finalManifest.failureCount, 1);
    assert.equal(finalManifest.cleanedCount, 1);
  });
});

describe("tender deletion cleanup task wiring", () => {
  const deletion = readFileSync("lib/tender/delete-tender.ts", "utf8");
  const cron = readFileSync("app/api/cron/cleanup-tender-storage/route.ts", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");

  it("creates the durable task before deleting the final Tender row", () => {
    const taskPos = deletion.indexOf("createTenderStorageCleanupTask({");
    const deletePos = deletion.indexOf('wrapDelete("Tender"');
    assert.ok(taskPos >= 0 && deletePos > taskPos);
    assert.match(deletion, /tenderFile\.findMany/);
    assert.match(deletion, /generatedDocument\.findMany/);
    assert.match(deletion, /userId: actorId/);
  });

  it("has a secret-protected scheduled retry worker", () => {
    assert.match(cron, /CRON_SECRET/);
    assert.match(cron, /processPendingTenderStorageCleanupTasks\(/);
    assert.match(cron, /errorClass/);
    assert.doesNotMatch(cron, /error\.message/);
    assert.match(vercel, /cleanup-tender-storage/);
  });
});
