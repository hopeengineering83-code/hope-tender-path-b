import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const generationPanel = readFileSync("components/generation-action-panel.tsx", "utf8");
const aiAnalyzePanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const workflowOwner = readFileSync("components/workflow-step-links.tsx", "utf8");
const corruptedBanner = readFileSync("components/corrupted-metadata-banner.tsx", "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const generationPanelCode = stripComments(generationPanel);
const aiAnalyzePanelCode = stripComments(aiAnalyzePanel);
const workflowOwnerCode = stripComments(workflowOwner);
const corruptedBannerCode = stripComments(corruptedBanner);

describe("generation remains an automatic text-status surface", () => {
  it("uses the five canonical release statuses", () => {
    for (const status of [
      "PROCESSING_AUTOMATICALLY",
      "GENUINE_SOURCE_BLOCKED",
      "LEGAL_RELEASE_REQUIRED",
      "READY_TO_DOWNLOAD",
      "FAILED_SECURITY_OR_INTEGRITY",
    ]) assert.match(generationPanelCode, new RegExp(status));
  });

  it("has no Generate Docs or repair mutation buttons", () => {
    assert.doesNotMatch(generationPanelCode, /Generate Docs/);
    assert.doesNotMatch(generationPanelCode, /Repair Tender Details/);
    assert.doesNotMatch(generationPanelCode, /BlockerActionLink/);
  });

  it("renders Final ZIP only when ready", () => {
    assert.match(generationPanelCode, /status === "READY_TO_DOWNLOAD"/);
    assert.match(generationPanelCode, /Download Final ZIP/);
  });
});

describe("AI Analyze has a MANUAL Run AI Analyze button", () => {
  it("the detailed AI panel contains a visible Run AI Analyze button", () => {
    assert.match(aiAnalyzePanelCode, /Run AI Analyze/);
    assert.match(aiAnalyzePanelCode, /manual-ai-analyze/);
    assert.match(aiAnalyzePanelCode, /AI Analyze running/);
    assert.match(aiAnalyzePanelCode, /Analysis complete/);
    // Must NOT say "Automatic AI analysis pending" — AI Analyze is manual.
    assert.doesNotMatch(aiAnalyzePanelCode, /Automatic AI analysis pending/);
  });

  it("keeps WorkflowStepLinks navigation-only with truthful status copy", () => {
    // workflow-step-links must NOT call manual-ai-analyze or engine.
    assert.doesNotMatch(workflowOwnerCode, /manual-ai-analyze/);
    assert.doesNotMatch(workflowOwnerCode, /method:\s*"POST"/);
    assert.doesNotMatch(workflowOwnerCode, /\/api\/tenders\/\$\{tenderId\}\/engine/);
    // Must show truthful status messages instead of "Processing automatically".
    assert.doesNotMatch(workflowOwnerCode, /No AI Analyze or Run Engine action is required/);
    assert.match(workflowOwnerCode, /Open \{currentLabel\} details/);
  });

  it("keeps provider diagnostics secondary and read-only", () => {
    assert.match(aiAnalyzePanelCode, /Check provider diagnostics/);
    // The panel uses fetch with cache: "no-store" for read-only diagnostics.
    assert.match(aiAnalyzePanelCode, /cache:\s*"no-store"/);
  });
});

describe("corrupted metadata repair remains automatic", () => {
  it("does not expose a normal-path repair button", () => {
    assert.doesNotMatch(corruptedBannerCode, /canMutate && <RepairTenderFactsButton/);
    assert.doesNotMatch(corruptedBannerCode, /Clean now/);
    assert.match(corruptedBannerCode, /automatic/i);
  });
});
