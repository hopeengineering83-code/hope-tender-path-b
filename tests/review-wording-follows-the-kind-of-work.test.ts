// The quality and review wording follows the kind of work a tender buys.
//
// The 2026-10-08 tender-type matrix found a building-design review — "30%
// Schematic Design: floor plans, zoning, and MEP routing confirmed" — in the
// proposals for a geotechnical investigation, a structural condition
// assessment, and two construction-supervision contracts; a road-supervision
// contract reviewed at "Detailed Design & Tender Documents"; and "Three-stage
// design review (schematic / developed / pre-issue)" in the why-us, value,
// risk and value-added text of every proposal, a quantity-surveying service
// and an ESIA included. The geotechnical investigation was also given ETABS
// structural analysis and a "schematic to working-drawing" design review.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { reviewDisciplineOf, threeStageReview } from "../lib/engine/assignment-subject";
import { buildThreeStageReviewTable } from "../lib/engine/benchmark-tables";
import { buildWhyUsSummary } from "../lib/engine/why-us-summary";
import { buildRisksMitigationsTable } from "../lib/engine/risks-mitigations";
import { buildValueAddedServices } from "../lib/engine/understanding-and-value-added";
import { detectThemes } from "../lib/engine/proposal-intelligence";

const DESIGN_REVIEW = /schematic|floor plans|MEP routing|developed design|working-drawing|detailed design & tender/i;

describe("the kind of work is read from what the tender buys", () => {
  for (const [title, kind] of [
    ["Construction Supervision of the Eastvale–Northpoint Road Rehabilitation (48 km)", "SUPERVISION"],
    ["Construction Supervision of Two Primary Schools", "SUPERVISION"],
    ["Geotechnical Investigation for a Regional Library", "STUDY"],
    ["Structural Condition Assessment of the Municipal Office Building", "STUDY"],
    ["Feasibility Study for an Agro-Industrial Park", "STUDY"],
    ["Quantity Surveying and Contract Administration Services for a Housing Project", "CONTRACT_ADMINISTRATION"],
    ["Architectural and Engineering Design of a G+8 Office Building", "DESIGN"],
    ["Design and Construction Supervision of a 100-Bed General Hospital", "DESIGN"],
    ["Feasibility Study and Design of a Town Water Supply", "DESIGN"],
  ] as const) {
    it(`${title} → ${kind}`, () => assert.equal(reviewDisciplineOf(title, ""), kind));
  }

  it("a title that does not say falls back to the tender's text", () => {
    assert.equal(reviewDisciplineOf("Consultancy Services for the Municipality", "The consultant shall supervise the construction works and certify interim payments."), "SUPERVISION");
    assert.equal(reviewDisciplineOf("Consultancy Services", "No particular work is named."), "GENERAL");
  });
});

describe("the review a proposal promises", () => {
  it("supervision, study and cost work are not reviewed at design stages, whatever the sector", () => {
    for (const [sector, discipline] of [["Roads & Highways", "SUPERVISION"], ["Building Construction Supervision", "SUPERVISION"], ["Geotechnical & Structural Engineering", "STUDY"], ["Structural Assessment & Retrofit", "STUDY"], ["Contract Administration & Quantity Surveying", "CONTRACT_ADMINISTRATION"]] as const) {
      const table = buildThreeStageReviewTable("Northgate PLC", sector, discipline);
      assert.doesNotMatch(table, DESIGN_REVIEW, `${sector} / ${discipline}`);
      assert.match(table, /\| Stage 1 \|/);
    }
    assert.match(buildThreeStageReviewTable("Northgate PLC", "Building Construction Supervision", "SUPERVISION"), /payment certificates/);
    assert.match(buildThreeStageReviewTable("Northgate PLC", "Contract Administration & Quantity Surveying", "CONTRACT_ADMINISTRATION"), /final account/i);
  });

  it("an ESIA keeps its own baseline and draft-ESMP stages; a design keeps design stages", () => {
    assert.match(buildThreeStageReviewTable("Northgate PLC", "Environmental & Social Impact Assessment", "STUDY"), /Baseline Assessment/);
    assert.match(buildThreeStageReviewTable("Northgate PLC", "Building Design", "DESIGN"), /Schematic Design/);
  });

  it("the why-us, risk and value-added wording uses the same stages", () => {
    const why = buildWhyUsSummary({
      companyName: "Northgate PLC", clientName: "Client",
      experts: [{ fullName: "A. Engineer", title: "Lead Geotechnical Engineer", yearsExperience: 12 } as never],
      projects: [{ name: "Central Market Geotechnical Investigation", clientName: "City Bureau", contractValue: 3_200_000, currency: "ETB" } as never],
      differentiators: ["In-house soil testing laboratory."], primarySector: "Geotechnical & Structural Engineering", reviewDiscipline: "STUDY",
    }) ?? "";
    assert.doesNotMatch(why, /design review|schematic/i);
    assert.match(why, /investigation programme \/ draft findings \/ final report/);
    const risks = buildRisksMitigationsTable({ primarySector: "Industrial / Manufacturing", clientName: "Client", reviewDiscipline: "STUDY" });
    assert.doesNotMatch(risks, /schematic/i);
    const valueAdded = buildValueAddedServices({ primarySector: "Contract Administration & Quantity Surveying", companyName: "Northgate PLC", reviewDiscipline: "CONTRACT_ADMINISTRATION" });
    assert.doesNotMatch(valueAdded, /schematic|design review/i);
    assert.equal(threeStageReview("DESIGN").stages, "schematic, developed and pre-issue");
  });
});

describe("a theme speaks only to the work asked for", () => {
  it("a geotechnical investigation gets the investigation, not structural analysis or a design review", () => {
    const themes = detectThemes("Geotechnical investigation for a G+3 regional library, including boreholes, in-situ testing, laboratory testing and a foundation recommendation report.");
    const bullets = themes.flatMap((t) => t.methodologyBullets).join("\n");
    assert.match(bullets, /borehole drilling/);
    assert.doesNotMatch(bullets, /ETABS|working-drawing/);
  });

  it("a structural design keeps all three", () => {
    const themes = detectThemes("Structural design of a G+8 office building with seismic detailing, foundation design and a geotechnical investigation.");
    const theme = themes.find((t) => t.code === "STRUCTURAL_GEOTECHNICAL")!;
    assert.equal(theme.methodologyBullets.length, 3);
  });
});
