import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getExtractedRequirementCount } from "../lib/engine/analysis-result-metrics";

describe("analysis result requirement metrics", () => {
  it("counts merged requirements, not processing chunks", () => {
    const requirements = Array.from({ length: 12 }, (_, index) => ({ id: index }));
    assert.equal(getExtractedRequirementCount({ requirements }), 12);
  });

  it("returns zero for missing or malformed requirement arrays", () => {
    assert.equal(getExtractedRequirementCount(undefined), 0);
    assert.equal(getExtractedRequirementCount(null), 0);
    assert.equal(getExtractedRequirementCount({ requirements: null }), 0);
    assert.equal(getExtractedRequirementCount({ requirements: "not-an-array" as any }), 0);
  });
});

describe("analysis orchestrator requirement-count wiring", () => {
  const source = readFileSync("lib/engine/analysis-orchestrator.ts", "utf8");

  it("uses one canonical requirement count for progress and return payload", () => {
    assert.match(source, /getExtractedRequirementCount\(analysisMeta\?\.result\)/);
    assert.match(source, /requirementCount,/);
  });

  it("never reports chunk count as requirement count", () => {
    assert.doesNotMatch(
      source,
      /requirementCount:\s*analysisMeta\?\.chunkResults\.length/,
    );
  });
});
