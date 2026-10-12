// A model-written section that is incomplete is not delivered, and the
// structure repair never prints instructions to the bid team.
//
// A hosted run kept a cover-and-summary section that stopped mid-sentence
// ("..., and mandates") and never reached its Executive Summary. The
// missing-section repair then appended a generic "Executive Summary" and a
// "Relevant Experience" block after the Declaration; the latter told the
// client that "the proposal team should confirm that each reference ...".
// The package passed every gate at score 100. Separately, the strip of the
// repair's internal blocks ("Final Submission Controls", "Project Reference
// Mapping") removed only their headings, leaving the instructions under them.
// Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { sectionOutputProblem } from "../lib/engine/proposal-sections";
import { benchmarkMissingSections, finalizeClientReadyProposalMarkdown } from "../lib/engine/proposal-benchmark-guard";

const COMPLETE = [
  "# Cover Letter",
  "",
  "Example Consulting submits this technical proposal for Clinic Design.",
  "",
  "Sincerely,",
  "**A. Principal**",
  "info@example.test | example.test",
  "",
  "# Executive Summary",
  "",
  "The County Office has invited proposals for Clinic Design. Our approach answers each scope item.",
].join("\n");

describe("an incomplete model section is not delivered", () => {
  it("accepts a complete opening", () => {
    assert.equal(sectionOutputProblem("cover-and-summary", COMPLETE), null);
  });

  it("rejects an opening that stops mid-sentence", () => {
    const cut = "# Cover Letter\n\nThe evaluation calls for one PDF, stresses healthcare design experience, and mandates";
    assert.match(sectionOutputProblem("cover-and-summary", cut) ?? "", /Executive Summary|mid-sentence/);
    assert.match(sectionOutputProblem("company-and-experience", "# Section A\n\nThe firm operates from its head office and") ?? "", /mid-sentence/);
  });

  it("rejects an opening without its Executive Summary", () => {
    assert.match(sectionOutputProblem("cover-and-summary", "# Cover Letter\n\nWe submit this proposal.") ?? "", /Executive Summary/);
  });

  it("the writer uses the check before keeping a model section", () => {
    assert.match(readFileSync("lib/ai.ts", "utf8"), /sectionOutputProblem\(filteredSpecs\[i\]\.id, credentials\.markdown\)/);
  });
});

describe("the structure repair speaks to the client, not the bid team", () => {
  it("treats Section B headings as the Relevant Experience section", () => {
    assert.ok(!benchmarkMissingSections("## B.1 Client References\n\nText.\n\n## B.2 Project Portfolio\n\nText.").includes("Relevant Experience"));
  });

  it("appends no instruction when it completes missing sections", () => {
    const out = finalizeClientReadyProposalMarkdown("# Section C: Technical Approach\n\nMethod text.", {
      tenderTitle: "Clinic Design",
      clientName: "County Office",
      companyName: "Example Consulting",
      projectCount: 2,
      expertCount: 5,
      complianceLines: [],
    } as never).markdown;
    assert.doesNotMatch(out, /bid[- ]team|proposal team should|should confirm|must be confirmed|before final submission|before export/i);
  });
});
