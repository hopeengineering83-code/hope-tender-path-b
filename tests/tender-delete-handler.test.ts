/**
 * Handler-level unit tests for tender deletion.
 *
 * These tests mock the Prisma transaction client to verify the actual
 * TypeScript code in lib/tender/delete-tender.ts — NOT a SQL simulation.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { Prisma } from "@prisma/client";

function createMockTx(config: {
  generatedDocs?: Array<{ id: string; storagePath?: string | null; exactFileName?: string | null }>;
  tenderFiles?: Array<{ storagePath: string; originalFileName: string }>;
  aiJobs?: { id: string }[];
  pricingWorkbooks?: { id: string }[];
  orphanedReqCount?: number;
  aiUsageError?: Error;
  tenderDeleteError?: Error;
}): { tx: any; calls: Array<{ model: string; method: string; args: any }> } {
  const calls: Array<{ model: string; method: string; args: any }> = [];

  const makeModel = (modelName: string) => {
    const model: any = {};
    for (const method of ["deleteMany", "findMany", "delete", "count", "updateMany", "create"]) {
      model[method] = async (args: any) => {
        calls.push({ model: modelName, method, args });
        if (method === "findMany") {
          if (modelName === "generatedDocument") return config.generatedDocs ?? [];
          if (modelName === "tenderFile") return config.tenderFiles ?? [];
          if (modelName === "aiJob") return config.aiJobs ?? [];
          if (modelName === "pricingWorkbook") return config.pricingWorkbooks ?? [];
          return [];
        }
        if (method === "create" && modelName === "auditLog") return { id: "cleanup-task-1" };
        if (method === "count") return config.orphanedReqCount ?? 0;
        if (method === "updateMany" && modelName === "aiUsageRecord" && config.aiUsageError) throw config.aiUsageError;
        if (method === "delete" && modelName === "tender" && config.tenderDeleteError) throw config.tenderDeleteError;
        return { count: 0 };
      };
    }
    return model;
  };

  const tx = new Proxy({} as any, {
    get(_target, propName: string) {
      if (propName === "$executeRawUnsafe") {
        return async (sql: string, ...params: any[]) => {
          calls.push({ model: "$executeRawUnsafe", method: "execute", args: { sql, params } });
          return 0;
        };
      }
      if (propName === "$executeRaw") {
        return async (strings: TemplateStringsArray, ...values: any[]) => {
          calls.push({
            model: "$executeRaw",
            method: "execute",
            args: { sql: Array.from(strings).join("?"), values },
          });
          return 0;
        };
      }
      return makeModel(propName);
    },
  });

  return { tx, calls };
}

const VALID_UUID = "12345678-1234-4123-8123-123456789012";
const ACTOR_ID = "actor-1";

async function remove(tx: any, correlationId = "corr-1") {
  return executeTenderDeletion(tx, VALID_UUID, correlationId, ACTOR_ID);
}

describe("executeTenderDeletion — handler-level unit tests", () => {
  it("sets transaction-local GUC context before any deletes (parameterized set_config)", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);

    const gucCall = calls.find((c) => c.model === "$executeRaw");
    assert.ok(gucCall, "GUC must be set via parameterized $executeRaw");
    assert.ok(gucCall.args.sql.includes("set_config"));
    assert.ok(gucCall.args.sql.includes("app.tender_deletion_context"));
    assert.ok(gucCall.args.sql.includes("true"));
    assert.ok(!gucCall.args.sql.includes(VALID_UUID));
    assert.deepEqual(gucCall.args.values, [VALID_UUID]);
    assert.equal(calls[0].model, "$executeRaw");
  });

  it("uses no unsafe raw SQL for the GUC", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);
    assert.equal(calls.filter((c) => c.model === "$executeRawUnsafe").length, 0);
    for (const call of calls) {
      if (call.args && typeof call.args.sql === "string") {
        assert.ok(!call.args.sql.includes(VALID_UUID));
      }
    }
  });

  it("source uses parameterized set_config, never $executeRawUnsafe", () => {
    const src = readFileSync(new URL("../lib/tender/delete-tender.ts", import.meta.url), "utf8");
    assert.ok(src.includes("set_config('app.tender_deletion_context'"));
    assert.ok(!src.includes("$executeRawUnsafe"));
    assert.ok(!src.includes("SET LOCAL app.tender_deletion_context"));
  });

  it("explicitly deletes TenderRequirement", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);
    const reqDelete = calls.find((c) => c.model === "tenderRequirement" && c.method === "deleteMany");
    assert.ok(reqDelete);
    assert.equal(reqDelete.args.where.tenderId, VALID_UUID);
  });

  it("rejects invalid tenderId format", async () => {
    const { tx } = createMockTx({});
    await assert.rejects(
      executeTenderDeletion(tx, "not-a-uuid'; DROP TABLE--", "corr-1", ACTOR_ID),
      /Invalid tenderId format/,
    );
  });

  it("calls child deletions in correct FK order", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);
    const seq = calls.map((c) => `${c.model}.${c.method}`);
    const cmIdx = seq.indexOf("complianceMatrix.deleteMany");
    const trIdx = seq.indexOf("tenderRequirement.deleteMany");
    const tenderIdx = seq.indexOf("tender.delete");
    assert.ok(cmIdx >= 0 && trIdx >= 0);
    assert.ok(cmIdx < trIdx);
    assert.ok(trIdx < tenderIdx);
  });

  it("rolls back on any AiUsageRecord error", async () => {
    const p2021Error = new Prisma.PrismaClientKnownRequestError(
      "Table does not exist",
      { code: "P2021", clientVersion: "6.19.3" } as any,
    );
    const { tx } = createMockTx({ aiUsageError: p2021Error });
    await assert.rejects(
      remove(tx),
      (error: any) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021",
    );
  });

  it("rolls back on generic AiUsageRecord error", async () => {
    const { tx } = createMockTx({ aiUsageError: new Error("Connection refused") });
    await assert.rejects(remove(tx), /Connection refused/);
  });

  it("rolls back when Tender.delete fails", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      "Record not found",
      { code: "P2025", clientVersion: "6.19.3" } as any,
    );
    const { tx } = createMockTx({ tenderDeleteError: p2025 });
    await assert.rejects(remove(tx), (error: any) => error.code === "P2025");
  });

  it("deletes GeneratedDocument children when docs exist", async () => {
    const { tx, calls } = createMockTx({
      generatedDocs: [{ id: "d1" }, { id: "d2" }],
    });
    await remove(tx);
    const reviewDelete = calls.find((c) => c.model === "documentReview");
    assert.ok(reviewDelete);
    assert.deepEqual(reviewDelete.args.where.documentId.in, ["d1", "d2"]);
  });

  it("skips GeneratedDocument children when no docs exist", async () => {
    const { tx, calls } = createMockTx({ generatedDocs: [] });
    await remove(tx);
    assert.ok(!calls.find((c) => c.model === "documentReview"));
  });

  it("deletes AiJobStep with jobId filter when AiJobs exist", async () => {
    const { tx, calls } = createMockTx({ aiJobs: [{ id: "j1" }] });
    await remove(tx);
    const step = calls.find((c) => c.model === "aiJobStep");
    assert.ok(step);
    assert.deepEqual(step.args.where.jobId.in, ["j1"]);
  });

  it("nullifies AiUsageRecord", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);
    const usage = calls.find((c) => c.model === "aiUsageRecord" && c.method === "updateMany");
    assert.ok(usage);
    assert.equal(usage.args.data.tenderId, null);
  });

  it("deletes scalar orphan tables", async () => {
    const { tx, calls } = createMockTx({});
    await remove(tx);
    assert.ok(calls.find((c) => c.model === "fallbackApprovalRecord"));
    assert.ok(calls.find((c) => c.model === "extractionQualityOverride"));
  });

  it("persists a deduplicated external-storage manifest before deleting Tender", async () => {
    const { tx, calls } = createMockTx({
      tenderFiles: [
        { storagePath: "blob://source.pdf", originalFileName: "source.pdf" },
        { storagePath: "", originalFileName: "inline.pdf" },
      ],
      generatedDocs: [
        { id: "d1", storagePath: "blob://proposal.docx", exactFileName: "proposal.docx" },
        { id: "d2", storagePath: "blob://source.pdf", exactFileName: "duplicate.pdf" },
      ],
    });
    const result = await remove(tx);

    assert.equal(result.storageCleanupTaskId, "cleanup-task-1");
    const task = calls.find((c) => c.model === "auditLog" && c.method === "create");
    assert.ok(task);
    assert.equal(task.args.data.userId, ACTOR_ID);
    const saved = JSON.parse(task.args.data.metadata);
    assert.deepEqual(saved.files, [
      { storagePath: "blob://source.pdf", fileName: "source.pdf" },
      { storagePath: "blob://proposal.docx", fileName: "proposal.docx" },
    ]);
    assert.doesNotMatch(task.args.data.metadata, /fileContent/);

    const taskIndex = calls.indexOf(task);
    const tenderIndex = calls.findIndex((c) => c.model === "tender" && c.method === "delete");
    assert.ok(taskIndex >= 0 && tenderIndex > taskIndex);
  });

  it("creates no cleanup task when every file is database-only", async () => {
    const { tx, calls } = createMockTx({
      tenderFiles: [{ storagePath: "", originalFileName: "inline.pdf" }],
      generatedDocs: [{ id: "d1", storagePath: null, exactFileName: "inline.docx" }],
    });
    const result = await remove(tx);
    assert.equal(result.storageCleanupTaskId, null);
    assert.ok(!calls.find((c) => c.model === "auditLog" && c.method === "create"));
  });

  it("deletes Tender last after the cleanup task and all children", async () => {
    const { tx, calls } = createMockTx({
      generatedDocs: [{ id: "d1", storagePath: "blob://proposal.docx", exactFileName: "proposal.docx" }],
    });
    await remove(tx);
    const seq = calls.map((c) => `${c.model}.${c.method}`);
    const tenderIdx = seq.indexOf("tender.delete");
    const beforeTender = seq.slice(0, tenderIdx);
    assert.ok(beforeTender.includes("tenderRequirement.deleteMany"));
    assert.ok(beforeTender.includes("fallbackApprovalRecord.deleteMany"));
    assert.ok(beforeTender.includes("aiUsageRecord.updateMany"));
    assert.ok(beforeTender.includes("auditLog.create"));
  });
});
