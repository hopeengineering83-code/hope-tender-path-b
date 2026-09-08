import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SECTOR_GUIDANCE_BULLETS,
  SECTOR_METHODOLOGY_GUIDANCE,
  buildProposalSectionSpecs,
  buildSectorGuidanceBlock,
  selectSectorGuidance,
  structuredEvidenceLine,
  technicalApproachSystemPrompt,
} from "../lib/engine/proposal-sections";
import {
  TENDER_CONTEXT_ELISION,
  TENDER_FOCUS_EVALUATION,
  TENDER_FOCUS_METHODOLOGY,
  selectTenderContext,
} from "../lib/engine/tender-context-selection";
import { estimateInputTokens } from "../lib/ai-preflight";
import type { AIBidWriterInput } from "../lib/ai";

/**
 * No section writer could reach the first provider in the canonical chain.
 *
 * Two costs inside this repository put the request over the budget, and both
 * were paid on every tender regardless of what the tender said:
 *
 *   1. Section C's system prompt carried the whole 25-bullet sector catalogue —
 *      1,644 estimated input tokens of guidance for mining, telecoms, ports,
 *      hospitality and twenty more, sent to a hospital tender.
 *   2. Every writer took the tender by head-slice. On a real 60,000-char RFP
 *      the first 8,000 chars are the invitation letter, the table of contents
 *      and the instructions to consultants; the scope of work, the deliverable
 *      schedule and the evaluation criteria all sit past the cut.
 *
 * Measured, Section C came to 8,932 input tokens against a Groq budget of 7,088
 * (gpt-oss free tier 8,000 TPM, less the 512-token minimum useful response and
 * preflight's 5% margin). Preflight skipped Groq every time, and the section
 * fell through the chain toward the deterministic writer.
 */

// Derived exactly as lib/ai-preflight.ts derives it, not copied as a number.
const GROQ_TPM = 8_000;
const MIN_USEFUL_OUTPUT_TOKENS = 512;
const GROQ_INPUT_BUDGET = GROQ_TPM - MIN_USEFUL_OUTPUT_TOKENS - Math.max(128, Math.ceil(GROQ_TPM * 0.05));

/** A tender shaped like a real one: front matter and boilerplate around a ToR. */
function tenderDocument(scope: readonly string[]): string {
  const boilerplate = (label: string) =>
    `${label}\n\n${"The Client reserves all rights under the applicable procurement regulation and no liability attaches to the Client in respect of this process. Consultants bear their own costs of participation. ".repeat(9)}`;
  const blocks = ["REQUEST FOR PROPOSALS\nRFP No. MOH/CS/2026/014\nFederal Ministry of Health, Addis Ababa"];
  for (let clause = 1; clause <= 22; clause += 1) blocks.push(boilerplate(`ITB Clause ${clause} — Instructions to Consultants`));
  blocks.push(...scope);
  for (let annex = 1; annex <= 10; annex += 1) blocks.push(boilerplate(`Annex ${annex} — General Conditions of Contract`));
  return blocks.join("\n\n");
}

const HOSPITAL_SCOPE = [
  "TERMS OF REFERENCE — 5.1 Objective\n\nThe objective of this assignment is to provide architectural and engineering design services for a 200-bed specialty medical centre, including detailed design drawings, technical specifications and bills of quantities.",
  "5.2 Scope of Services\n\nThe Consultant will carry out review of the functional brief, topographic survey and geotechnical investigation to EBCS-7, concept and schematic design of clinical and non-clinical zones with clinical zone segregation, and detailed design of medical gas reticulation, radiology shielding and HVAC.",
  "5.3 Deliverables and Schedule\n\nD1 Inception Report within 3 weeks; D2 Concept Design Report within 8 weeks; D3 Schematic Design and Cost Plan within 14 weeks; D4 Detailed Design, Specifications and BOQ within 24 weeks; D5 Tender Documents within 28 weeks. Total design duration 28 weeks.",
  "5.4 Quality Assurance\n\nAll drawings and reports are subject to independent internal peer review prior to issue. A Quality Assurance Plan and Inspection and Test Plan are due within 2 weeks. Design review workshops are held at 30%, 60% and 100% completion.",
  "5.5 Key Personnel\n\nKey experts required: Team Leader / Principal Architect (15 years, registered), Structural Engineer (10 years), Electrical Engineer (10 years), Mechanical/HVAC Engineer (10 years), Quantity Surveyor (10 years), Healthcare Planning Specialist.",
  "SECTION 3 — Evaluation Criteria\n\nTechnical proposals are evaluated out of 100 points: specific experience 15 points; adequacy of the proposed methodology and work plan 40 points; qualifications and competence of key personnel 40 points; transfer of knowledge 5 points. Minimum technical score 75 points.",
];

