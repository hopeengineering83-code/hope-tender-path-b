import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  isEligibleSelectedEvidence,
  type SelectedEvidenceCandidate,
} from "../components/matching-selected-evidence-panel";

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

  it("keeps stale selections fail-closed when their records are unsafe", () => {
    const candidate = (trustLevel: string): SelectedEvidenceCandidate => ({
      id: trustLevel,
      name: trustLevel,
      subtitle: null,
      score: 0.99,
      rationale: null,
      isSelected: true,
      trustLevel,
    });

    assert.equal(isEligibleSelectedEvidence(candidate("SOURCE_VERIFIED")), true);
    assert.equal(isEligibleSelectedEvidence(candidate("REVIEWED")), true);
    assert.equal(isEligibleSelectedEvidence(candidate("AI_DRAFT")), false);
    assert.equal(isEligibleSelectedEvidence(candidate("REGEX_DRAFT")), false);
    assert.equal(isEligibleSelectedEvidence(candidate("TAMPERED")), false);
  });

  it("never describes partial support as complete traceability", () => {
    assert.doesNotMatch(requirements, /All requirements and selected evidence have acceptable traceability/);
    assert.match(requirements, /data\.partiallyCovered === 0/);
    assert.match(requirements, /Partially supported/);
  });
});
