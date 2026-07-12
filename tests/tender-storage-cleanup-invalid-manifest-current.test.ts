import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  TENDER_STORAGE_CLEANUP_INVALID,
  TENDER_STORAGE_CLEANUP_PENDING,
  processTenderStorageCleanupTask,
} from "../lib/tender/tender-storage-cleanup-task";

describe("invalid tender storage cleanup manifests", () => {
  it("marks the task invalid without destroying the original recoverable bytes", async () => {
    const originalMetadata = "not-json: blob://recover-this-object";
    let action = TENDER_STORAGE_CLEANUP_PENDING;
    let metadata = originalMetadata;
    const storageCalls: unknown[] = [];

    const prisma = {
      auditLog: {
        async findFirst() {
          return {
            id: "task-1",
            action,
            metadata,
          };
        },
        async updateMany(args: any) {
          action = args.data.action;
          if (typeof args.data.metadata === "string") {
            metadata = args.data.metadata;
          }
          return { count: 1 };
        },
        async update() {
          throw new Error("invalid tasks must not reach final update");
        },
      },
    };

    const storage = {
      async putFile() { throw new Error("not used"); },
      async getFile() { throw new Error("not used"); },
      async deleteFile(record: unknown) { storageCalls.push(record); },
    };

    const result = await processTenderStorageCleanupTask({
      prisma: prisma as any,
      storage: storage as any,
      taskId: "task-1",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });

    assert.deepEqual(result, {
      found: true,
      claimed: false,
      completed: false,
      cleaned: 0,
      remaining: 0,
      failures: 1,
    });
    assert.equal(action, TENDER_STORAGE_CLEANUP_INVALID);
    assert.equal(metadata, originalMetadata);
    assert.deepEqual(storageCalls, []);
  });
});
