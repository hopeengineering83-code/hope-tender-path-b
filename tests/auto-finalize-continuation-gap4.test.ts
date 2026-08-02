// Source-text contract test: auto-finalize runs safe repairs automatically
// after PROPOSAL_GENERATION succeeds, removing the need for manual button
// clicks in the Export Readiness panel.
//
// Gap 4 + user req A/B/C: the app auto-finishes everything after upload.
// The pipeline is: Upload → Extract → AI_ANALYZE → ENGINE_RUN →
// PROPOSAL_GENERATION → (auto) repairSourceGrounding + repairExportGaps →
// export-ready. The app never says "source reference not found" because
// repairSourceGrounding runs automatically. Safe repairs (AI traces,
// placeholders, pricing leakage) run automatically. The only manual
// action remaining is the actual ZIP download.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");
const runNext = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const panel = readFileSync("components/export-readiness-panel.tsx", "utf8");
const authorityPanel = readFileSync("components/authority-review-panel.tsx", "utf8");

describe("auto-finalize continuation service (Gap 4 + user req A/B/C)", () => {
  it("exports runAutoFinalizeAfterGeneration", () => {
    assert.match(service, /export async function runAutoFinalizeAfterGeneration/);
  });

  it("runs repairSourceGrounding so the app never says 'source reference not found'", () => {
    assert.match(service, /import \{ repairSourceGrounding \} from "\.\.\/engine\/repair-source-grounding"/);
    assert.match(service, /await repairSourceGrounding\(tenderId/);
  });

  it("runs safe export-gap repairs (AI traces, placeholders, pricing leakage)", () => {
    assert.match(service, /runSafeExportRepairs/);
    assert.match(service, /runExportGapRepair/);
  });

  it("never throws — failures are logged so the worker never crashes", () => {
    assert.match(service, /logger\.warn.*source grounding repair failed/);
    assert.match(service, /logger\.warn.*export gap repair failed/);
  });
});

describe("run-next invokes auto-finalize after PROPOSAL_GENERATION succeeds", () => {
  it("imports runAutoFinalizeAfterGeneration", () => {
    assert.match(runNext, /import \{ runAutoFinalizeAfterGeneration \} from/);
  });

  it("calls runAutoFinalizeAfterGeneration when PROPOSAL_GENERATION succeeds", () => {
    const idx = runNext.indexOf('claimed.jobType === "PROPOSAL_GENERATION"');
    assert.ok(idx > -1, "PROPOSAL_GENERATION branch must exist");
    const region = runNext.slice(idx, idx + 800);
    assert.match(region, /runAutoFinalizeAfterGeneration\(/);
  });

  it("never crashes the worker on auto-finalize failure", () => {
    const idx = runNext.indexOf('claimed.jobType === "PROPOSAL_GENERATION"');
    const region = runNext.slice(idx, idx + 800);
    assert.match(region, /logger\.warn.*Auto-finalize after proposal generation failed/);
  });
});

describe("export-readiness panel removes normal-path bureaucracy (Gap 5 + user req C)", () => {
  // Check that the button rendering patterns are removed. The function
  // definitions may remain (unused) but the rendered buttons must be gone.
  // We check for the button title attributes and the specific button text
  // that appeared in the rendered JSX, not in function bodies.

  it("removes the multi-click Auto-finalize button", () => {
    // The old button had title="Auto-finalize documents for print/submission".
    assert.doesNotMatch(panel, /title="Auto-finalize documents for print\/submission"/);
  });

  it("removes the 'Use vault evidence' button", () => {
    // The old button had title="Link vault evidence to strengthen mandatory requirement coverage".
    assert.doesNotMatch(panel, /title="Link vault evidence to strengthen mandatory requirement coverage"/);
  });

  it("removes the 'Repair source references' button", () => {
    // The old button had title="Extract source page/section/quote for mandatory requirements...".
    assert.doesNotMatch(panel, /title="Extract source page\/section\/quote for mandatory requirements/);
  });

  it("removes the 'Fix document types' button", () => {
    // The old button had title="Reclassify mistyped documents...".
    assert.doesNotMatch(panel, /title="Reclassify mistyped documents/);
  });

  it("removes the 'Clean duplicate rows' button", () => {
    // The old button had title="Find and supersede duplicate document rows...".
    assert.doesNotMatch(panel, /title="Find and supersede duplicate document rows/);
  });

  it("removes the 'Exclude outside-plan files' button", () => {
    // The old button had title="Exclude outside-plan files from the final submission".
    assert.doesNotMatch(panel, /title="Exclude outside-plan files from the final submission"/);
  });

  it("removes the repeated 'Re-check' button", () => {
    // The old button had title="Re-check the export readiness gate".
    assert.doesNotMatch(panel, /title="Re-check the export readiness gate"/);
  });

  it("removes the 'Repair safe document gaps' button", () => {
    // The old button had title="Safely repair generated DOCX...".
    assert.doesNotMatch(panel, /title="Safely repair generated DOCX/);
  });

  it("keeps the 'Repair prohibited assets' button (exceptional, not normal-path)", () => {
    assert.match(panel, /Repair prohibited assets/);
  });

  it("keeps the 'Download Final ZIP' link (canonical download)", () => {
    assert.match(panel, /Download Final ZIP/);
  });

  it("keeps the 'Go to Generate missing planned docs' link (Build Plan navigation)", () => {
    assert.match(panel, /Go to Generate missing planned docs/);
  });
});

describe("authority-review panel removes Refresh bureaucracy (Gap 4)", () => {
  it("removes the Refresh button", () => {
    // The old button had title="Refresh the authority-review status".
    assert.doesNotMatch(authorityPanel, /Refresh the authority-review status/);
  });

  it("subscribes to workflow sync so the panel auto-refreshes", () => {
    assert.match(authorityPanel, /subscribeTenderWorkflowSync/);
  });
});
