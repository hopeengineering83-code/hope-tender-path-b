// A firm that works across sectors bids on every kind of tender, and each
// proposal must describe the work THAT tender asks for. The 2026-10-05
// tender-type matrix ran ten invented tenders (office interior, hospital,
// hotel, road, water, ICT, telecom EOI, school supervision, industrial
// feasibility, office building) and one scope-of-services clinic tender
// through the real generator for one multi-sector firm. Each defect below
// reached a generated document; none is specific to one tender.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { detectThemes, inferSector } from "../lib/engine/proposal-intelligence";
import { buildingSectorLabel, isHealthcareSector, isSupervisionOnlyAssignment } from "../lib/engine/assignment-subject";
import { canonicalWorkPlan } from "../lib/engine/canonical-work-plan";
import { buildRisksMitigationsTable } from "../lib/engine/risks-mitigations";
import { amplifySectionCDepth } from "../lib/engine/section-c-depth-amplifier";
import { mergeEvidencePieces } from "../lib/engine/compliance-matrix-builder";
import { withoutUnassignedExperts } from "../lib/engine/team-order";
import { scopePlan } from "../lib/engine/scope-delivery-plan";
import { buildTeamToProjectMappingTable, type ExpertRecord, type ProjectRecord } from "../lib/engine/benchmark-tables";

const themeCodes = (text: string) => detectThemes(text).map((t) => t.code);

describe("a word inside another word does not choose the sector", () => {
  it("a hotel client called '… Hospitality Group' is not a hospital", () => {
    const sector = inferSector("Summit Hospitality Group invites consultants for the architectural design of a 60-room business hotel.", { title: "Architectural Design of a 60-Room Business Hotel" });
    assert.match(sector, /Hospitality/);
    assert.equal(isHealthcareSector(sector), false);
    assert.ok(!themeCodes("Summit Hospitality Group: architectural design of a 60-room business hotel.").includes("HEALTHCARE"));
  });

  it("'hospital … design' is not open-pit design, and 'determining' is not mining", () => {
    const codes = themeCodes("Design and construction supervision of a 100-bed general hospital, determining the clinical departments with the client.");
    assert.ok(!codes.includes("MINING_EXTRACTIVE"), codes.join(","));
  });

  it("an office building's MEP design is building services, not biomedical engineering", () => {
    const codes = themeCodes("Architectural, structural and MEP design of a G+8 office building with HVAC, plumbing and fire protection.");
    assert.ok(!codes.includes("MEP_BIOMEDICAL"), codes.join(","));
    assert.ok(codes.includes("MEP_BUILDING_SERVICES"), codes.join(","));
  });

  it("a hospital's emergency power and energy-efficient design is not an energy tender", () => {
    const codes = themeCodes("Design of a specialty hospital with emergency power systems, energy-efficient design and next-generation imaging.");
    assert.ok(!codes.includes("ENERGY_POWER"), codes.join(","));
    assert.ok(themeCodes("Feasibility study and design of a 20 MW solar PV plant with grid connection and a 132 kV substation.").includes("ENERGY_POWER"));
  });
});

