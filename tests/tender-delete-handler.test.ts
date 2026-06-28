/**
 * Handler-level unit tests for tender deletion.
 *
 * These tests mock the Prisma transaction client to verify the actual
 * TypeScript code in lib/tender/delete-tender.ts — NOT a SQL simulation.
 *
 * Catches bugs the PGlite integration tests can't:
 *  - Wrong field names in where clauses
 *  - Wrong call ordering at the TypeScript level
 *  - The deletion-context GUC is set via parameterized set_config (no
 *    $executeRawUnsafe, tenderId passed as a bind parameter)
 *  - Error handling paths (P2021, P2025, generic errors)
 *  - UUID validation as defense in depth
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { executeTenderDeletion } from "../lib/tender/delete-tender";
import { Prisma } from "@prisma/client";

function createMockTx(config: {
  generatedDocs?: { id: string }[];
  aiJobs?: { id: string }[];
  pricingWorkbooks?: { id: string }[];
  orphanedReqCount?: number;
  aiUsageError?: Error;
  tenderDeleteError?: Error;
}): { tx: any; calls: Array<{ model: string; method: string; args: any }> } {
  const calls: Array<{ model: string; method: string; args: any }> = [];

  const makeModel = (modelName: string) => {
    const model: any = {};
    for (const method of ["deleteMany", "findMany", "delete", "count", "updateMany"]) {
      model[method] = async (args: any) => {
        calls.push({ model: modelName, method, args });
        if (method === "findMany") {
          if (modelName === "generatedDocument") return config.generatedDocs ?? [];
          if (modelName === "aiJob") return config.aiJobs ?? [];
          if (modelName === "pricingWorkbook") return config.pricingWorkbooks ?? [];
          return [];
        }
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
        // Tagged-template form: (strings, ...values). The interpolated values
        // are sent as bind parameters — they never appear in the SQL text.
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

describe("executeTenderDeletion — handler-level unit tests", () => {

  it("sets transaction-local GUC context before any deletes (parameterized set_config)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");

    const gucCall = calls.find((c) => c.model === "$executeRaw");
    assert.ok(gucCall, "GUC must be set via parameterized $executeRaw");
    assert.ok(gucCall.args.sql.includes("set_config"),
      `GUC SQL must use set_config(...), got: ${gucCall.args.sql}`);
    assert.ok(gucCall.args.sql.includes("app.tender_deletion_context"),
      "GUC must set app.tender_deletion_context");
    assert.ok(gucCall.args.sql.includes("true"),
      "set_config must use is_local => true (transaction-local scope)");
    // The tenderId must be a BOUND PARAMETER — never interpolated into the text.
    assert.ok(!gucCall.args.sql.includes(VALID_UUID),
      "tenderId must NOT appear in the SQL text — it must be parameterized");
    assert.deepEqual(gucCall.args.values, [VALID_UUID],
      "tenderId must be passed as a bind parameter to set_config");

    // GUC must be the FIRST call (before any deletes)
    const firstCall = calls[0];
    assert.equal(firstCall.model, "$executeRaw",
      "set_config must be the first operation in the transaction");
  });

  it("uses NO unsafe raw SQL for the GUC (no $executeRawUnsafe; tenderId never interpolated)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");

    // The deletion handler must NEVER reach for the unsafe raw escape hatch.
    const unsafe = calls.filter((c) => c.model === "$executeRawUnsafe");
    assert.equal(unsafe.length, 0,
      "$executeRawUnsafe must not be used — the GUC is parameterized via set_config");

    // The GUC must be set via parameterized $executeRaw with the tenderId bound,
    // and no recorded SQL text may contain the raw tenderId value.
    const guc = calls.find((c) => c.model === "$executeRaw");
    assert.ok(guc, "GUC must be set via parameterized $executeRaw");
    assert.deepEqual(guc.args.values, [VALID_UUID],
      "tenderId must be a bind parameter, not interpolated");
    for (const c of calls) {
      if (c.args && typeof c.args.sql === "string") {
        assert.ok(!c.args.sql.includes(VALID_UUID),
          `No raw SQL may contain the tenderId value (found in ${c.model})`);
      }
    }
  });

  it("source: delete-tender.ts uses parameterized set_config, never $executeRawUnsafe for the GUC", () => {
    const src = readFileSync(new URL("../lib/tender/delete-tender.ts", import.meta.url), "utf8");
    assert.ok(src.includes("set_config('app.tender_deletion_context'"),
      "delete-tender.ts must set the GUC via set_config('app.tender_deletion_context', ...)");
    assert.ok(!src.includes("$executeRawUnsafe"),
      "delete-tender.ts must NOT use $executeRawUnsafe anywhere");
    assert.ok(!src.includes("SET LOCAL app.tender_deletion_context"),
      "delete-tender.ts must NOT use the un-parameterizable SET LOCAL utility statement for the GUC");
  });

  it("explicitly deletes TenderRequirement (not deferred to cascade)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");

    const reqDelete = calls.find((c) => c.model === "tenderRequirement" && c.method === "deleteMany");
    assert.ok(reqDelete, "TenderRequirement.deleteMany must be called explicitly");
    assert.equal(reqDelete.args.where.tenderId, VALID_UUID);
  });

  it("rejects invalid tenderId format (defense in depth, even though set_config is parameterized)", async () => {
    const { tx } = createMockTx({});
    await assert.rejects(
      executeTenderDeletion(tx, "not-a-uuid'; DROP TABLE--", "corr-1"),
      /Invalid tenderId format/,
      "Must reject non-UUID tenderId before setting the deletion-context GUC",
    );
  });

  it("calls all child deletions in correct order (ComplianceMatrix before TenderRequirement)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");

    const seq = calls.map((c) => `${c.model}.${c.method}`);
    const cmIdx = seq.indexOf("complianceMatrix.deleteMany");
    const trIdx = seq.indexOf("tenderRequirement.deleteMany");
    const tenderIdx = seq.indexOf("tender.delete");

    assert.ok(cmIdx >= 0 && trIdx >= 0, "ComplianceMatrix and TenderRequirement must both be called");
    assert.ok(cmIdx < trIdx, "ComplianceMatrix must be before TenderRequirement (FK ordering)");
    assert.ok(trIdx < tenderIdx, "TenderRequirement must be before Tender");
  });

  it("rolls back on ANY AiUsageRecord error (no P2021 skip)", async () => {
    const p2021Error = new Prisma.PrismaClientKnownRequestError(
      "Table does not exist",
      { code: "P2021", clientVersion: "6.19.3" } as any,
    );
    const { tx } = createMockTx({ aiUsageError: p2021Error });
    await assert.rejects(
      executeTenderDeletion(tx, VALID_UUID, "corr-1"),
      (err: any) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021",
    );
  });

  it("rolls back on generic AiUsageRecord error", async () => {
    const { tx } = createMockTx({ aiUsageError: new Error("Connection refused") });
    await assert.rejects(
      executeTenderDeletion(tx, VALID_UUID, "corr-1"),
      /Connection refused/,
    );
  });

  it("rolls back when Tender.delete fails (P2025)", async () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      "Record not found", { code: "P2025", clientVersion: "6.19.3" } as any,
    );
    const { tx } = createMockTx({ tenderDeleteError: p2025 });
    await assert.rejects(
      executeTenderDeletion(tx, VALID_UUID, "corr-1"),
      (err: any) => err.code === "P2025",
    );
  });

  it("deletes GeneratedDocument children when docs exist", async () => {
    const { tx, calls } = createMockTx({ generatedDocs: [{ id: "d1" }, { id: "d2" }] });
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");

    const dr = calls.find((c) => c.model === "documentReview");
    assert.ok(dr, "DocumentReview.deleteMany must be called");
    assert.deepEqual(dr.args.where.documentId.in, ["d1", "d2"]);
  });

  it("skips GeneratedDocument children when no docs exist", async () => {
    const { tx, calls } = createMockTx({ generatedDocs: [] });
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");
    assert.ok(!calls.find((c) => c.model === "documentReview"),
      "DocumentReview must NOT be called when no docs");
  });

  it("deletes AiJobStep with jobId filter when AiJobs exist", async () => {
    const { tx, calls } = createMockTx({ aiJobs: [{ id: "j1" }] });
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");
    const step = calls.find((c) => c.model === "aiJobStep");
    assert.ok(step, "AiJobStep.deleteMany must be called");
    assert.deepEqual(step.args.where.jobId.in, ["j1"]);
  });

  it("nullifies AiUsageRecord (updateMany with tenderId: null)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");
    const aur = calls.find((c) => c.model === "aiUsageRecord" && c.method === "updateMany");
    assert.ok(aur, "AiUsageRecord.updateMany must be called");
    assert.equal(aur.args.data.tenderId, null, "Must set tenderId to null (not delete)");
  });

  it("deletes scalar orphan tables (FallbackApprovalRecord + ExtractionQualityOverride)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");
    assert.ok(calls.find((c) => c.model === "fallbackApprovalRecord"), "FallbackApprovalRecord must be deleted");
    assert.ok(calls.find((c) => c.model === "extractionQualityOverride"), "ExtractionQualityOverride must be deleted");
  });

  it("deletes Tender last (after all children)", async () => {
    const { tx, calls } = createMockTx({});
    await executeTenderDeletion(tx, VALID_UUID, "corr-1");
    const seq = calls.map((c) => `${c.model}.${c.method}`);
    const tenderIdx = seq.indexOf("tender.delete");
    // Every deleteMany except tender must come before tender.delete
    const beforeTender = seq.slice(0, tenderIdx);
    assert.ok(beforeTender.includes("tenderRequirement.deleteMany"), "TenderRequirement before Tender");
    assert.ok(beforeTender.includes("fallbackApprovalRecord.deleteMany"), "orphan tables before Tender");
    assert.ok(beforeTender.includes("aiUsageRecord.updateMany"), "AiUsageRecord before Tender");
  });
});
