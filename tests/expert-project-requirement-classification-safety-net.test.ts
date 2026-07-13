// Regression test for a real gap: generate/route.ts and export/route.ts only
// required REVIEWED company-vault experts/projects when the tender's
// AI-assigned requirementType was exactly "EXPERT" / "PROJECT_EXPERIENCE".
// requirementType is AI-classified (lib/ai.ts's structured-extraction
// schema), not deterministically verified -- an unusually-phrased expert-CV
// or project-reference requirement could plausibly be miscategorized (e.g.
// as TECHNICAL), which would silently disable the reviewed-evidence gate.
//
// Fix: both routes now also run the same deterministic keyword classifier
// already used by the regex-fallback extraction path (inferType, exported
// from lib/engine/analysis.ts) over the requirement's title/description as
// an OR-signal alongside the AI-assigned requirementType -- it can only
// strengthen the gate, never weaken it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inferType } from "../lib/engine/analysis";

describe("inferType is exported and correctly classifies expert/project requirement text", () => {
  it("is exported from lib/engine/analysis.ts", () => {
    assert.equal(typeof inferType, "function");
  });

  it("classifies an unusually-phrased expert-CV requirement as EXPERT", () => {
    assert.equal(inferType("Bidders must submit CVs for the lead expert and senior expert on the team."), "EXPERT");
  });

  it("classifies an unusually-phrased project-reference requirement as PROJECT_EXPERIENCE", () => {
    assert.equal(inferType("Provide evidence of at least 3 similar completed projects in the past 5 years."), "PROJECT_EXPERIENCE");
  });
});

describe("generate/route.ts and export/route.ts apply the inferType safety net alongside requirementType", () => {
  const generateSrc = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
  const exportSrc = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");

  it("generate/route.ts imports inferType and combines it with requirementType via OR, not replacement", () => {
    assert.match(generateSrc, /import \{ inferType as inferRequirementType \} from ".*\/lib\/engine\/analysis"/);
    assert.match(generateSrc, /req\.requirementType === "EXPERT" \|\| req\.requirementType === "PROJECT_EXPERIENCE"\s*\n\s*\? req\.requirementType/);
  });

  it("export/route.ts imports inferType and combines it with requirementType via OR, not replacement", () => {
    assert.match(exportSrc, /import \{ inferType as inferRequirementType \} from ".*\/lib\/engine\/analysis"/);
    assert.match(exportSrc, /req\.requirementType === "EXPERT" \|\| req\.requirementType === "PROJECT_EXPERIENCE"\s*\n\s*\? req\.requirementType/);
  });

  it("generate/route.ts's second checkpoint reuses the same safety-net-aware booleans (no separate, unguarded count query)", () => {
    assert.doesNotMatch(generateSrc, /prisma\.tenderRequirement\.count\(\{ where: \{ tenderId: id, requirementType: "EXPERT" \} \}\)/);
    assert.doesNotMatch(generateSrc, /prisma\.tenderRequirement\.count\(\{ where: \{ tenderId: id, requirementType: "PROJECT_EXPERIENCE" \} \}\)/);
  });
});
