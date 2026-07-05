import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { PrismaClient } from "@prisma/client";
import { bindPrismaMethodsForReadiness } from "../lib/tender-generation-readiness-strict";

describe("generation readiness Prisma runtime binding", () => {
  it("keeps extracted Prisma methods bound to the original client", () => {
    const tenderDelegate = { findFirst: () => null };
    const fakeClient = {
      marker: 37,
      tender: tenderDelegate,
      $queryRaw(this: { marker: number }) {
        return this.marker;
      },
    } as unknown as PrismaClient;

    const bound = bindPrismaMethodsForReadiness(fakeClient) as unknown as {
      tender: typeof tenderDelegate;
      $queryRaw: () => number;
    };

    const extractedQueryRaw = bound.$queryRaw;
    assert.equal(extractedQueryRaw(), 37, "an extracted Prisma method must retain its client receiver");
    assert.equal(bound.tender, tenderDelegate, "model delegates must not be wrapped or replaced");
  });

  it("does not mutate the original Prisma client", () => {
    const originalQuery = function (this: { marker: number }) { return this.marker; };
    const fakeClient = { marker: 11, $queryRaw: originalQuery } as unknown as PrismaClient;
    const bound = bindPrismaMethodsForReadiness(fakeClient) as unknown as { $queryRaw: () => number };

    assert.equal((fakeClient as unknown as { $queryRaw: unknown }).$queryRaw, originalQuery);
    assert.equal(bound.$queryRaw(), 11);
  });
});
