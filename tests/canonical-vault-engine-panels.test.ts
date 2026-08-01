import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("canonical Company Vault and Engine workflow panels", () => {
  const page = read("app/dashboard/tenders/[id]/page.tsx");
  const requirements = read("components/requirement-coverage-panel.tsx");
  const matching = read("components/matching-selected-evidence-panel.tsx");

  it("renders only the two canonical evidence authorities", () => {
    assert.match(page, /<RequirementCoveragePanel\b/);
    assert.match(page, /<MatchingSelectedEvidencePanel\b/);
    for (const removed of [
      "SelectionApprovalPanel",
      "AIRematchButton",
      "MatchingQualityPanel",
      "EvidenceCoveragePanel",
      "ComplianceHeatmapPanel",
      "VaultEvidenceSearchPanel",
      "ScoreBreakdownPanel",
    ]) {
      assert.doesNotMatch(page, new RegExp(`(?:import|<)\\s*${removed}\\b`));
    }
    assert.match(requirements, />Requirements and Evidence</);
    assert.match(matching, />Matching and Selected Evidence</);
  });

  it("contains no manual selection, rematch, synchronization, or evidence-link controls", () => {
    const canonical = `${requirements}\n${matching}`;
    assert.doesNotMatch(canonical, /type="checkbox"|window\.prompt|>\s*Synchronize\s*<|>\s*Refresh\s*<|>\s*(?:Review|Approve|Confirm)\s*</i);
  });

  it("uses only neutral automatic states and keeps candidates collapsed", () => {
    const canonical = `${requirements}\n${matching}`;
    assert.doesNotMatch(canonical, /source (?:reference )?(?:not found|unavailable)|evidence unavailable|not covered|not REVIEWED|attach (?:an? |the )?(?:original|alternate)|manually (?:link|select)/i);
    for (const state of [
      "Automatic verification running",
      "Automatic source grounding",
      "Automatically linked",
      "Partially supported",
      "Verified and ready",
      "Automatic verification incomplete",
    ]) {
      assert.match(canonical, new RegExp(state, "i"));
    }
    assert.match(matching, /<details[\s\S]*Candidates and matching diagnostics/);
    assert.doesNotMatch(matching, /<details\s+open/);
  });
});
