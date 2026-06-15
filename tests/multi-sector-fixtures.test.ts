// Multi-sector regression fixtures — proves that sector classification,
// requirement type detection, export gating, and submission-plan
// classification all behave correctly across the four most common
// tender sectors encountered in production.
//
// SECTORS COVERED
// ───────────────
// 1. Healthcare (hospital design + clinical engineering)
// 2. Road / Transport (pavement, bridges, drainage)
// 3. Water supply & sanitation (WASH, boreholes, treatment)
// 4. Building design — commercial / office fit-out
//
// These fixtures are pure-function tests: no DB, no AI, no network.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyUniversalTender } from "../lib/engine/metadata/universal-tender-taxonomy";
import { detectDominantFamily } from "../lib/engine/matching/matching";
import { classifySubmissionPlanItem, shouldRowBecomePlannedFile } from "../lib/engine/plans/submission-plan-classifier";
import { checkExportReadiness } from "../lib/engine/export/export-readiness";
import { deriveDocumentOutputState, EXPORT_BLOCKING_STATES } from "../lib/engine/export/document-output-state";

// ─── Sector fixture texts ──────────────────────────────────────────────────

const HEALTHCARE_TENDER_TEXT = `
Request for Proposal — Architectural and Engineering Consultancy Services
Pharo Foundation Specialty Medical Center, Addis Ababa

Scope of Services:
The selected firm shall provide full architectural and engineering design
services for a 120-bed specialty hospital. Scope includes:
  • Architectural concept and schematic design with clinical workflow
  • Infection prevention and control (IPC) layout
  • Patient flow and clinical zoning
  • Medical gas piping and biomedical equipment coordination
  • HVAC design for operating theatres and ICU
  • Structural engineering and MEP services

Key Personnel Required:
  • Lead Architect with hospital design experience (minimum 5 similar projects)
  • Biomedical/Clinical Engineer (3+ years healthcare facility experience)
  • Structural Engineer

Submission Requirements:
  • Technical Proposal (sealed envelope A)
  • Financial Proposal (sealed envelope B — do not include prices in technical)
  • CVs and project references for all key personnel
  • Audited financial statements (last 3 years)
  • Firm registration certificate

Evaluation Criteria:
  60% Technical, 40% Financial
  Technical score: Experience (30%), Personnel (20%), Methodology (10%)
`;

const ROAD_TRANSPORT_TENDER_TEXT = `
Invitation to Tender — Road and Bridge Design Consultancy
Ethiopian Roads Authority — Jimma–Mizan Highway Upgrading, Phase 2

The ERA invites qualified consultancy firms to submit proposals for:
  • Detailed engineering design of 85 km road section (upgrading to Class B)
  • Pavement design with traffic count and axle load survey
  • Bridge design (3 major crossings, 12 culvert structures)
  • Drainage and erosion control structures
  • Highway safety audit
  • Environmental and social impact assessment (ESIA)

Required project experience (last 10 years):
  • Minimum two (2) comparable road design projects ≥ 50 km
  • At least one bridge design project (span ≥ 20 m)

Key Personnel:
  • Highway Design Engineer (Team Leader, 10+ years)
  • Bridge/Structural Engineer (7+ years)
  • Geotechnical/Pavement Engineer
  • Environmental Specialist (ESIA certified)
  • Survey Engineer

Deliverables:
  • Design Report and Drawings Package (AUTOCAD)
  • BOQ and Engineer's Cost Estimate
  • ESIA Report
  • Geotechnical Investigation Report
`;

const WATER_SUPPLY_TENDER_TEXT = `
Terms of Reference — Water Supply and Sanitation System Design
Oromia Water, Mines and Energy Bureau — Adama Town WASH Programme

Scope of Work:
The consultant shall design a piped water supply system for 45,000 beneficiaries.
Services include:
  • Borehole siting and hydrogeological survey
  • Hydraulic modelling of the distribution network
  • Pump station and rising main design
  • Storage reservoir sizing (500 m³)
  • Sanitation and hygiene (WASH) component
  • Wastewater collection network concept design

Required Experience:
  • Minimum 3 water supply projects (per population ≥ 10,000)
  • Borehole drilling supervision experience
  • WASH programme alignment

Key Experts:
  • Hydraulic/Water Supply Engineer (Team Leader)
  • Hydrogeologist
  • Sanitation/Environmental Specialist
  • Community/Social Mobilisation Expert

Submission Format:
  1. Technical Proposal (2 hard copies + 1 soft copy)
  2. Financial Proposal (sealed separate envelope)
  3. Company registration and tax clearance
`;