function writerInput(tenderText: string, title: string): AIBidWriterInput {
  return {
    tenderTitle: title,
    clientName: "Federal Ministry of Health",
    tenderText,
    analysisSummary: "A".repeat(3_000),
    evaluationMethodology: "M".repeat(2_000),
    submissionNotes: "N".repeat(2_000),
    requirements: Array.from({ length: 24 }, (_, i) => `- Requirement ${i + 1}: ${"x".repeat(180)}`).join("\n"),
    companyProfile: "C".repeat(3_000),
    // Evidence blocks at the volume the matcher actually hands the writer.
    // expertProofLine truncates each profile at 600 chars and adds the
    // structured fields around it, so a proof line runs ~800 chars; the live
    // run behind this work passed 3 experts and 1 project through the sector
    // filter. Six of each is already generous against that.
    experts: Array.from({ length: 6 }, (_, i) => `Expert ${i + 1} — Title | Disciplines: d | ${"p".repeat(700)}`).join("\n"),
    projects: Array.from({ length: 6 }, (_, i) => `Project ${i + 1} — Client | Country | ${"s".repeat(600)}`).join("\n"),
    compliance: "L".repeat(1_500),
    differentiators: Array.from({ length: 5 }, (_, i) => `- Differentiator ${i}: ${"d".repeat(150)}`).join("\n"),
  } as AIBidWriterInput;
}

test("every section writer's prompt fits the budget of the first provider in the chain", () => {
  const input = writerInput(tenderDocument(HOSPITAL_SCOPE), "Design of a 200-bed specialty medical centre");
  for (const deep of [false, true]) {
    for (const spec of buildProposalSectionSpecs(input, { deep })) {
      const tokens = estimateInputTokens(spec.systemPrompt ?? "") + estimateInputTokens(spec.userPrompt ?? "");
      assert.ok(
        tokens <= GROQ_INPUT_BUDGET,
        `${spec.id} (deep=${deep}) is ${tokens} tokens, over the ${GROQ_INPUT_BUDGET}-token budget by ${tokens - GROQ_INPUT_BUDGET}`,
      );
    }
  }
});

test("the sector catalogue is never shipped whole to a tender that names its sector", () => {
  const wholeCatalogue = estimateInputTokens(SECTOR_METHODOLOGY_GUIDANCE.map((entry) => entry.bullet).join("\n"));
  const block = buildSectorGuidanceBlock(HOSPITAL_SCOPE.join(" "));
  assert.ok(
    estimateInputTokens(block) < wholeCatalogue / 4,
    `guidance block is ${estimateInputTokens(block)} tokens against a ${wholeCatalogue}-token catalogue`,
  );
  assert.ok(selectSectorGuidance(HOSPITAL_SCOPE.join(" ")).length <= MAX_SECTOR_GUIDANCE_BULLETS);
});

test("the catch-all instruction reaches the writer even when guidance was selected", () => {
  const prompt = technicalApproachSystemPrompt(buildSectorGuidanceBlock(HOSPITAL_SCOPE.join(" ")));
  assert.match(prompt, /Other sectors not listed above/);
  assert.match(prompt, /Do NOT default to generic engineering language/);
});

/**
 * The selector must not be a healthcare filter wearing a generic name. Each
 * sector below is scored by the same rule, and each has to retrieve the
 * catalogue entry that owns its professional vocabulary.
 */
