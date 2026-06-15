// Regression tests for quality gap fixes from phase 16.
//
// Phase 16 addresses:
//   proposal-quality-scorer.ts: the structureCompleteness axis used the same
//   depth thresholds (<60=stub, <200=shallow, <600=moderate, 600+=full) for all
//   8 required sections. Declaration and Submission Control Sheet are
//   legitimately concise template/checklist sections — a complete Declaration
//   is 60–200 chars; a Control Sheet checklist is 100–400 chars after
//   bullet-stripping. Without a lower threshold both scored 0.5 (shallow),
//   capping structureCompleteness at 9/10 on fully-complete proposals.
//   Fix: adds a per-section substantiveAt override so Declaration (60+) and
//   Submission Control Sheet (100+) chars count as 1.0 (complete).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { scoreProposalQuality } from "../lib/engine/quality/proposal-quality-scorer";

// Fully-written proposal where every section has >= 600 chars of cleaned prose
// except Declaration (~229 chars) and Submission Control Sheet (~246 chars).
// The substantiveAt overrides introduced in phase 16 must recognise those two
// template sections as complete despite their intentionally short body.
// Uses "Amount" instead of "Contract Value" in tables to avoid a pre-existing
// pattern-matching issue where "value" in table headers matches the Section D regex.
const MINIMAL_COMPLETE_PROPOSAL = `
# Cover Letter

Dear Procurement Officer, we submit this proposal for the water supply design assignment. Our firm, Acme Consulting Engineers PLC, has delivered comparable consulting assignments across Ethiopia for over 15 years. Our portfolio includes the Adama Water Supply Scheme (ETB 85M, MoWIE, 2019–2022), the Gondar Urban Infrastructure Programme (ETB 120M, UIIDP, 2018–2021), and the Dire Dawa Sanitation Master Plan (ETB 18.5M, DWSCO, 2020–2021). The proposed team is led by a Senior Water Engineer with 14 years of sector experience supported by a hydraulic modelling specialist with certified EPANET proficiency. We have read the terms of reference carefully and confirm that we can mobilise within 14 days of contract signature. We are fully committed to meeting the TOR scope, timeline, and quality requirements and welcome the opportunity to present our approach in person. This submission is authorised by the undersigned Managing Director.

# Executive Summary

Our technical proposal delivers a structured, phased water supply design methodology grounded in direct comparable project experience. We bring three directly comparable projects: the Adama Water Supply Scheme (ETB 85M, MoWIE, 2019–2022), Gondar Urban Infrastructure (ETB 120M, UIIDP, 2018–2021), and the Dire Dawa Sanitation Master Plan (ETB 18.5M, DWSCO, 2020–2021). The proposed six-member team includes in-house EPANET and WaterCAD capabilities eliminating subcontracting delays. Our methodology follows a six-phase workflow: inception and mobilisation, data collection and baseline assessment, hydraulic design and analysis, quality assurance and review, reporting and deliverables, and handover and post-submission support. All hydraulic designs comply with EBCS-8 and WHO drinking-water guidelines. We predict 92/100 on the evaluation criteria based on our self-score and senior review of each requirement against the TOR. Our quality management system mandates peer review of all calculations and drawings before client submission.

# Section A: Company Profile

Acme Consulting Engineers PLC was established in 2008 and holds a Grade 1 ECA registration (Reg No. ECA-C1-2008-0047). We have delivered 45 assignments across water supply, sanitation, and urban infrastructure over the past 15 years. Our team of 38 professionals includes 12 senior engineers, 8 associate engineers, 6 environmental specialists, and 12 support staff. TIN: 0034521789. Annual turnover 2023: ETB 45M. Our firm is registered with the Ethiopian Construction Authority (ECA), the Ethiopian Roads Authority (ERA) approved consultant registry, and the Ministry of Water and Energy (MoWIE) prequalified consultant list. We hold an ISO 9001:2015 quality management certification valid through December 2026. Our registered office is at Bole Road, Kirkos Sub-City, Addis Ababa. We have no outstanding legal judgements, pending litigation, or declared conflicts of interest with the procuring entity or its parent institutions.

## A.2 Corporate Information

| Field | Details |
|---|---|
| Firm | Acme Consulting Engineers PLC |
| Registration | ECA-C1-2008-0047 |
| TIN | 0034521789 |

## A.4 Proposed Team

| Expert | Role | Experience |
|---|---|---|
| Tigist Bekele | Team Leader | 14 yrs water supply |
| Dawit Tesfaye | Hydraulic Engineer | 9 yrs EPANET |
| Selamawit Girma | Environmental Specialist | 8 yrs ESMP |

# Section B: Relevant Experience

We have delivered 23 water supply assignments in Ethiopia since 2010, including urban reticulation design, rural gravity-fed schemes, and sanitation master plans. Our portfolio spans work funded by MoWIE, UIIDP, World Bank, UNICEF, and GIZ, covering feasibility studies, detailed engineering design, BOQ preparation, and construction supervision across Addis Ababa, Amhara, Oromia, and Somali Regional State. Our most comparable reference is the Adama Water Supply Scheme: hydraulic design of a 45,000 m³/day system serving 380,000 beneficiaries, EPANET and WaterCAD modelling, procurement support, and three-year construction supervision (ETB 85M, MoWIE, 2019–2022). We maintained a defect notification rate below 2% across all five projects completed between 2021 and 2023, as verified by client acceptance certificates available on request. Our environmental team has prepared and secured approval for seven ESMPs under MoWIE, UIIDP, and World Bank Environmental and Social Framework requirements.

## B.2 Featured Projects

| Project | Client | Amount (ETB) | Duration |
|---|---|---|---|
| Adama Water Supply Scheme | MoWIE | 85,000,000 | 2019–2022 |
| Gondar Urban Infrastructure | UIIDP | 120,000,000 | 2018–2021 |
| Dire Dawa Sanitation Master Plan | DWSCO | 18,500,000 | 2020–2021 |

# Section C: Technical Approach

## C.1 Understanding

We understand the assignment requires a comprehensive water supply design for a peri-urban area with inadequate intermittent supply. Key challenges: inadequate transmission capacity, aging distribution, high non-revenue water. Our Adama Water Supply Scheme experience addresses these without a learning curve.

## C.2 Technical Methodology

### C.2.1 Inception and Mobilisation
Mobilise full team within 14 days, establish project office, submit inception report with refined work plan and stakeholder engagement schedule.

### C.2.2 Data Collection and Baseline Assessment
Conduct topographic survey, hydraulic network audit, water demand assessment, and water quality testing. EPANET calibration against existing network conditions.

### C.2.3 Hydraulic Design and Analysis
Using WaterCAD and EPANET, develop transmission main and distribution network design to meet 2040 demand projections, compliant with EBCS-8 and WHO drinking water guidelines.

### C.2.4 Quality Assurance and Review
All deliverables pass three-stage review: peer technical review, editorial review, and compliance review against TOR before submission.

### C.2.5 Reporting and Deliverables
Feasibility Study Report, Detailed Engineering Design, BOQ, Technical Specification, Tender Document, and Environmental and Social Management Plan in English and Amharic.

### C.2.6 Handover and Support
60 days post-submission support; training on hydraulic model and GIS network dataset maintenance.

## C.3 Risk Register

| Risk | Mitigation |
|---|---|
| Survey access delays | Early community consultation |
| Data gaps | Physical network audit + EPANET calibration |

# Section D: Additional Information

Our in-house WaterCAD and EPANET capabilities eliminate subcontracting delays and ensure direct technical accountability. The Team Leader provides 4-hour responsiveness during business hours throughout the assignment. We propose an optional non-revenue water action plan at no additional cost as a value-added service to the client, drawing on the diagnostic methodology we developed during the Adama Water Supply Scheme assignment. Our quality management system mandates peer review of all calculations and drawings before client submission, with a documented defect rate below 2% across the last five projects verified by MoWIE client acceptance certificates. We commit to submitting all deliverables in both English and Amharic as required by the TOR. GIS datasets will be delivered in ESRI shapefile and GeoPackage formats compatible with MoWIE's spatial data infrastructure. Full version control of all hydraulic model files will be maintained throughout the assignment and transferred to the client at handover.

## Declaration

We, Acme Consulting Engineers PLC, declare that this proposal is true and accurate, that we have no conflict of interest, and that we have full legal authority to submit this bid. Signed: Managing Director, Addis Ababa, June 2026.

## Submission Control Sheet

- [ ] Submission sent to correct email before deadline
- [ ] Subject line matches required format from tender
- [ ] All required annexes and appendices attached
- [ ] Technical and financial proposals in separate files
- [ ] Document naming convention per tender instructions
`.trim();

