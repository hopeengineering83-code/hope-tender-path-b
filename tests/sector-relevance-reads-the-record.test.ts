import { test } from "node:test";
import assert from "node:assert/strict";

import { sectorBoost } from "../lib/engine/matching";

/**
 * A real vault of 114 source-verified projects carried sector: null and
 * serviceAreas: [] on every single one. The uploaded company authority declares
 * it outright — "projectSectorMissing: 114", "projectServiceAreasEmpty: 114",
 * and as policy: "Structured fields are an index only. rawText is the factual
 * source."
 *
 * With both fields empty, sectorBoost returned 0 at its guard, so a hospital
 * project earned exactly as much sector relevance for a hospital tender as a
 * warehouse would. The channel was dead for the entire vault, in every sector,
 * and the delivered proposal cited one project reference while the source text
 * supported several.
 *
 * The fix reads the record's own source-grounded summary for the POSITIVE
 * boost only. The cross-sector penalty still rests on the explicit
 * classification, because a penalty must follow a deliberate classification and
 * not a passing mention: a hospital project whose description mentions the
 * access road must not be condemned as a roads project.
 */

test("an explicitly classified record behaves exactly as before", () => {
  assert.equal(sectorBoost("Healthcare facility design", ["Healthcare", "Hospital design"]), 0.15);
  assert.equal(sectorBoost("Healthcare facility design", ["Roads and highways"]), -0.30);
  assert.equal(sectorBoost(null, ["Healthcare"]), 0);
});

test("an unclassified record earns its boost from its own source text", () => {
  const summary = "Dessie Specialized Hospital / Dessie City Admin. Hospital renovation and supervision: "
    + "structural assessment, architectural modification design, MEP modification design.";
  assert.equal(sectorBoost("Healthcare facility design", [], summary), 0.15);
});

test("the fallback is sector-neutral", () => {
  const cases: Array<[string, string]> = [
    ["Road and highway rehabilitation", "Trunk road rehabilitation: pavement design, drainage, culverts, highway safety audit."],
    ["Water supply and sanitation", "Town water supply scheme: borehole yield testing, reticulation design, reservoir sizing."],
    ["Urban master planning", "Municipal structure plan: land-use zoning, planning standards, infrastructure inventory."],
    ["Geotechnical investigation", "Geotechnical investigation: boreholes, laboratory testing, foundation recommendations."],
  ];
  for (const [tenderSector, summary] of cases) {
    assert.ok(sectorBoost(tenderSector, [], summary) > 0, tenderSector);
  }
});

test("a passing mention in a description cannot trigger the cross-sector penalty", () => {
  // The penalty reads the explicit classification only. This description
  // mentions a road, but the firm never classified the project as roads work.
  const summary = "G+6 general hospital: new architectural and structural design, MEP design, "
    + "site access road and parking layout, construction supervision.";
  assert.ok(sectorBoost("Healthcare facility design", [], summary) >= 0);
});

test("an explicit cross-sector classification is still penalised, whatever the description says", () => {
  const summary = "Warehouse project including a small clinic room for staff.";
  assert.equal(sectorBoost("Healthcare facility design", ["Roads and highways"], summary), -0.30);
});

test("a record with neither classification nor text earns nothing", () => {
  assert.equal(sectorBoost("Healthcare facility design", []), 0);
  assert.equal(sectorBoost("Healthcare facility design", [], ""), 0);
  assert.equal(sectorBoost("Healthcare facility design", [], null), 0);
});

test("an unrelated description earns nothing — the threshold is not lowered", () => {
  const summary = "Supply of office furniture and stationery to a regional bureau.";
  assert.equal(sectorBoost("Healthcare facility design", [], summary), 0);
});