const CROSS_SECTOR: ReadonlyArray<{ sector: string; tender: string; expect: string }> = [
  {
    sector: "healthcare",
    tender: "Design and construction supervision of a 200-bed referral hospital: outpatient department, operating theatres, medical gas reticulation, radiology suite, infection prevention and control compliant clinical wards.",
    expect: "Healthcare",
  },
  {
    sector: "road",
    tender: "Detailed engineering design for upgrading 45 km of trunk highway: pavement design, alignment survey, geotechnical investigation with CBR and Proctor testing, drainage structures, box culverts and a road safety audit.",
    expect: "Road/bridge",
  },
  {
    sector: "water",
    tender: "Feasibility study and detailed design of a town water supply and sanitation scheme: borehole source investigation, hydraulic modelling of the distribution network, pipe sizing, pump station design and water quality testing including chlorination.",
    expect: "Water/sanitation",
  },
  {
    sector: "geotechnical",
    tender: "Geotechnical investigation comprising boreholes, standard penetration testing, laboratory soil classification, slope stability analysis, bearing capacity determination and foundation recommendations.",
    // The catalogue has no geotechnical entry; the mining bullet is the one
    // that owns slope-stability and geotechnical investigation.
    expect: "Mining/extractive",
  },
  {
    sector: "urban planning",
    tender: "Preparation of a structure plan and local development plan for a secondary city: GIS-based land use mapping, demographic and socioeconomic baseline, infrastructure demand assessment, zoning regulation and a phased implementation roadmap.",
    expect: "Urban/master planning",
  },
  {
    sector: "construction supervision",
    tender: "Resident engineer and construction supervision services: inspection and test plans, hold points and witness points, non-conformance reports, interim payment certificates, material approval, site diary, commissioning, punch list and defects liability period administration.",
    expect: "Construction supervision / resident engineer",
  },
  {
    sector: "industrial",
    tender: "Design of an industrial manufacturing facility: process flow layout, value-stream mapping, lean plant layout, industrial flooring, exhaust ventilation, fire suppression, effluent treatment plant, factory acceptance testing and an EHS management plan.",
    expect: "Industrial & manufacturing",
  },
  {
    sector: "EOI / consultant selection",
    tender: "Expression of Interest for consultant selection under QCBS procedures financed by the African Development Bank. Shortlisted firms shall demonstrate compliance with the donor procurement framework, logical framework and M&E arrangements, and safeguard policy alignment.",
    expect: "NGO / donor-funded tenders (World Bank, AfDB, EU, USAID, DFID/FCDO, UN agencies, GFATM, GIZ)",
  },
];

for (const { sector, tender, expect } of CROSS_SECTOR) {
  test(`a ${sector} tender retrieves ${sector} guidance, not healthcare guidance`, () => {
    const labels = selectSectorGuidance(tender).map((entry) => entry.label);
    assert.ok(labels.includes(expect), `${sector} selected ${JSON.stringify(labels)}, expected to include ${expect}`);
    if (expect !== "Healthcare") {
      assert.ok(!labels.includes("Healthcare"), `${sector} wrongly retrieved the healthcare bullet: ${JSON.stringify(labels)}`);
    }
  });
}

test("a tender the catalogue does not recognise gets the whole catalogue rather than none of it", () => {
  const selected = selectSectorGuidance("Supply of assorted stationery and office consumables to the regional bureau.");
  assert.equal(selected.length, SECTOR_METHODOLOGY_GUIDANCE.length);
});

test("guidance is emitted in catalogue order, verbatim", () => {
  const selected = selectSectorGuidance(HOSPITAL_SCOPE.join(" "));
  const order = selected.map((entry) => SECTOR_METHODOLOGY_GUIDANCE.indexOf(entry));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  for (const entry of selected) assert.ok(entry.bullet.startsWith("   - "), "bullet formatting was rewritten");
});

/**
 * The point of the change is not that the prompt got smaller. A smaller prompt
 * that dropped the scope of work would be a regression however well it fits.
 */
test("selection carries the scope the head-slice cut away", () => {
  const tender = tenderDocument(HOSPITAL_SCOPE);
  const headSlice = tender.slice(0, 8_000);
  // The same focus Section C passes: the evaluation criteria are part of the
  // scope a methodology has to answer, so they are part of what must survive.
  const selected = selectTenderContext(tender, {
    budgetChars: 5_000,
    focusTerms: [...TENDER_FOCUS_METHODOLOGY, ...TENDER_FOCUS_EVALUATION],
    alreadyProvided: [],
  });

  const present = (haystack: string) =>
    HOSPITAL_SCOPE.filter((passage) => haystack.includes(passage.split("\n\n")[1].slice(0, 60))).length;

  assert.equal(present(headSlice), 0, "premise changed: the head-slice now reaches the scope of work");
  assert.equal(present(selected.text), HOSPITAL_SCOPE.length, "selection dropped a scope passage");
  assert.ok(selected.text.length < headSlice.length, "selection is not smaller than the slice it replaced");
});

test("a tender small enough to send whole is sent whole", () => {
  const tender = HOSPITAL_SCOPE.join("\n\n");
  const selected = selectTenderContext(tender, { budgetChars: 50_000, focusTerms: TENDER_FOCUS_METHODOLOGY });
  assert.equal(selected.complete, true);
  assert.equal(selected.text, tender.trim());
  assert.ok(!selected.text.includes(TENDER_CONTEXT_ELISION));
});