const BUILDING_DESIGN_TENDER_TEXT = `
Request for Quotation — Interior Design and Fit-Out Consultancy
Commercial Tower, 6th Floor Office Premises, Bole Road, Addis Ababa

Scope:
Provide interior design and fit-out services for 1,200 m² open-plan office.
Work includes:
  • Space planning and concept design
  • Furniture layout and specifications
  • Partition, ceiling, and flooring design
  • MEP coordination (power, data, lighting)
  • Tender documentation (BOQ and specifications)

Personnel:
  • Interior Architect (lead)
  • MEP Coordinator

Submission:
  • Design Proposal (A3 presentation boards)
  • BOQ and unit rates
  • Portfolio of 3 similar completed fit-out projects
`;

// ─── 1. Sector classification — classifyUniversalTender ───────────────────

describe("multi-sector: classifyUniversalTender", () => {
  it("healthcare tender → HEALTHCARE sector domain + ARCHITECTURAL_DESIGN + MEP", () => {
    const profile = classifyUniversalTender(HEALTHCARE_TENDER_TEXT);
    assert.ok(profile.sectorDomains.includes("HEALTHCARE"), `expected HEALTHCARE in ${profile.sectorDomains}`);
    assert.ok(profile.serviceCapabilities.includes("ARCHITECTURAL_DESIGN"), `expected ARCHITECTURAL_DESIGN in ${profile.serviceCapabilities}`);
    assert.ok(profile.serviceCapabilities.includes("MEP_ELECTROMECHANICAL"), `expected MEP_ELECTROMECHANICAL in ${profile.serviceCapabilities}`);
  });

  it("road/transport tender → TRANSPORT sector + ENGINEERING_DESIGN + ENVIRONMENT_SOCIAL", () => {
    const profile = classifyUniversalTender(ROAD_TRANSPORT_TENDER_TEXT);
    // Road tenders map to TRANSPORT domain in the sector taxonomy
    const hasTransportSector = profile.sectorDomains.some((s) => ["TRANSPORT", "URBAN_MUNICIPAL"].includes(s));
    assert.ok(hasTransportSector, `expected TRANSPORT or URBAN_MUNICIPAL in ${profile.sectorDomains}`);
    assert.ok(profile.serviceCapabilities.includes("ENGINEERING_DESIGN"), `expected ENGINEERING_DESIGN in ${profile.serviceCapabilities}`);
    assert.ok(profile.serviceCapabilities.includes("ENVIRONMENT_SOCIAL"), `expected ENVIRONMENT_SOCIAL in ${profile.serviceCapabilities}`);
  });

  it("water supply tender → WATER_SANITATION sector + WATER_SANITATION capability", () => {
    const profile = classifyUniversalTender(WATER_SUPPLY_TENDER_TEXT);
    assert.ok(profile.sectorDomains.includes("WATER_SANITATION"), `expected WATER_SANITATION in ${profile.sectorDomains}`);
    assert.ok(profile.serviceCapabilities.includes("WATER_SANITATION"), `expected WATER_SANITATION capability in ${profile.serviceCapabilities}`);
  });

  it("office fit-out tender → COMMERCIAL_INDUSTRIAL or GENERAL_BUILDINGS + INTERIOR_DESIGN", () => {
    const profile = classifyUniversalTender(BUILDING_DESIGN_TENDER_TEXT);
    const hasBuildingSector = profile.sectorDomains.some((s) => ["COMMERCIAL_INDUSTRIAL", "GENERAL_BUILDINGS", "RESIDENTIAL_HOUSING"].includes(s));
    assert.ok(hasBuildingSector, `expected a building sector domain in ${profile.sectorDomains}`);
    assert.ok(profile.serviceCapabilities.includes("INTERIOR_DESIGN"), `expected INTERIOR_DESIGN in ${profile.serviceCapabilities}`);
  });
});

// ─── 2. Dominant family detection — detectDominantFamily ──────────────────

describe("multi-sector: detectDominantFamily", () => {
  it("healthcare tender text → HEALTHCARE_FACILITIES dominant family", () => {
    const family = detectDominantFamily(HEALTHCARE_TENDER_TEXT);
    assert.equal(family, "HEALTHCARE_FACILITIES");
  });

  it("road/bridge text has no dominant sector family (CIVIL_INFRASTRUCTURE is not sector-defining)", () => {
    // CIVIL_INFRASTRUCTURE is not in SECTOR_DEFINING_FAMILIES — it's too generic.
    // Road tenders don't trigger a dominant sector lock-out, so any project
    // type can match unless another sector family (e.g. ENVIRONMENT_SOCIAL) dominates.
    const roadOnlyText = "Detailed engineering design of 85 km road section upgrading to Class B. Pavement design with traffic and axle load survey. Bridge design for 3 major crossings. Highway drainage and culvert structures. Road safety audit. Civil engineering works.";
    const family = detectDominantFamily(roadOnlyText);
    // Should be null (no dominant family) or ENVIRONMENT_SOCIAL if env keywords are present
    assert.ok(family === null || family === "ENVIRONMENT_SOCIAL", `expected null or ENVIRONMENT_SOCIAL, got ${family}`);
  });

  it("water supply tender text → WATER_SUPPLY dominant family", () => {
    const family = detectDominantFamily(WATER_SUPPLY_TENDER_TEXT);
    assert.equal(family, "WATER_SUPPLY");
  });
});

