import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

describe("AI system prompt strict tender-scope guard", () => {
  it("does not hard-force canonical section names in narrative-throughline rule", async () => {
    const src = await readFile("lib/ai.ts", "utf8");
    assert.equal(
      src.includes("appear by name in the Cover Letter, the Executive Summary, AND the Relevant Experience section"),
      false,
    );
    assert.ok(src.includes("STRICT TENDER SCOPE"), "expected strict tender scope rule in DEFAULT_PROPOSAL_SYSTEM_PROMPT");
  });
});

