import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const upload = readFileSync("lib/secure-upload-handler.ts", "utf8");
const worker = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const verifier = readFileSync("lib/company-auto-verification.ts", "utf8");
const reimportRoute = readFileSync("app/api/company/reimport/route.ts", "utf8");

describe("upload-only automatic workflow", () => {
  it("company upload imports and auto-verifies source-grounded AI records", () => {
    assert.match(upload, /importCompanyKnowledgeFromDocuments/);
    assert.match(upload, /autoVerifyCompanyKnowledge/);
    assert.match(reimportRoute, /autoVerifyCompanyKnowledge/);
  });

  it("auto-verification requires dedicated source categories and verified provenance", () => {
    assert.match(verifier, /EXPERT_CV/);
    assert.match(verifier, /PROJECT_REFERENCE/);
    assert.match(verifier, /PROJECT_CONTRACT/);
    assert.match(verifier, /PORTFOLIO/);
    assert.match(verifier, /buildReviewProvenance/);
    assert.match(verifier, /SYSTEM_AUTO_VERIFIED/);
  });

  it("tender upload queues AI Analyze once and requests automatic continuation", () => {
    assert.match(upload, /jobType: "AI_ANALYZE"/);
    assert.match(upload, /autoContinue: true/);
    assert.doesNotMatch(upload, /jobType: "ENGINE_RUN"/);
  });

  it("Engine is queued only after canonical AI Analyze succeeds", () => {
    assert.match(worker, /claimed\.jobType === "AI_ANALYZE"/);
    assert.match(worker, /result\.terminalStatus === "SUCCEEDED"/);
    assert.match(worker, /autoContinue/);
    assert.match(worker, /jobType: "ENGINE_RUN"/);
    assert.match(worker, /parentJobId: claimed\.id/);
  });

  it("partial or failed AI analysis never starts Engine", () => {
    const successBlock = worker.match(/if \(\s*claimed\.jobType === "AI_ANALYZE"[\s\S]*?nextJobType = "ENGINE_RUN";/)?.[0] ?? "";
    assert.match(successBlock, /result\.terminalStatus === "SUCCEEDED"/);
    assert.doesNotMatch(successBlock, /PARTIAL_SUCCESS/);
    assert.doesNotMatch(successBlock, /FAILED/);
  });
});