// ─── 3. Submission-plan classification across sectors ─────────────────────

describe("multi-sector: submission-plan classification", () => {
  // Healthcare sector deliverables
  it("'Technical Proposal' is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "Technical Proposal" }), true);
  });

  it("'Financial Proposal' is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "Financial Proposal" }), true);
  });

  it("'Sealed envelope B — do not include prices in technical' is a commercial-separation rule", () => {
    const r = classifySubmissionPlanItem({ title: "Sealed envelope B — do not include prices in technical" });
    assert.equal(r.shouldBePlannedFile, false);
  });

  // Road sector deliverables: exact filenames unlock REQUIRED_OUTPUT_FILE
  it("'BOQ and Engineer's Cost Estimate' with .xlsx filename is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "BOQ and Engineer's Cost Estimate", exactFileName: "BOQ-Engineers-Estimate.xlsx" }), true);
  });

  it("'ESIA Report' with .pdf filename is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "ESIA Report", exactFileName: "ESIA-Report.pdf" }), true);
  });

  it("'Geotechnical Investigation Report' with .pdf filename is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "Geotechnical Investigation Report", exactFileName: "Geotechnical-Report.pdf" }), true);
  });

  // Water sector
  it("'Company registration and tax clearance' is an original evidence attachment", () => {
    const r = classifySubmissionPlanItem({ title: "Company registration and tax clearance" });
    assert.notEqual(r.category, "REQUIRED_OUTPUT_FILE");
    assert.equal(r.shouldBePlannedFile, false);
  });

  // Building sector: "Design Proposal" with an exact DOCX filename is a deliverable
  it("'Design Proposal' with .docx filename is a required output file", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "Design Proposal", exactFileName: "Design-Proposal.docx" }), true);
  });

  it("'Portfolio of 3 similar completed fit-out projects' is an original evidence attachment", () => {
    const r = classifySubmissionPlanItem({ title: "Portfolio of 3 similar completed fit-out projects" });
    assert.equal(r.shouldBePlannedFile, false);
  });
});

// ─── 4. Export gating — QUICK_DRAFT and NOT_EXPORTABLE must not export ────

describe("multi-sector: export gates for AI-generated background documents", () => {
  const BLOCKING_DOC_BASE = {
    id: "d1",
    name: "Quick Draft — Healthcare Technical Proposal",
    exactFileName: "quick-draft.md",
    generationStatus: "GENERATED",
    validationStatus: "PENDING",
    reviewStatus: "NOT_EXPORTABLE" as string,
    documentType: "QUICK_DRAFT" as string,
    format: "MARKDOWN" as string,
    fileContent: "# Healthcare Technical Proposal\nThis is a quick draft.",
  };

  it("QUICK_DRAFT/MARKDOWN document has a blocking output state", () => {
    const state = deriveDocumentOutputState(BLOCKING_DOC_BASE);
    assert.ok(
      (EXPORT_BLOCKING_STATES as readonly string[]).includes(state),
      `expected blocking state, got ${state}`,
    );
  });

  it("checkExportReadiness blocks export of QUICK_DRAFT document regardless of sector", () => {
    // Test across all four sector variants of the same pattern
    for (const name of [
      "Healthcare Technical Proposal Quick Draft",
      "Road Design Technical Proposal Draft",
      "Water Supply WASH Proposal Background Draft",
      "Office Fit-Out Design Proposal Draft",
    ]) {
      const result = checkExportReadiness([{ ...BLOCKING_DOC_BASE, id: `d-${name}`, name }]);
      assert.equal(result.ok, false, `expected export blocked for: ${name}`);
      assert.ok(result.failures.length > 0, `expected failures for: ${name}`);
    }
  });

  it("zero documents gate fires before sector-specific checks", () => {
    const result = checkExportReadiness([]);
    assert.equal(result.ok, false);
    assert.ok(/NO_ACTIVE_GENERATED_DOCUMENTS|at least one/i.test(result.failures[0].reasons[0]));
  });

  it("fully reviewed DOCX document with correct statuses is exportable", () => {
    const READY_DOC = {
      id: "d-ready",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      documentType: null as string | null,
      format: "DOCX" as string | null,
      // Minimal ZIP/PK magic bytes in base64 — passes DOCX check
      fileContent: "UEsDBA==",
    };
    const state = deriveDocumentOutputState(READY_DOC);
    assert.equal(state, "READY_FOR_EXPORT");
    const result = checkExportReadiness([READY_DOC]);
    assert.equal(result.ok, true, `expected export ok but got: ${JSON.stringify(result.failures)}`);
  });
});
