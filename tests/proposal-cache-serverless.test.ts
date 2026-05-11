import test from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("proposal cache is disabled by default on Vercel", async () => {
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";
  delete process.env.ENABLE_IN_MEMORY_PROPOSAL_CACHE;
  delete process.env.DISABLE_IN_MEMORY_PROPOSAL_CACHE;

  const mod = await import(`../lib/proposal-cache.ts?case=${Date.now()}-vercel`);
  const key = mod.buildProposalCacheKey("t1", ["e1"], ["p1"], "parallel");
  mod.setCachedProposal(key, "cached proposal", false);

  assert.equal(mod.getCachedProposal(key), null);
});

test("proposal cache can be explicitly enabled for controlled deployments", async () => {
  process.env.VERCEL = "1";
  process.env.NODE_ENV = "production";
  process.env.ENABLE_IN_MEMORY_PROPOSAL_CACHE = "true";
  delete process.env.DISABLE_IN_MEMORY_PROPOSAL_CACHE;

  const mod = await import(`../lib/proposal-cache.ts?case=${Date.now()}-enabled`);
  const key = mod.buildProposalCacheKey("t2", ["e1"], ["p1"], "parallel");
  mod.setCachedProposal(key, "cached proposal", false);

  assert.deepEqual(mod.getCachedProposal(key), { proposal: "cached proposal", fallback: false });
});
