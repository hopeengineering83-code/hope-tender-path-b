// A sentence of the writer's own brief is not proposal content.
//
// A hosted model-written "Understanding of the Assignment" delivered: "A
// winning proposal must demonstrate (i) Relevant healthcare project
// experience, ... and (v) Compliance with submission requirements ... The
// narrative must echo the evaluator's language verbatim to prove alignment."
// The package passed every gate. The same package's D.1 "Value to the
// Client" listed "Technical Proposal", "Table of Contents", "Executive
// Summary" and "Company Profile" as the firm's differentiators: the
// fallback split the writer's differentiators field, which opens with the
// writer's rules, on ";". Fixtures are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { scrubWritingBriefSentences } from "../lib/engine/detection-patterns";
import { clientSafeModelSection, type AIBidWriterInput } from "../lib/ai";
import { BENCHMARK_CONTEXT_LINES } from "../lib/engine/proposal-intelligence";
import { buildSectionFallback, type ProposalSectionSpec } from "../lib/engine/proposal-sections";

const SECTION = [
  "## C.2 Understanding of the Assignment",
  "",
  "The County Office seeks design services for a district clinic.",
  "",
  "A winning proposal must demonstrate (i) relevant clinic experience and (ii) a registered team. The narrative must echo the evaluator's language verbatim to prove alignment.",
  "",
  "Both references required full design coordination and approvals.",
].join("\n");

describe("the writer's brief is not proposal content", () => {
  it("removes the brief's sentences and keeps the rest of the section", () => {
    const out = scrubWritingBriefSentences(SECTION);
    assert.doesNotMatch(out, /winning proposal|echo the evaluator|prove alignment/);
    assert.match(out, /seeks design services for a district clinic\./);
    assert.match(out, /Both references required full design coordination and approvals\./);
  });

  it("keeps tender rules and ordinary prose", () => {
    const prose = "The successful bidder must submit one PDF. Our phasing mirrors the client's approval stages. A compliant submission must reach the client by the deadline.";
    assert.equal(scrubWritingBriefSentences(prose), prose);
  });

  it("the model-section check applies it", () => {
    const safe = clientSafeModelSection(SECTION);
    assert.equal(safe.ok, true);
    assert.doesNotMatch(safe.markdown, /winning proposal|prove alignment/);
  });
});

describe("D.1 lists the firm's differentiators, not the writer's rules", () => {
  it("takes whole differentiator lines and skips rule and evidence lines", () => {
    const md = buildSectionFallback({ id: "additional-and-declaration" } as unknown as ProposalSectionSpec, {
      tenderTitle: "Design of a District Clinic",
      clientName: "County Health Office",
      tenderText: "Scope of services: detailed design.",
      requirements: "",
      compliance: "",
      experts: "",
      projects: "",
      differentiators: [
        ...BENCHMARK_CONTEXT_LINES,
        "Clinic-specific methodology covers infection control; imaging shielding is included only where the equipment brief requires it.",
        "Company document: Quality manual QM/01/23",
      ].join("\n"),
      companyVault: { name: "Firm PLC" },
    } as unknown as AIBidWriterInput);
    const d1 = md.slice(md.indexOf("differentiators:"), md.indexOf("differentiators:") + 400);
    assert.match(d1, /- Clinic-specific methodology covers infection control; imaging shielding is included only where the equipment brief requires it\./);
    assert.doesNotMatch(md, /- (?:Technical Proposal|Table of Contents|Executive Summary|Company Profile)\n/);
    assert.doesNotMatch(md, /BENCHMARK STRUCTURE|EVIDENCE RULE|Company document:/);
  });
});
