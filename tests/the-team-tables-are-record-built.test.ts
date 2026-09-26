// The proposed-team table and the team-to-project mapping are built from the
// expert and project records, never from the section writer's own tables.
//
// A hosted package (READY, audit 100) printed in A.4 "to be confirmed by
// proposal team" as the role of all eight experts, an A.5 that paired every
// expert with a "Lead / Senior Role" on the same project, and a featured
// project card with "Contract value: Construction value of works ETB 550"
// for a record of ETB 550.1M. All of it came from the per-section fallback,
// which built those tables by parsing the writer's flattened text ("TBD" in
// every role cell) and, by carrying their headings, stopped the record-built
// tables from being added. A model-written team table has printed "license
// numbers to be confirmed" the same way. Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { buildSectionFallback, type ProposalSectionSpec } from "../lib/engine/proposal-sections";
import { withoutUpstreamTeamTables } from "../lib/engine/benchmark-tables";
import type { AIBidWriterInput } from "../lib/ai";

function writerInput(): AIBidWriterInput {
  return {
    tenderTitle: "Design of a District Clinic",
    clientName: "County Health Office",
    tenderText: "Scope of services: site assessment; detailed design.",
    analysisSummary: "",
    evaluationMethodology: "",
    submissionNotes: "",
    requirements: "SCORED: Methodology and work plan for the clinic",
    companyProfile: "",
    experts: "Alex Person — Senior Architect | Disciplines: Architecture | 12 years\nBeth Person — Senior Sanitary Engineer | Disciplines: Sanitary | 9 years",
    projects: "Clinic A — County Council | Kenya | Healthcare | USD 1.2M. A 40-bed clinic.\nClinic B — District Office | Kenya | Healthcare | ETB 550.1M. Outpatient block.",
    compliance: "Submit by email",
    differentiators: "",
    companyVault: { name: "Firm PLC" },
  } as AIBidWriterInput;
}

const spec = (id: string) => ({ id } as unknown as ProposalSectionSpec);

describe("the per-section fallback leaves the team and reference tables to the records", () => {
  const md = buildSectionFallback(spec("company-and-experience"), writerInput());

  it("writes no team table, no mapping and no featured cards of its own", () => {
    assert.doesNotMatch(md, /Proposed Project Team|Team-to-Project|Featured Project/);
    assert.doesNotMatch(md, /\bTBD\b|Lead \/ Senior Role|Comparable scope and sector/);
  });

  it("introduces Section B without internal wording", () => {
    const sectionB = md.slice(md.indexOf("# Section B: Relevant Experience"));
    assert.match(sectionB, /^# Section B: Relevant Experience\n\n## B\.1 Portfolio Overview\n\nFirm PLC's references for this assignment are drawn from its own project records/);
    assert.doesNotMatch(sectionB, /downstream|Bid-Team|See Sections B\./i);
  });
});

describe("an upstream team table gives way to the record-built one", () => {
  const upstream = [
    "## A.3 Core Service Lines",
    "- Architectural design",
    "## A.4 Proposed Project Team",
    "| Expert | Role on This Assignment |",
    "|---|---|",
    "| Alex Person | TBD |",
    "### A.4.1 Principal Qualifications",
    "Alex Person holds a design licence.",
    "## A.5 Team-to-Project Experience Mapping",
    "| Expert | Project | Role |",
    "|---|---|---|",
    "| Alex Person | Clinic A | Lead / Senior Role |",
    "# Section B: Relevant Experience",
    "Text.",
  ].join("\n");

  it("removes the upstream sections the records replace, and nothing else", () => {
    const out = withoutUpstreamTeamTables(upstream, { team: true, mapping: true });
    assert.doesNotMatch(out, /Proposed Project Team|TBD|Team-to-Project|Lead \/ Senior Role/);
    assert.match(out, /## A\.3 Core Service Lines\n- Architectural design/);
    assert.match(out, /### A\.4\.1 Principal Qualifications\nAlex Person holds a design licence\./);
    assert.match(out, /# Section B: Relevant Experience\nText\./);
  });

  it("keeps an upstream section when the records cannot replace it", () => {
    assert.equal(withoutUpstreamTeamTables(upstream, { team: false, mapping: false }), upstream);
    const teamOnly = withoutUpstreamTeamTables(upstream, { team: true, mapping: false });
    assert.doesNotMatch(teamOnly, /Proposed Project Team/);
    assert.match(teamOnly, /## A\.5 Team-to-Project Experience Mapping/);
  });

  it("generation applies it before the record tables are added", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const applied = src.indexOf("withoutUpstreamTeamTables(stripSelfScoreSections(sourceMarkdown)");
    assert.ok(applied > 0);
    assert.ok(applied < src.indexOf("const upstreamCheck = makeHasHeadingChecker("));
  });
});
