import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("AI proposal generation authority", () => {
  it("passes the canonical gate before creating or resuming proposal jobs", () => {
    const gatePos = source.indexOf("const initialGenerationGate =");
    const createPos = source.indexOf("prisma.aiJob.create({");
    const cachedPos = source.indexOf("cached.chunks[chunkKey]");
    assert.ok(gatePos >= 0, "initial canonical generation gate must exist");
    assert.ok(createPos > gatePos, "gate must precede AiJob.create");
    assert.ok(cachedPos > gatePos, "gate must precede cached chunk return");
    assert.match(source, /purpose: "ai-proposal"/);
  });

  it("does not generate deterministic proposal fallback when AI or company context is unavailable", () => {
    assert.doesNotMatch(source, /fallbackProposal\(/);
    assert.doesNotMatch(source, /deterministic fallback used/);
    assert.doesNotMatch(source, /success: true, proposal, fallback: true/);
    assert.match(source, /AI_PROPOSAL_UNAVAILABLE/);
    assert.match(source, /fallbackApplied: false/);
    assert.match(source, /No deterministic fallback was returned/);
  });

  it("keeps only reviewed selected or reviewed Vault evidence in prompts", () => {
    assert.match(source, /selectReviewedEvidenceForAIDraft/);
    assert.match(source, /No reviewed expert evidence available/);
    assert.match(source, /No reviewed project evidence available/);
    assert.doesNotMatch(source, /using .*unreviewed/i);
  });

  it("rechecks readiness before returning generated proposal content", () => {
    const responseGatePos = source.indexOf("const responseGenerationGate =");
    const responsePos = source.lastIndexOf("return NextResponse.json({");
    assert.ok(responseGatePos >= 0, "response gate must exist");
    assert.ok(responsePos > responseGatePos, "response gate must precede final response");
    assert.match(source, /Proposal readiness changed while AI generation was running/);
  });

  it("does not return proposal text when the persistence gate changes", () => {
    const blockedPos = source.indexOf("AI_PROPOSAL_PERSIST_BLOCKED");
    const blockedRegion = source.slice(blockedPos, blockedPos + 1800);
    assert.ok(blockedPos >= 0);
    assert.match(blockedRegion, /success: false/);
    assert.match(blockedRegion, /status: 409/);
    assert.doesNotMatch(blockedRegion, /proposal,/);
  });

  it("preserves chunk checkpointing only for successful AI output", () => {
    assert.match(source, /saveChunkOutput\(proposalJobId/);
    assert.match(source, /status: "SUCCEEDED"/);
    assert.doesNotMatch(source, /fallback \? "FAILED" : "SUCCEEDED"/);
    assert.match(source, /fallback: false/);
  });

  it("keeps provider fallback order implementation and rate-limit handling intact", () => {
    assert.match(source, /generateProposalSectionsParallel/);
    assert.match(source, /generateBenchmarkProposalWithAI/);
    assert.match(source, /AI_RATE_LIMITED/);
    assert.match(source, /rateLimitRetry: true/);
  });

  it("keeps Git-triggered Vercel deployment disabled", () => {
    assert.equal(vercel.git?.deploymentEnabled, false);
  });
});
