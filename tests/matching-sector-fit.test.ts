// Sector-fit regression tests for lib/engine/matching.ts (PR XX-MATCH-FIX).
//
// THE REGRESSION
// ──────────────
// Real production output (the May-7 benchmark Path tender) anchored its
// cover letter on "Warehouse & Landscaping Project" and "Mohammed Seid
// (G+2 Residential)" for a Pharo Foundation Specialty Medical Center
// tender. Healthcare tenders MUST NOT auto-select warehouse / residential
// projects when the firm vault has stronger comparables (or even when it
// doesn't — better to surface a gap than fake the match).
//
// THE FIX (Fix A + B + C)
// ───────────────────────
// • Tightened capability-family keywords so generic terms like "building",
//   "facility", "construction" don't auto-match for any project containing
//   walls.
// • detectDominantFamily() identifies the tender's sector-defining family
//   (HEALTHCARE_FACILITIES, WATER_SUPPLY, etc.) when ≥ 3 distinct
//   keywords from that family appear in the query.
// • capabilityScore() multiplies by 0.30 when the dominant family is
//   detected but absent from the record — drops score from ~0.85 to
//   ~0.26, below the 0.90 auto-select threshold.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { capabilityScore, detectDominantFamily } from "../lib/engine/matching";

describe("detectDominantFamily", () => {
  it("detects HEALTHCARE_FACILITIES for a hospital tender", () => {
    const query = "Architectural Consultancy for Pharo Health Specialty Medical Center. Hospital design with clinical workflow, infection control (IPC), and patient flow optimization. Biomedical equipment coordination required.";
    assert.equal(detectDominantFamily(query), "HEALTHCARE_FACILITIES");
  });

  it("detects WATER_SUPPLY for a water tender", () => {
    const query = "Water supply network design with hydraulic modelling. Borehole siting + pump station + reservoir + sanitation. WASH programme aligned with sanitary services.";
    assert.equal(detectDominantFamily(query), "WATER_SUPPLY");
  });

  it("returns null for a generic / multi-sector tender", () => {
    const query = "General consultancy services for a building project. Provide site investigation and contract administration support.";
    assert.equal(detectDominantFamily(query), null);
  });

  it("ignores incidental single-keyword mentions (e.g., one stray 'hospital' in a road tender's site map)", () => {
    const query = "Road and bridge design with pavement, drainage, and culvert engineering. The corridor passes near a regional hospital — schedule restrictions apply.";
    // Only ONE healthcare keyword match → not dominant.
    assert.equal(detectDominantFamily(query), null);
  });
});

describe("capabilityScore — dominant-family penalty", () => {
  const HEALTHCARE_TENDER = "Architectural Consultancy for Pharo Health Specialty Medical Center. Hospital design with clinical workflow, infection control (IPC), and patient flow optimization. Biomedical equipment coordination, medical gas, surgical suite, radiology layout, pharmacy zoning.";

  it("warehouse project scores LOW for a healthcare tender (dominant penalty applied)", () => {
    const warehouseRecord = "Warehouse and landscaping project — Ato Jemmi Hussien. Architectural design, structural engineering, MEP design, BOQ, tender documents, construction supervision.";
    const score = capabilityScore(HEALTHCARE_TENDER, warehouseRecord, "project");
    assert.ok(score < 0.50, `expected warehouse score < 0.50 for healthcare tender (penalty applied), got ${score.toFixed(3)}`);
  });

  it("residential project scores LOW for a healthcare tender", () => {
    const residentialRecord = "Mohammed Seid G+2 Residential — Architectural design, structural design, MEP, interior layout, BOQ, supervision.";
    const score = capabilityScore(HEALTHCARE_TENDER, residentialRecord, "project");
    assert.ok(score < 0.50, `expected residential score < 0.50 for healthcare tender, got ${score.toFixed(3)}`);
  });

  it("hospital project scores HIGH for a healthcare tender (no penalty)", () => {
    const hospitalRecord = "Dr Abdu Seid General Hospital — Complete hospital design including clinical zones, surgical suite, radiology, pharmacy, IPC. Architectural design, structural, MEP, medical gas, biomedical equipment coordination, BOQ, supervision.";
    const score = capabilityScore(HEALTHCARE_TENDER, hospitalRecord, "project");
    assert.ok(score > 0.70, `expected hospital score > 0.70 for healthcare tender, got ${score.toFixed(3)}`);
  });

  it("water-supply project scores LOW for healthcare tender", () => {
    const waterRecord = "Assosa Water Supply — Borehole siting, pump station design, reservoir, pipeline network, WASH programme, hydraulic modelling.";
    const score = capabilityScore(HEALTHCARE_TENDER, waterRecord, "project");
    assert.ok(score < 0.50, `expected water-supply score < 0.50 for healthcare tender, got ${score.toFixed(3)}`);
  });

  it("hospital project scores LOW for a water tender (reverse direction)", () => {
    const WATER_TENDER = "Water supply network design — borehole, pump station, reservoir, distribution pipeline, sanitation, WASH, hydraulic modelling, EPANET.";
    const hospitalRecord = "Hospital wing extension — clinical workflow, infection control, surgical suite layout, medical gas, biomedical equipment.";
    const score = capabilityScore(WATER_TENDER, hospitalRecord, "project");
    assert.ok(score < 0.50, `expected hospital score < 0.50 for water tender, got ${score.toFixed(3)}`);
  });

  it("multi-sector project (hospital + water) is not penalised for a healthcare tender", () => {
    // A strong multi-sector record carrying HEALTHCARE_FACILITIES should
    // NOT receive the dominant-family penalty. Its score should be at
    // least DOUBLE what a sector-mismatched warehouse record gets.
    const strongRecord = "Tertiary Hospital and Campus Water Network — Full hospital architectural design, clinical zoning, surgical suites, radiology, biomedical infrastructure, AND on-site water supply, treatment, sanitation, hydraulic modelling, pump station.";
    const warehouseRecord = "Warehouse and landscaping project — Ato Jemmi Hussien. Architectural design, structural engineering, MEP design, BOQ, tender documents, construction supervision.";
    const strongScore = capabilityScore(HEALTHCARE_TENDER, strongRecord, "project");
    const warehouseScore = capabilityScore(HEALTHCARE_TENDER, warehouseRecord, "project");
    assert.ok(strongScore > warehouseScore * 2, `multi-sector strong score (${strongScore.toFixed(3)}) must be >> warehouse score (${warehouseScore.toFixed(3)})`);
    assert.ok(strongScore >= 0.30, `multi-sector strong score should be ≥ 0.30 (not penalty-zeroed), got ${strongScore.toFixed(3)}`);
  });
});
