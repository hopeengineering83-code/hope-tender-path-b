/**
 * A past-work claim comes from the firm's record, not from the tender.
 *
 * 2026-09-30, Preview, a telecom-tower EOI (inspect run 36750893716): every
 * building project was correctly excluded as not comparable, and the
 * model-written Section A then supplied its own experience. A.1 said "the
 * firm's structural engineers have routinely performed condition assessments
 * … for telecom and utility towers across Ethiopia", and A.4 cited "Telecom
 * Tower Audit & Strengthening, Addis Ababa (2022)", a project in no record.
 * The same table's second row was cut off mid-cell, and Section C's generic
 * methodology paragraphs (worded "internal peer review") did not reach the
 * client at all.
 *
 * Generic fixture: a mast-maintenance tender and a building-design firm.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { scrubUngroundedExperienceClaims } from "../lib/engine/company-credential-grounding";
import { buildSectionFallback, sectionOutputProblem, type ProposalSectionSpec } from "../lib/engine/proposal-sections";

const TENDER = "Inspection, structural analysis and strengthening of communication masts. Mast maintenance services. Condition assessments.";
const RECORD = "Building design, structural engineering, geotechnical investigation, condition assessments of buildings. Project: Riverside Health Centre (2021).";

describe("a past-work claim built from the tender's words is removed", () => {
  const md = [
    "The firm has an in-house laboratory. Its engineers have routinely performed strengthening design for communication masts nationwide.",
    "The firm has delivered condition assessments of buildings for public clients.",
    "",
    "| Expert | Role Previously Performed | Previous Comparable Project |",
    "|---|---|---|",
    "| A. Engineer | Project Manager | Communication Mast Strengthening Programme (2022) |",
    "| B. Engineer | Structural Engineer | Riverside Health Centre (2021) |",
  ].join("\n");
  const result = scrubUngroundedExperienceClaims(md, RECORD, TENDER);

  it("drops the borrowed sentence and the invented project row", () => {
    assert.doesNotMatch(result.markdown, /masts?/i);
    assert.equal(result.removed.length, 2, result.removed.join("\n"));
  });

  it("keeps what the record supports", () => {
    assert.match(result.markdown, /in-house laboratory/);
    assert.match(result.markdown, /condition assessments of buildings/);
    assert.match(result.markdown, /Riverside Health Centre \(2021\)/);
  });

  it("the section writer applies it to every model-written section", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    assert.match(source, /scrubUngroundedExperienceClaims\(credentials\.markdown, companyGroundingText\(input\)/);
  });
});

describe("a cut-off table row is an incomplete section", () => {
  it("is reported, so the deterministic section is used", () => {
    const md = "# Section A: Company Profile\n\n## A.1 Company Background\n\nText.\n\n| A | B |\n|---|---|\n| Nejat – Geotech Lead | Lead Geotechnical\n\n## A.5 In-House Capabilities\n\nText.";
    assert.match(String(sectionOutputProblem("company-and-experience" as never, md)), /table row is cut off/);
  });
});

describe("the generic methodology wording survives the client-text passes", () => {
  it("does not say 'internal' review", () => {
    const md = buildSectionFallback({ id: "technical-approach" } as ProposalSectionSpec, {
      tenderTitle: "Maintenance of Communication Masts", clientName: "Sample Networks PLC", tenderText: TENDER,
      requirements: "", compliance: "", experts: "", projects: "", differentiators: "", companyVault: { name: "S" },
    } as never);
    assert.doesNotMatch(md, /internal peer review/i);
    assert.match(md, /peer review by a second engineer/);
  });
});