test("dropped passages are marked, so a gap is never read as continuous text", () => {
  const selected = selectTenderContext(tenderDocument(HOSPITAL_SCOPE), {
    budgetChars: 5_000,
    focusTerms: TENDER_FOCUS_METHODOLOGY,
  });
  assert.equal(selected.complete, false);
  assert.ok(selected.text.includes(TENDER_CONTEXT_ELISION));
  assert.ok(selected.passagesKept < selected.passagesTotal);
});

test("the tender's own reference block always travels", () => {
  const selected = selectTenderContext(tenderDocument(HOSPITAL_SCOPE), {
    budgetChars: 5_000,
    focusTerms: TENDER_FOCUS_METHODOLOGY,
  });
  assert.ok(selected.text.includes("RFP No. MOH/CS/2026/014"));
});

test("Section C tells the writer when it is reading an abridged tender", () => {
  const abridged = buildProposalSectionSpecs(writerInput(tenderDocument(HOSPITAL_SCOPE), "Hospital design"), {})
    .find((spec) => spec.id === "technical-approach");
  assert.ok(abridged);
  assert.match(abridged.userPrompt ?? "", /elisions are marked/);

  const whole = buildProposalSectionSpecs(writerInput(HOSPITAL_SCOPE.join("\n\n"), "Hospital design"), {})
    .find((spec) => spec.id === "technical-approach");
  assert.ok(whole);
  assert.match(whole.userPrompt ?? "", /full scope/);
});

/**
 * Compaction is only legitimate while it removes prose. The moment it removes a
 * name, a client, a value or a licence, Section C loses something it is
 * required to cite and the change becomes a quality regression.
 */
test("compaction keeps every structured fact and drops only the prose tail", () => {
  const expert = "Ahmed Kebede Tekaw — General Manager | 11+ years experience | Disciplines: Architecture, Structural Engineering | Sectors: Health, Urban | Certifications/Licences: ECAE Grade 1 | 1. PERSONNEL INFORMATION Proposed Position Architect Name of Firm Hope Urban Planning and a great deal more CV prose that Section C never cites.";
  const compacted = structuredEvidenceLine(expert);
  for (const fact of ["Ahmed Kebede Tekaw", "General Manager", "11+ years experience", "Architecture", "Structural Engineering", "Health", "ECAE Grade 1"]) {
    assert.ok(compacted.includes(fact), `compaction dropped the fact "${fact}"`);
  }
  assert.ok(!compacted.includes("PERSONNEL INFORMATION"), "the CV prose survived compaction");
});

test("compaction keeps a project's client, value and services and drops its summary", () => {
  const project = "Entoto Eco-Park Master Planning — Ethiopian Heritage Trust | Ethiopia | Urban Planning | Consultancy fee ETB 98.6M | Services: Feasibility study, Master planning. The assignment covered a large area of the Entoto ridge and ran for eighteen months with extensive stakeholder consultation.";
  const compacted = structuredEvidenceLine(project);
  for (const fact of ["Entoto Eco-Park Master Planning", "Ethiopian Heritage Trust", "Urban Planning", "ETB 98.6M", "Feasibility study"]) {
    assert.ok(compacted.includes(fact), `compaction dropped the fact "${fact}"`);
  }
  assert.ok(!compacted.includes("Entoto ridge"), "the project summary survived compaction");
});

test("compaction never severs a name at an abbreviation's full stop", () => {
  const line = "G+6 General Hospital – Dr. Abdul Seid. The project delivered a six-storey hospital block.";
  const compacted = structuredEvidenceLine(line);
  assert.ok(compacted.includes("Dr. Abdul Seid"), `name was severed: ${compacted}`);
  assert.ok(!compacted.includes("six-storey"), "the summary survived compaction");
});

test("a line that is already only facts is returned unchanged", () => {
  const line = "Jane Doe — Structural Engineer | 10+ years experience | Disciplines: Structural Engineering";
  assert.equal(structuredEvidenceLine(line), line);
});

test("Section B still receives the full evidence prose Section C drops", () => {
  const input = writerInput(tenderDocument(HOSPITAL_SCOPE), "Hospital design");
  const specs = buildProposalSectionSpecs(input, {});
  const sectionB = specs.find((spec) => spec.id === "company-and-experience");
  const sectionC = specs.find((spec) => spec.id === "technical-approach");
  assert.ok(sectionB && sectionC);
  const proseMarker = input.experts.split("| ")[1].slice(0, 40);
  assert.ok((sectionB.userPrompt ?? "").includes(proseMarker), "Section B lost the expert prose");
  assert.ok(!(sectionC.userPrompt ?? "").includes(proseMarker), "Section C still carries the expert prose");
});
