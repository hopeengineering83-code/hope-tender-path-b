import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { stableRequirementKey } from "../lib/engine/stable-requirements";

describe("stable requirement key", () => {
  it("normalizes case and punctuation", () => {
    const a = stableRequirementKey("legal", "Audited: Financial Statements");
    const b = stableRequirementKey("LEGAL", "audited financial statements");
    assert.equal(a, b);
  });
});
