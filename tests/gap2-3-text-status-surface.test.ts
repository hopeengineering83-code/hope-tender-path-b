// Gap 2 + Gap 3 contract test: text-based automatic status surface.
//
// The GenerationActionPanel must now render one of exactly five text
// statuses — no icons, no badges, no buttons (except the Download ZIP
// link when READY_TO_DOWNLOAD). The ai-analyze-panel must have no
// normal-path buttons either.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const generationPanel = readFileSync("components/generation-action-panel.tsx", "utf8");
const aiAnalyzePanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const corruptedBanner = readFileSync("components/corrupted-metadata-banner.tsx", "utf8");

// Strip comments before matching — we only care about code, not docs.
function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const generationPanelCode = stripComments(generationPanel);
const aiAnalyzePanelCode = stripComments(aiAnalyzePanel);
const corruptedBannerCode = stripComments(corruptedBanner);

describe("Gap 3 — text-based automatic status surface", () => {
  it("generation-action-panel exports ReleaseStatus type with exactly 5 statuses", () => {
    assert.match(generationPanelCode, /PROCESSING_AUTOMATICALLY/);
    assert.match(generationPanelCode, /GENUINE_SOURCE_BLOCKED/);
    assert.match(generationPanelCode, /LEGAL_RELEASE_REQUIRED/);
    assert.match(generationPanelCode, /READY_TO_DOWNLOAD/);
    assert.match(generationPanelCode, /FAILED_SECURITY_OR_INTEGRITY/);
  });

  it("generation-action-panel exports deriveReleaseStatus function", () => {
    assert.match(generationPanelCode, /export function deriveReleaseStatus/);
  });

  it("generation-action-panel has NO Generate Docs button", () => {
    assert.doesNotMatch(generationPanelCode, /Generate Docs/);
  });

  it("generation-action-panel has NO BlockerActionLink import or usage", () => {
    assert.doesNotMatch(generationPanelCode, /BlockerActionLink/);
  });

  it("generation-action-panel has NO Repair Tender Details button", () => {
    assert.doesNotMatch(generationPanelCode, /Repair Tender Details/);
  });

  it("generation-action-panel has NO support/full-proposal pills", () => {
    assert.doesNotMatch(generationPanelCode, /Support evidence:/);
    assert.doesNotMatch(generationPanelCode, /Full proposal:/);
  });

  it("generation-action-panel has NO CanonicalStatusBadge import or usage", () => {
    assert.doesNotMatch(generationPanelCode, /CanonicalStatusBadge/);
  });

  it("generation-action-panel has NO icon imports (DocumentGenerateIcon, RefreshIcon, etc.)", () => {
    assert.doesNotMatch(generationPanelCode, /DocumentGenerateIcon/);
    assert.doesNotMatch(generationPanelCode, /RefreshIcon/);
    assert.doesNotMatch(generationPanelCode, /WarningIcon/);
    assert.doesNotMatch(generationPanelCode, /CheckCircleIcon/);
    assert.doesNotMatch(generationPanelCode, /BanIcon/);
  });

  it("generation-action-panel renders Download ZIP link only when READY_TO_DOWNLOAD", () => {
    assert.match(generationPanelCode, /status === "READY_TO_DOWNLOAD"/);
    assert.match(generationPanelCode, /Download Final ZIP/);
  });
});

describe("Gap 2 — no normal-path workflow buttons in AI Analyze panel", () => {
  it("ai-analyze-panel has NO Run AI Analyze button", () => {
    assert.doesNotMatch(aiAnalyzePanelCode, /Run AI Analyze/);
  });

  it("ai-analyze-panel has NO Retry now button", () => {
    assert.doesNotMatch(aiAnalyzePanelCode, /Retry now/);
  });

  it("ai-analyze-panel has NO Retry AI Analyze button", () => {
    assert.doesNotMatch(aiAnalyzePanelCode, /Retry AI Analyze/);
  });

  it("ai-analyze-panel has NO Diagnose providers button", () => {
    assert.doesNotMatch(aiAnalyzePanelCode, /Diagnose providers/);
  });

  it("ai-analyze-panel shows text-based status (Processing automatically / Analysis complete / Pending)", () => {
    assert.match(aiAnalyzePanelCode, /Processing automatically/);
    assert.match(aiAnalyzePanelCode, /Analysis complete/);
    assert.match(aiAnalyzePanelCode, /Pending automatic analysis/);
  });
});

// The Engine Action panel block asserted "this file contains no button" five
// times over. All five were true and none proved anything: the panel had
// stopped being reachable UI, so it could not have shown a button either way.
// It was deleted. The guarantee that survives its deletion — that no surface
// anywhere offers to run the Engine — is in
// tests/engine-is-not-a-user-action.test.ts.

describe("Gap 2 — no normal-path button in corrupted-metadata-banner", () => {
  it("corrupted-metadata-banner has NO RepairTenderFactsButton in normal path", () => {
    assert.doesNotMatch(corruptedBannerCode, /canMutate && <RepairTenderFactsButton/);
  });

  it("corrupted-metadata-banner says repair is automatic (no 'Clean now' in code)", () => {
    assert.doesNotMatch(corruptedBannerCode, /Clean now/);
    assert.match(corruptedBannerCode, /automatic/i);
  });
});