describe("building design and construction supervision are different work", () => {
  const DESIGN = "Metro Savings Bank invites consultants for the architectural, structural and MEP design of a G+8 head office building, including tender documents.";
  const SUPERVISION = "Eastvale Education Office invites consultants to supervise the construction of two 16-classroom primary schools, including site supervision and payment certification.";
  const BOTH = "Architectural design and construction supervision of a G+4 municipal office building.";

  it("the sector label says which", () => {
    assert.equal(inferSector(DESIGN, { title: "Architectural and Engineering Design of a G+8 Office Building" }), "Building Design");
    assert.equal(inferSector(SUPERVISION, { title: "Construction Supervision of Two Primary Schools" }), "Building Construction Supervision");
    assert.equal(buildingSectorLabel(BOTH), "Building Design & Construction Supervision");
    assert.equal(isSupervisionOnlyAssignment("The consultant shall supervise the works to the approved design."), true);
    assert.equal(isSupervisionOnlyAssignment("Work under the supervision of the client's project manager on the building design."), false);
  });

  it("a design tender's work plan has design stages, not payment certificates", () => {
    const phases = canonicalWorkPlan({ sector: "Building Design" });
    const text = phases.map((p) => `${p.title} ${p.deliverables}`).join(" ");
    assert.match(phases[0]!.title, /Inception/);
    assert.match(text, /Concept Design/);
    assert.doesNotMatch(text, /Payment Certif|Interim Payment|Variation Order/i);
    assert.match(canonicalWorkPlan({ sector: "Building Construction Supervision" }).map((p) => p.title).join(" "), /Payment Certification/);
  });

  it("a design tender's risk register is about design, not contractors", () => {
    const table = buildRisksMitigationsTable({ primarySector: "Building Design", clientName: "Metro Savings Bank" });
    assert.match(table, /Brief changes after concept approval/);
    assert.doesNotMatch(table, /Variation-order disputes|payment certificate/i);
  });

  it("a design tender's methodology is design, even under the combined label", () => {
    const empty = "# Section C: Technical Approach\n\nIntroductory paragraph.\n";
    const design = amplifySectionCDepth(empty, { primarySector: "Building Design & Construction Supervision", projects: [], companyName: "Firm", sourceText: DESIGN }).markdown;
    assert.doesNotMatch(design, /site inspection regime|interim-payment-certificate/i);
    assert.match(design, /concept design/i);
    const supervision = amplifySectionCDepth(empty, { primarySector: "Building Construction Supervision", projects: [], companyName: "Firm", sourceText: SUPERVISION }).markdown;
    assert.match(supervision, /site inspection regime/i);
  });
});

describe("depth for a thin sub-section lands under that sub-section", () => {
  it("the Quality Assurance paragraph is not appended under Technical Methodology", () => {
    const markdown = [
      "# Section C: Technical Approach",
      "",
      "## C.1 Tender Specifics Recognised by This Proposal",
      "",
      "| Tender Specific | Recognised |",
      "|---|---|",
      "| Location | Addis Ababa |",
      "",
      "## C.2 Understanding of the Assignment",
      "",
      "The client needs a clinic designed and renovated in an existing building, with each stage approved before the next proceeds, and the team has read the scope in that order.",
      "",
      "## C.3 Quality Assurance",
      "",
      "Short QA note.",
      "",
      "## C.4 Technical Methodology",
      "",
      "Short methodology note.",
      "",
      "# Section D: Additional Information",
    ].join("\n");
    const out = amplifySectionCDepth(markdown, { primarySector: "Healthcare / Medical Facility Design", projects: [], companyName: "Firm" }).markdown;
    const methodology = out.slice(out.indexOf("## C.4 Technical Methodology"), out.indexOf("# Section D"));
    const qa = out.slice(out.indexOf("## C.3 Quality Assurance"), out.indexOf("## C.4 Technical Methodology"));
    assert.doesNotMatch(methodology, /Quality gates at 30% Schematic/);
    assert.match(qa, /Quality gates at 30% Schematic/);
    assert.match(methodology, /functional programme of the clinical brief/);
  });
});

describe("the compliance matrix says each kind of evidence once", () => {
  it("merges same-kind pieces and their references", () => {
    assert.equal(mergeEvidencePieces(["from company document", "from company document"]), "from company document");
    assert.equal(
      mergeEvidencePieces(["from project reference (Riverside Hospital, Lakeshore Hotel)", "from project reference (Riverside Hospital)", "from expert CV (Hanna Tadesse)"]),
      "from project reference (Riverside Hospital, Lakeshore Hotel); from expert CV (Hanna Tadesse)",
    );
  });
});

