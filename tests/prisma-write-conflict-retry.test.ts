import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  isPrismaWriteConflict,
  withPrismaWriteConflictRetry,
} from "../lib/prisma-write-conflict-retry";

describe("Prisma write-conflict retry", () => {
  it("recognizes only Prisma P2034-shaped errors", () => {
    assert.equal(isPrismaWriteConflict({ code: "P2034" }), true);
    assert.equal(isPrismaWriteConflict({ code: "P2002" }), false);
    assert.equal(isPrismaWriteConflict(new Error("P2034")), false);
    assert.equal(isPrismaWriteConflict(null), false);
  });

  it("restarts the complete operation after bounded write conflicts", async () => {
    let attempts = 0;
    const retries: number[] = [];

    const result = await withPrismaWriteConflictRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw { code: "P2034" };
      return "committed";
    }, {
      maxAttempts: 3,
      baseDelayMs: 0,
      onRetry: ({ attempt }) => retries.push(attempt),
    });

    assert.equal(result, "committed");
    assert.equal(attempts, 3);
    assert.deepEqual(retries, [1, 2]);
  });

  it("does not retry unrelated database or application failures", async () => {
    let attempts = 0;
    const failure = { code: "P2003" };

    await assert.rejects(
      withPrismaWriteConflictRetry(async () => {
        attempts += 1;
        throw failure;
      }, { maxAttempts: 5, baseDelayMs: 0 }),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
  });

  it("rethrows P2034 after the configured final attempt", async () => {
    let attempts = 0;
    await assert.rejects(
      withPrismaWriteConflictRetry(async () => {
        attempts += 1;
        throw { code: "P2034" };
      }, { maxAttempts: 3, baseDelayMs: 0 }),
      (error) => isPrismaWriteConflict(error),
    );
    assert.equal(attempts, 3);
  });
});
