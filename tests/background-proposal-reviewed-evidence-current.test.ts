import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai-job-handlers.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

function proposalRegion(): string {
  const start = source.indexOf("PROPOSAL_GENERATION: async");
  const end = source.indexOf("// ─── EVALUATOR_SIM", start);
  assert.ok(start >= 0 && end > start, "proposal handler region must exist");
  return source.slice(start, end);
}

describe("background proposal reviewed-evidence authority", () => {
  it("queries only reviewed active selected experts and projects", () => {
    const region = proposalRegion();
    assert.match(region, /expert: \{ is: \{ trustLevel: "REVIEWED", deletedAt: null \} \}/);
    assert.match(region, /project: \{ is: \{ trustLevel: "REVIEWED", deletedAt: null \} \}/);
    assert.doesNotMatch(region, /expertMatches: \{ where: \{ isSelected: true \}, include/);
    assert.doesNotMatch(region, /projectMatches: \{ where: \{ isSelected: true \}, include/);
  });

  it("blocks evidence-dependent sections when reviewed proof is absent", () => {
    const region = proposalRegion();
    assert.match(region, /needsReviewedExperts/);
    assert.match(region, /needsReviewedProjects/);
    assert.match(region, /NO_REVIEWED_EXPERT_EVIDENCE/);
    assert.match(region, /NO_REVIEWED_PROJECT_EVIDENCE/);
    assert.match(region, /sectionFilter\.includes\("technical-approach"\)/);
    assert.match(region, /sectionFilter\.includes\("company-and-experience"\)/);
  });

  it("requires the Company Vault before constructing prompt input", () => {
    const region = proposalRegion();
    const companyGuard = region.indexOf("Company Vault not found");
    const input = region.indexOf("const input: AIBidWriterInput");
    assert.ok(companyGuard >= 0 && input > companyGuard);
  });

  it("uses preflight, post-generation, and transactional readiness gates", () => {
    const region = proposalRegion();
    const gates = region.match(/purpose: "background-proposal-generation"/g) ?? [];
    assert.equal(gates.length, 3);
    const generatePos = region.indexOf("generateProposalSectionsParallel");
    const postGatePos = region.indexOf("const postGenerationReadiness");
    const persistPos = region.indexOf("withTransactionalGenerationGate");
    assert.ok(generatePos >= 0 && postGatePos > generatePos && persistPos > postGatePos);
  });

  it("rejects empty or insufficient provider output before byte persistence", () => {
    const region = proposalRegion();
    const outputCheck = region.indexOf("AI_PROPOSAL_OUTPUT_INSUFFICIENT");
    const byteEncode = region.indexOf("Buffer.from(markdown");
    assert.ok(outputCheck >= 0 && byteEncode > outputCheck);
    assert.match(region, /markdown\.trim\(\)\.length < 50/);
  });

  it("preserves transactional zero-row persistence and non-exportable review state", () => {
    const region = proposalRegion();
    assert.match(region, /withTransactionalGenerationGate/);
    assert.match(region, /lockedTx\.generatedDocument\.create/);
    assert.doesNotMatch(region, /prisma\.generatedDocument\.create/);
    assert.match(region, /reviewStatus: "NOT_EXPORTABLE"/);
    assert.match(region, /validationStatus: "PENDING"/);
  });

  it("keeps Vercel Git deployment enabled for main (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled?.main, true);
  });
});
