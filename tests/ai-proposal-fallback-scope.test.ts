import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { fallbackProposal } from "../app/api/tenders/[id]/ai-proposal/route";

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