const CLINIC_SCOPE = [
  "Scope of Services",
  "1. Site Identification and Technical Assessment: The consultant shall assess candidate buildings for suitability as an eye clinic.",
  "2. Conceptual and Detailed Architectural Design: The consultant shall prepare concept and detailed architectural designs for the clinic.",
  "3. Building Services Coordination: The consultant shall coordinate mechanical, electrical, plumbing and medical gas systems.",
  "4. Renovation Planning and Implementation Oversight: The consultant shall prepare renovation drawings and specifications, and supervise renovation works.",
  "5. Handover Support: The consultant shall conduct a final inspection and support handover documentation.",
].join("\n");

const TEAM: ExpertRecord[] = [
  { fullName: "Hanna Tadesse", title: "Managing Director / Principal Architect" },
  { fullName: "Samuel Bekele", title: "Senior Structural Engineer" },
  { fullName: "Ruth Haile", title: "MEP Engineer" },
  { fullName: "Meron Assefa", title: "Senior Highway Engineer" },
  { fullName: "Lidya Alemu", title: "Senior Architect" },
];

describe("the proposed team is the people the scope gives work to", () => {
  it("leaves an expert with no scope role and no required role off the team", () => {
    const { team, dropped } = withoutUnassignedExperts(TEAM, CLINIC_SCOPE);
    assert.deepEqual(dropped.map((e) => e.fullName), ["Meron Assefa"]);
    assert.ok(team.some((e) => e.fullName === "Hanna Tadesse"));
  });

  it("keeps an expert a personnel requirement names, and never goes below the minimum", () => {
    assert.equal(withoutUnassignedExperts(TEAM, CLINIC_SCOPE, { personnelRequirementText: ["Highway engineer for access road"] }).dropped.length, 1);
    assert.equal(withoutUnassignedExperts(TEAM, CLINIC_SCOPE, { minimum: 5 }).team.length, 5);
    assert.equal(withoutUnassignedExperts(TEAM, "A tender with no scope list.").dropped.length, 0);
  });

  it("a renovation item carries the existing-building risk, not the design item's", () => {
    const plan = scopePlan({ tenderText: CLINIC_SCOPE, experts: TEAM });
    const renovation = plan.find((p) => /Renovation/.test(p.item.title));
    const design = plan.find((p) => /Architectural Design/.test(p.item.title));
    assert.ok(renovation && design);
    assert.match(renovation.risk, /Hidden conditions in the existing building/);
    assert.notEqual(renovation.risk, design.risk);
  });
});

describe("a project's header card is not a technical contribution", () => {
  it("falls back to the firm's recorded services in the expert's discipline", () => {
    const projects = [{
      name: "Riverside District Hospital",
      summary: "Riverside District Hospital / Riverside Town, Northern Region, Ethiopia (12,000 m²)",
      serviceAreas: JSON.stringify(["Feasibility study", "Architectural design", "Structural design", "MEP design"]),
    }] as ProjectRecord[];
    const experts: ExpertRecord[] = [{ fullName: "Ruth Haile", title: "MEP Engineer", profile: "MEP design for Riverside District Hospital." }];
    const table = buildTeamToProjectMappingTable(experts, projects);
    const row = table.split("\n").find((l) => l.startsWith("| Ruth Haile"))!;
    const contribution = row.split("|").at(-2)!.trim();
    assert.doesNotMatch(contribution, /Riverside Town/);
    assert.match(contribution, /MEP design, the firm's recorded services on this project in this expert's discipline/);
  });
});

describe("a quantity on one role is not the size of the team", () => {
  it("'A registered architect' (quantity 1) does not cap the team at one person", async () => {
    const { deriveRequirementConstraintProfile } = await import("../lib/engine/requirement-constraints");
    const profile = deriveRequirementConstraintProfile([
      { title: "Registered Architect", description: "A registered architect.", requirementType: "EXPERT", priority: "MANDATORY", requiredQuantity: 1 },
      { title: "MEP Engineer", description: "An MEP engineer with healthcare experience.", requirementType: "EXPERT", priority: "MANDATORY", requiredQuantity: 2 },
    ]);
    assert.equal(profile.explicitExpertCount, 0, "no team head count was stated");
    assert.ok(profile.expertCount >= 3, `per-role quantities add up to a floor: ${profile.expertCount}`);
  });

  it("a personnel row with no single role keeps its head count", async () => {
    const { deriveRequirementConstraintProfile } = await import("../lib/engine/requirement-constraints");
    const profile = deriveRequirementConstraintProfile([
      { title: "Personnel", description: "Provide key staff.", requirementType: "EXPERT", priority: "MANDATORY", requiredQuantity: 4 },
    ]);
    assert.equal(profile.explicitExpertCount, 4);
  });
});