describe("scoreProposalQuality — structureCompleteness with template sections", () => {
  it("structureCompleteness reaches 10/10 on a complete proposal with concise Declaration and Control Sheet", () => {
    const score = scoreProposalQuality({ markdown: MINIMAL_COMPLETE_PROPOSAL, primarySector: "Water", topProjects: [] });
    assert.strictEqual(score.axes.structureCompleteness, 10,
      `expected structureCompleteness of 10 for a fully-written proposal, got ${score.axes.structureCompleteness}`);
  });

  it("structureCompleteness is not in weakAxes for a fully-written proposal", () => {
    const score = scoreProposalQuality({ markdown: MINIMAL_COMPLETE_PROPOSAL, primarySector: "Water", topProjects: [] });
    assert.ok(!score.weakAxes.includes("structureCompleteness"),
      `structureCompleteness should not be weak on a complete proposal, weakAxes: ${JSON.stringify(score.weakAxes)}`);
  });

  it("still scores Declaration as 0 when body is pure filler", () => {
    const md = MINIMAL_COMPLETE_PROPOSAL.replace(
      /## Declaration\n\n[\s\S]*?(?=\n## Submission)/,
      "## Declaration\n\nTBD\n\n",
    );
    const score = scoreProposalQuality({ markdown: md, primarySector: "Water", topProjects: [] });
    assert.ok(score.axes.structureCompleteness < 10,
      `expected structureCompleteness < 10 when Declaration is filler, got ${score.axes.structureCompleteness}`);
  });

  it("still scores Declaration as 0 when section is absent", () => {
    const md = MINIMAL_COMPLETE_PROPOSAL.replace(/## Declaration[\s\S]*?(## Submission)/, "$1");
    const score = scoreProposalQuality({ markdown: md, primarySector: "Water", topProjects: [] });
    assert.ok(score.axes.structureCompleteness < 10,
      `expected structureCompleteness < 10 when Declaration is missing, got ${score.axes.structureCompleteness}`);
  });
});
