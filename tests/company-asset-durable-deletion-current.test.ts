import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  deleteCompanyAssetDurably,
  isCompanyAssetPendingDeletion,
} from "../lib/company-asset-durable-deletion";

type Options = {
  storageError?: Error;
  stageError?: Error;
  clearError?: Error;
  deleteError?: Error;
  missing?: boolean;
};

function harness(options: Options = {}) {
  const events: string[] = [];
  let metadata = "{}";
  let storagePath = "blob://company/logo.png";
  let fileContent: string | null = null;
  let isActive = true;
  let rowDeleted = false;

  const tx = {
    companyAsset: {
      async findFirst() {
        events.push("stage:find");
        if (options.missing || rowDeleted) return null;
        return {
          id: "asset-1",
          originalFileName: "logo.png",
          storagePath,
          fileContent,
          metadata,
        };
      },
      async update(args: any) {
        events.push("stage:tombstone");
        if (options.stageError) throw options.stageError;
        isActive = args.data.isActive;
        metadata = args.data.metadata;
        return { id: "asset-1" };
      },
    },
  };

  const prisma = {
    async $transaction(fn: (client: typeof tx) => Promise<unknown>) {
      events.push("transaction:start");
      const value = await fn(tx);
      events.push("transaction:commit");
      return value;
    },
    companyAsset: {
      async updateMany(args: any) {
        if (args.data.storagePath === "") {
          events.push("finalize:clear-bytes");
          if (options.clearError) throw options.clearError;
          storagePath = "";
          fileContent = null;
        } else {
          events.push("retry:record-failure");
        }
        metadata = args.data.metadata ?? metadata;
        return { count: rowDeleted ? 0 : 1 };
      },
      async delete() {
        events.push("finalize:delete-row");
        if (options.deleteError) throw options.deleteError;
        rowDeleted = true;
        return { id: "asset-1" };
      },
    },
  };

  const storage = {
    async putFile() { throw new Error("not used"); },
    async getFile() { throw new Error("not used"); },
    async deleteFile() {
      events.push("storage:delete");
      if (options.storageError) throw options.storageError;
    },
  };

  return {
    events,
    prisma,
    storage,
    state: () => ({ metadata, storagePath, fileContent, isActive, rowDeleted }),
  };
}

async function remove(h: ReturnType<typeof harness>) {
  return deleteCompanyAssetDurably({
    prisma: h.prisma as any,
    storage: h.storage as any,
    companyId: "company-1",
    assetId: "asset-1",
    now: new Date("2026-07-12T17:00:00.000Z"),
  });
}

describe("durable company asset deletion", () => {
  it("does not touch storage when the database cannot commit the inactive tombstone", async () => {
    const h = harness({ stageError: new Error("stage failed") });
    await assert.rejects(() => remove(h), /stage failed/);
    assert.ok(!h.events.includes("storage:delete"));
  });

  it("immediately deactivates the asset and keeps its pointer for retry on storage failure", async () => {
    const h = harness({ storageError: new Error("blob unavailable") });
    const result = await remove(h);

    assert.deepEqual(result, {
      ok: false,
      code: "STORAGE_DELETE_FAILED",
      status: 502,
      retryable: true,
    });
    assert.equal(h.state().isActive, false);
    assert.equal(h.state().storagePath, "blob://company/logo.png");
    assert.equal(isCompanyAssetPendingDeletion(h.state().metadata), true);
    assert.match(h.state().metadata, /STORAGE_DELETE_FAILED/);
  });

  it("deletes storage, clears byte claims, then removes the row", async () => {
    const h = harness();
    const result = await remove(h);

    assert.deepEqual(result, { ok: true, code: "DELETED" });
    assert.equal(h.state().rowDeleted, true);
    assert.deepEqual(
      h.events.filter((event) => [
        "stage:tombstone",
        "storage:delete",
        "finalize:clear-bytes",
        "finalize:delete-row",
      ].includes(event)),
      [
        "stage:tombstone",
        "storage:delete",
        "finalize:clear-bytes",
        "finalize:delete-row",
      ],
    );
  });

  it("leaves a hidden byte-missing tombstone when row removal fails", async () => {
    const h = harness({ deleteError: new Error("row delete failed") });
    const result = await remove(h);

    assert.deepEqual(result, {
      ok: false,
      code: "DELETE_FINALIZATION_FAILED",
      status: 502,
      retryable: true,
    });
    assert.equal(h.state().isActive, false);
    assert.equal(h.state().storagePath, "");
    assert.equal(h.state().fileContent, null);
    assert.equal(h.state().rowDeleted, false);
    assert.match(h.state().metadata, /storageDeletedAt/);
  });

  it("returns not found before storage mutation", async () => {
    const h = harness({ missing: true });
    const result = await remove(h);
    assert.deepEqual(result, {
      ok: false,
      code: "NOT_FOUND",
      status: 404,
      retryable: false,
    });
    assert.ok(!h.events.includes("storage:delete"));
  });
});

describe("company asset route wiring", () => {
  const collection = readFileSync("app/api/company/assets/route.ts", "utf8");
  const detail = readFileSync("app/api/company/assets/[id]/route.ts", "utf8");

  it("uses the durable service instead of storage-first deletion", () => {
    assert.match(collection, /deleteCompanyAssetDurably\(/);
    assert.doesNotMatch(collection, /getStorageAdapter\(\)\.deleteFile/);
    assert.doesNotMatch(collection, /prisma\.companyAsset\.delete\(/);
  });

  it("hides pending assets from collection and download routes", () => {
    assert.match(collection, /COMPANY_ASSET_PENDING_DELETE_MARKER/);
    assert.match(detail, /isActive: true/);
    assert.match(detail, /isCompanyAssetPendingDeletion\(asset\.metadata\)/);
  });
});
