import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { userOwnsTenderForProposalJob } from "../lib/engine/ai-proposal-job-ownership";

describe("AI proposal job ownership guard", () => {
  it("queries tender ownership using both tender and user IDs", async () => {
    let received: unknown = null;
    const owned = await userOwnsTenderForProposalJob({
      tender: {
        async findFirst(args) {
          received = args;
          return { id: "tender-1" };
        },
      },
    }, "tender-1", "user-1");

    assert.equal(owned, true);
    assert.deepEqual(received, {
      where: { id: "tender-1", userId: "user-1" },
      select: { id: true },
    });
  });

  it("returns false for missing or foreign tenders", async () => {
    const owned = await userOwnsTenderForProposalJob({
      tender: { async findFirst() { return null; } },
    }, "foreign-tender", "user-1");
    assert.equal(owned, false);
  });

  it("runs the ownership check before any proposal AiJob create", () => {
    const source = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    const ownershipPos = source.indexOf("userOwnsTenderForProposalJob(");
    const createPos = source.indexOf("prisma.aiJob.create({");
    assert.ok(ownershipPos >= 0, "route must call the ownership helper");
    assert.ok(createPos >= 0, "route must create proposal jobs only after ownership");
    assert.ok(ownershipPos < createPos, "ownership must be resolved before AiJob.create");
    const between = source.slice(ownershipPos, createPos);
    assert.match(between, /Tender not found/);
    assert.match(between, /status: 404/);
  });

  it("keeps resume-job lookup scoped to tender and user", () => {
    const source = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    assert.match(source, /findFirst\(\{ where: \{ id: resumeJobId, tenderId, userId: uid \} \}\)/);
  });

  it("keeps Vercel Git deployment disabled", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    assert.equal(config.git?.deploymentEnabled, false);
  });
});
