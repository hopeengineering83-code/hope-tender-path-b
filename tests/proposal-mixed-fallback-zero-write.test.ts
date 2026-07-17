import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai-job-handlers.ts", "utf8");

describe("proposal mixed-fallback zero-write invariant", () => {
  it("blocks any fallback section, not only all-fallback output", () => {
    assert.match(source, /if \(sectionResult\.anyFallback\)/);
    assert.match(source, /AI_PROPOSAL_MIXED_FALLBACK_BLOCKED/);
    assert.match(source, /AI_PROPOSAL_ALL_SECTIONS_FALLBACK/);
    assert.doesNotMatch(source, /if \(sectionResult\.allFallback\) \{/);
  });

  it("rejects before every readiness, encoding, transaction, database, or byte-write path", () => {
    const gate = source.indexOf("if (sectionResult.anyFallback)");
    const readiness = source.indexOf("const postGenerationReadiness", gate);
    const encoding = source.indexOf("Buffer.from(markdown", gate);
    const transaction = source.indexOf("prisma.$transaction", gate);
    const insert = source.indexOf("generatedDocument.create", gate);

    assert.ok(gate >= 0, "mixed-fallback gate must exist");
    for (const [label, position] of [
      ["post-generation readiness", readiness],
      ["byte encoding", encoding],
      ["transaction", transaction],
      ["GeneratedDocument insert", insert],
    ] as const) {
      assert.ok(position > gate, `${label} must occur after the fallback rejection`);
    }
  });

  it("records an explicit zero-document and zero-byte outcome", () => {
    assert.match(source, /Zero documents and zero bytes persisted/);
    assert.match(source, /fallbackSectionIds/);
  });
});
