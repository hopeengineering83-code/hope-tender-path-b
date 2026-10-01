// Regression test for a real gap: generate/route.ts and export/route.ts only
// required eligible company-vault experts/projects when the tender's
// AI-assigned requirementType was exactly "EXPERT" / "PROJECT_EXPERIENCE".
// requirementType is AI-classified, not deterministically verified -- an
// unusually-phrased expert-CV or project-reference requirement could be
// miscategorized and silently disable the evidence gate.
//
// The load-bearing classifier is tested behaviorally below. The route source
// checks are supplemental wiring assertions only and deliberately allow local
// variable renames rather than treating one identifier spelling as authority.

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

  it("does not weaken an explicit expert/project classification", () => {
    const classify = (requirementType: string, text: string) =>
      requirementType === "EXPERT" || requirementType === "PROJECT_EXPERIENCE"
        ? requirementType
        : inferType(text);
    assert.equal(classify("EXPERT", "generic wording"), "EXPERT");
    assert.equal(classify("PROJECT_EXPERIENCE", "generic wording"), "PROJECT_EXPERIENCE");
    assert.equal(
      classify("TECHNICAL", "Bidders must submit CVs for the lead expert and senior expert on the team."),
      "EXPERT",
    );
  });
});

describe("generate/route.ts and export/route.ts wire the inferType safety net alongside requirementType", () => {
  const generateSrc = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
  const exportSrc = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
  const explicitOrFallback = /(?:req|requirement)\.requirementType === "EXPERT" \|\| (?:req|requirement)\.requirementType === "PROJECT_EXPERIENCE"\s*\n\s*\? (?:req|requirement)\.requirementType/;

  it("generate route imports the deterministic classifier and preserves explicit types", () => {
    assert.match(generateSrc, /import \{ inferType as inferRequirementType \} from ".*\/lib\/engine\/analysis"/);
    assert.match(generateSrc, explicitOrFallback);
  });

  it("export preflight imports the deterministic classifier and preserves explicit types", () => {
    assert.match(exportSrc, /import \{ inferType as inferRequirementType \} from ".*\/lib\/engine\/analysis"/);
    assert.match(exportSrc, explicitOrFallback);
  });

  it("generate route's second checkpoint reuses the same safety-net-aware booleans", () => {
    assert.doesNotMatch(generateSrc, /prisma\.tenderRequirement\.count\(\{ where: \{ tenderId: id, requirementType: "EXPERT" \} \}\)/);
    assert.doesNotMatch(generateSrc, /prisma\.tenderRequirement\.count\(\{ where: \{ tenderId: id, requirementType: "PROJECT_EXPERIENCE" \} \}\)/);
  });
});
