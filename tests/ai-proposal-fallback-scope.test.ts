import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fallbackProposal, selectReviewedEvidenceForAIDraft } from "../app/api/tenders/[id]/ai-proposal/route";

function build(requirements: string[]) {
  return fallbackProposal({
    tenderTitle: "Sample Tender",
    requirements,
    companyName: "Hope",
    companyProfile: "Reviewed profile.",
    serviceLines: "Design, Supervision",
    expertLines: ["Dr A | Team Lead"],
    projectLines: ["Project X | Client Y"],
    differentiators: ["Strong hospital track record"],
    submissionRules: ["Submit technical envelope only"],
    aiError: "provider timeout",
  });
}

describe("ai-proposal fallback is tender-scoped", () => {
  it("does not force technical/team/project sections when not required", () => {
    const out = build(["MANDATORY FORM: Signed declaration"]);
    assert.ok(!out.includes("## Proposed Team"));
    assert.ok(!out.includes("## Relevant Experience"));
    assert.ok(!out.includes("## Technical Response"));
  });

  it("includes only sections implied by requirements", () => {
    const out = build([
      "MANDATORY EXPERT: Team Leader CV",
      "MANDATORY PROJECT_EXPERIENCE: similar project references",
      "MANDATORY TECHNICAL: methodology and workplan",
    ]);
    assert.ok(out.includes("## Proposed Team"));
    assert.ok(out.includes("## Relevant Experience"));
    assert.ok(out.includes("## Technical Response"));
  });

  it("does not expose raw provider error details in fallback body", () => {
    const out = build(["MANDATORY FORM: Signed declaration"]);
    assert.ok(!out.includes("provider timeout"));
  });
});

describe("selectReviewedEvidenceForAIDraft", () => {
  it("uses reviewed selected evidence when present", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [{ trustLevel: "REVIEWED", id: 1 }, { trustLevel: "AI_DRAFT", id: 2 }],
      [{ trustLevel: "REVIEWED", id: 3 }],
    );
    assert.deepEqual(out.evidence.map((x) => x.id), [1]);
    assert.equal(out.usedReviewedVaultFallback, false);
  });

  it("falls back to reviewed vault evidence when selected set has no reviewed rows", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [{ trustLevel: "AI_DRAFT", id: 2 }],
      [{ trustLevel: "REVIEWED", id: 3 }],
    );
    assert.deepEqual(out.evidence.map((x) => x.id), [3]);
    assert.equal(out.usedReviewedVaultFallback, true);
  });

  it("never returns unreviewed rows when no reviewed evidence exists", () => {
    const out = selectReviewedEvidenceForAIDraft(
      [{ trustLevel: "AI_DRAFT", id: 2 }, { trustLevel: "REGEX_DRAFT", id: 4 }],
      [],
    );
    assert.deepEqual(out.evidence, []);
    assert.equal(out.usedReviewedVaultFallback, false);
  });
});
