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
