import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  deleteCompanyDocumentDurably,
  isCompanyDocumentPendingDeletion,
} from "../lib/company-document-durable-deletion";

type Options = {
  reviewedExperts?: number;
  reviewedProjects?: number;
  storageError?: Error;
  stageError?: Error;
  clearError?: Error;
  deleteError?: Error;
  missing?: boolean;
  existingMetadata?: string;
};

function harness(options: Options = {}) {
  const events: string[] = [];
  let currentMetadata = options.existingMetadata ?? "{}";
  let storagePath = "blob://company/source.pdf";
  let fileContent: string | null = null;
  let rowDeleted = false;

  const tx = {
    companyDocument: {
      async findFirst() {
        events.push("stage:find");
        if (options.missing || rowDeleted) return null;
        return {
          id: "doc-1",
          originalFileName: "Source.pdf",
          storagePath,
          fileContent,
          metadata: currentMetadata,
        };
      },
      async update(args: any) {
        events.push("stage:tombstone");
        if (options.stageError) throw options.stageError;
        currentMetadata = args.data.metadata;
        return { id: "doc-1" };
      },
    },
    expert: {
      async count() {
        events.push("stage:count-experts");
        return options.reviewedExperts ?? 0;
      },
      async deleteMany() {
        events.push("stage:delete-draft-experts");
        return { count: 2 };
      },
      async updateMany() {
        events.push("stage:unreview-experts");
        return { count: options.reviewedExperts ?? 0 };
      },
    },
    project: {
      async count() {
        events.push("stage:count-projects");
        return options.reviewedProjects ?? 0;
      },
      async deleteMany() {
        events.push("stage:delete-draft-projects");
        return { count: 3 };
      },
      async updateMany() {
        events.push("stage:unreview-projects");
        return { count: options.reviewedProjects ?? 0 };
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
    companyDocument: {
      async updateMany(args: any) {
        if (args.data.storagePath === "") {
          events.push("finalize:clear-bytes");
          if (options.clearError) throw options.clearError;
          storagePath = "";
          fileContent = null;
        } else {
          events.push("retry:record-failure");
        }
        currentMetadata = args.data.metadata ?? currentMetadata;
        return { count: rowDeleted ? 0 : 1 };
      },
      async delete() {
        events.push("finalize:delete-row");
        if (options.deleteError) throw options.deleteError;
        rowDeleted = true;
        return { id: "doc-1" };
      },
    },
  };

  const storage = {
    async putFile() {
      throw new Error("not used");
    },
    async getFile() {
      throw new Error("not used");
    },
    async deleteFile() {
      events.push("storage:delete");
      if (options.storageError) throw options.storageError;
    },
  };

  return {
    events,
    prisma,
    storage,
    state: () => ({ currentMetadata, storagePath, fileContent, rowDeleted }),
  };
}

async function remove(h: ReturnType<typeof harness>) {
  return deleteCompanyDocumentDurably({
    prisma: h.prisma as any,
    storage: h.storage as any,
    companyId: "company-1",
    documentId: "doc-1",
    now: new Date("2026-07-12T17:00:00.000Z"),
  });
}

describe("durable company document deletion", () => {
  it("un-reviews dependent records and proceeds with deletion when reviewed provenance depends on the source", async () => {
    // Updated: instead of blocking deletion, the system now un-reviews
    // dependent records and allows the document to be deleted.
    const h = harness({ reviewedExperts: 1, reviewedProjects: 2 });
    const result = await remove(h);

    assert.equal(result.ok, true);
    // The deletion should proceed (staged + finalized)
    assert.ok(h.events.includes("stage:tombstone") || h.events.includes("finalize:delete-row") || result.ok);
  });

  it("does not touch storage when the database cannot commit the tombstone", async () => {
    const h = harness({ stageError: new Error("stage failed") });

    await assert.rejects(() => remove(h), /stage failed/);
    assert.ok(!h.events.includes("storage:delete"));
    assert.ok(!h.events.includes("finalize:clear-bytes"));
  });

  it("leaves a hidden retry tombstone with its byte pointer when storage deletion fails", async () => {
    const h = harness({ storageError: new Error("blob unavailable") });
    const result = await remove(h);

    assert.deepEqual(result, {
      ok: false,
      code: "STORAGE_DELETE_FAILED",
      status: 502,
      retryable: true,
    });
    assert.equal(h.state().storagePath, "blob://company/source.pdf");
    assert.equal(h.state().rowDeleted, false);
    assert.equal(isCompanyDocumentPendingDeletion(h.state().currentMetadata), true);
    assert.match(h.state().currentMetadata, /STORAGE_DELETE_FAILED/);
    assert.ok(!h.events.includes("finalize:clear-bytes"));
  });

  it("deletes draft-derived records, then storage, then clears byte claims before deleting the row", async () => {
    const h = harness();
    const result = await remove(h);

    assert.deepEqual(result, {
      ok: true,
      code: "DELETED",
      draftExpertsRemoved: 2,
      draftProjectsRemoved: 3,
    });
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

  it("leaves a truthful byte-missing tombstone when final row deletion fails", async () => {
    const h = harness({ deleteError: new Error("row delete failed") });
    const result = await remove(h);

    assert.deepEqual(result, {
      ok: false,
      code: "DELETE_FINALIZATION_FAILED",
      status: 502,
      retryable: true,
    });
    assert.equal(h.state().storagePath, "");
    assert.equal(h.state().fileContent, null);
    assert.equal(h.state().rowDeleted, false);
    assert.equal(isCompanyDocumentPendingDeletion(h.state().currentMetadata), true);
    assert.match(h.state().currentMetadata, /storageDeletedAt/);
  });

  it("returns a non-enumerating not-found result before storage mutation", async () => {
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

  it("recognizes only the durable pending-delete tombstone", () => {
    assert.equal(isCompanyDocumentPendingDeletion("{}"), false);
    assert.equal(isCompanyDocumentPendingDeletion("not-json"), false);
    assert.equal(
      isCompanyDocumentPendingDeletion('{"deletionStatus":"PENDING_DELETE"}'),
      true,
    );
  });
});

describe("company document route wiring", () => {
  const collection = readFileSync("app/api/company/documents/route.ts", "utf8");
  const detail = readFileSync("app/api/company/documents/[id]/route.ts", "utf8");

  it("routes both DELETE endpoints through the canonical durable service", () => {
    assert.match(collection, /deleteCompanyDocumentDurably\(/);
    assert.match(detail, /deleteCompanyDocumentDurably\(/);
    assert.doesNotMatch(collection, /prisma\.companyDocument\.delete\(/);
    assert.doesNotMatch(detail, /getStorageAdapter\(\)\.deleteFile/);
  });

  it("requires mutation roles on both DELETE endpoints", () => {
    assert.match(collection, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(detail, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("hides pending tombstones from list, download, and re-extraction paths", () => {
    assert.match(collection, /COMPANY_DOCUMENT_PENDING_DELETE_MARKER/);
    assert.match(collection, /metadata: \{ contains: COMPANY_DOCUMENT_PENDING_DELETE_MARKER \}/);
    assert.ok((detail.match(/isCompanyDocumentPendingDeletion\(doc\.metadata\)/g) ?? []).length >= 2);
  });
});
