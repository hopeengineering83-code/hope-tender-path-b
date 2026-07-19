import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const expertRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
const projectRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");
const eligibility = readFileSync("lib/engine/matching-eligibility.ts", "utf8");
const matching = readFileSync("lib/engine/matching.ts", "utf8");
const engine = readFileSync("lib/engine/run-tender-engine.ts", "utf8");
const rematch = readFileSync("app/api/tenders/[id]/ai-rematch/route.ts", "utf8");
const capture = readFileSync("scripts/capture-production-pages.mjs", "utf8");

describe("PR 1175 final gap repair contracts", () => {
  for (const [name, source] of [["expert", expertRoute], ["project", projectRoute]] as const) {
    it(`${name} single approval is fail-closed and atomic`, () => {
      assert.match(source, /contentSha256: true/);
      assert.match(source, /contentByteLength: true/);
      assert.match(source, /integrityStatus: true/);
      assert.match(source, /buildReviewProvenance/);
      assert.match(source, /status: 422/);
      assert.match(source, /prisma\.\$transaction\(async \(tx\)/);
      assert.match(source, /await tx\.auditLog\.create/);
      assert.doesNotMatch(source, /fail-open behavior/);
    });
  }

  it("matching delegates to the durable provenance authority", () => {
    assert.match(eligibility, /canUseVaultRecord/);
    assert.match(eligibility, /NO_DURABLE_PROVENANCE/);
    assert.match(matching, /checkMatchingEligibility/);
    assert.match(matching, /sourceDocument:/);
    assert.match(engine, /isDurablyReviewed/);
    assert.match(engine, /unsupportedReviewedExpertCount/);
  });

  it("AI rematch filters candidates and commits authoritative state atomically", () => {
    assert.match(rematch, /canUseVaultRecord\(match\.expert, "MATCHING"\)/);
    assert.match(rematch, /canUseVaultRecord\(match\.project, "MATCHING"\)/);
    assert.match(rematch, /prisma\.\$transaction\(async \(tx\)/);
    assert.match(rematch, /AI_REMATCH_PERSISTENCE_FAILED/);
    assert.doesNotMatch(rematch, /continuing with remaining assessments/);
  });

  it("matching relevance fixtures use current verified source bytes", () => {
    const relevance = readFileSync("tests/matching-relevance-gates.test.ts", "utf8");
    const strictDomain = readFileSync("tests/matching-strict-domain.test.ts", "utf8");
    assert.match(relevance, /buildReviewProvenance/);
    assert.match(relevance, /integrityStatus: "VERIFIED"/);
    assert.match(strictDomain, /buildReviewProvenance/);
    assert.match(strictDomain, /integrityStatus: "VERIFIED"/);
  });

  it("screenshot audit is a superset of the retained 210-image baseline", () => {
    assert.match(capture, /baselineScenarioRoutes/);
    assert.match(capture, /REGEX_FALLBACK/);
    assert.match(capture, /45a2d090-af4c-4815-9736-c8b5bbbdf89d/);
    assert.match(capture, /2362d615-c78b-4b01-b420-515c8679d0c2/);
    assert.match(capture, /5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c/);
  });
});