describe("a phase lead holds the phase's own role, not the word 'engineer'", () => {
  it("a Senior Electrical Engineer does not lead the construction-supervision phase", async () => {
    const { buildWorkPlanTable } = await import("../lib/engine/work-plan-timeline");
    const table = buildWorkPlanTable({
      primarySector: "Healthcare / Medical Facility Design",
      experts: [
        { fullName: "Hanna Tadesse", title: "General Manager & Practicing Professional Engineer" },
        { fullName: "Ruth Haile", title: "Senior Electrical Engineer" },
      ],
    });
    const supervision = table.split("\n").find((l) => /Construction Supervision/.test(l))!;
    assert.doesNotMatch(supervision, /Ruth Haile/);
    assert.match(supervision, /Resident Engineer/);
    // The executive is the Project Principal, at the start and at close-out.
    const principalRows = table.split("\n").filter((l) => /^\| (?:1\. Inception|5\. Close-out)/.test(l));
    assert.equal(principalRows.length, 2);
    for (const row of principalRows) assert.match(row, /Hanna Tadesse/);
  });
});

describe("a service-lines list that collapsed to one bullet is rebuilt from the firm's records", () => {
  it("adds the recorded service lines the tender calls for, and leaves a real list alone", async () => {
    const { repairCollapsedServiceLines } = await import("../lib/engine/service-lines-repair");
    const serviceLines = ["Feasibility studies", "Architectural design", "MEP design", "Road and infrastructure consultancy", "Heritage conservation", "Tender document preparation"];
    const tenderText = "The consultant shall prepare architectural designs and coordinate MEP systems after a feasibility review of the premises.";
    const collapsed = "## A.2 Core Service Lines (directly relevant to the clinic)\n- Feasibility studies\n\n## A.3 Proposed Project Team\n";
    const out = repairCollapsedServiceLines(collapsed, { serviceLines, tenderText });
    assert.equal(out.repaired, true);
    assert.match(out.markdown, /- Architectural design/);
    assert.match(out.markdown, /- MEP design/);
    assert.doesNotMatch(out.markdown, /Road and infrastructure|Heritage|Tender document/);
    assert.equal((out.markdown.match(/- Feasibility studies/g) ?? []).length, 1);
    assert.match(out.markdown, /## A\.3 Proposed Project Team/);
    const full = "## A.2 Core Service Lines\n- Architectural design\n- MEP design\n";
    assert.equal(repairCollapsedServiceLines(full, { serviceLines, tenderText }).repaired, false);
  });
});

describe("an architect's contribution is architectural work", () => {
  it("does not credit an Architect with structural or MEP design", () => {
    const projects = [{
      name: "Riverside District Hospital",
      summary: "Riverside District Hospital / Riverside Town (12,000 m²)",
      serviceAreas: JSON.stringify(["Feasibility study", "Architectural design", "Structural design", "MEP design", "Renovation design"]),
    }] as ProjectRecord[];
    const experts: ExpertRecord[] = [{ fullName: "Lidya Alemu", title: "Architect", profile: "Architect on Riverside District Hospital." }];
    const row = buildTeamToProjectMappingTable(experts, projects).split("\n").find((l) => l.startsWith("| Lidya Alemu"))!;
    assert.match(row, /Architectural design and renovation design, the firm's recorded services/);
    assert.doesNotMatch(row.split("|").at(-2)!, /Structural design|MEP design/);
  });
});
