#!/usr/bin/env python3
"""Fail closed before proposal persistence when any section uses fallback.

The script is one-shot and exact: it patches the known background proposal
persistence caller and creates a source-order regression test. It refuses to
run if the expected source block has moved or was already changed.
"""

from pathlib import Path

HANDLER = Path("lib/ai-job-handlers.ts")
TEST = Path("tests/proposal-mixed-fallback-zero-write.test.ts")

OLD = '''    // If ALL sections used deterministic fallback, this is NOT AI output.
    // Record the provenance but do NOT create a GeneratedDocument — fallback
    // content must never be persisted as a generated proposal.
    if (sectionResult.allFallback) {
      await recordStep(ctx.jobId, {
        stepName: "proposal.fallback",
        message: "All sections used deterministic fallback — output is non-AI. No GeneratedDocument persisted.",
        status: "FAILED",
      });
      throw new Error("AI_PROPOSAL_ALL_SECTIONS_FALLBACK");
    }
'''

NEW = '''    // Fail closed on ANY deterministic fallback. Mixed AI/fallback output is
    // not an authoritative proposal and must be rejected before readiness
    // recheck, byte encoding, transaction entry, database insert, or storage.
    if (sectionResult.anyFallback) {
      const fallbackSectionIds = sectionResult.sections
        .filter((section) => section.source === "fallback")
        .map((section) => section.id);
      await recordStep(ctx.jobId, {
        stepName: "proposal.fallback",
        message: `Blocked non-authoritative proposal output: deterministic fallback used by ${fallbackSectionIds.length} section(s) (${fallbackSectionIds.join(", ") || "unknown"}). Zero documents and zero bytes persisted.`,
        status: "FAILED",
      });
      throw new Error(sectionResult.allFallback
        ? "AI_PROPOSAL_ALL_SECTIONS_FALLBACK"
        : "AI_PROPOSAL_MIXED_FALLBACK_BLOCKED");
    }
'''

TEST_CONTENT = '''import { describe, it } from "node:test";
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
'''


def main() -> None:
    source = HANDLER.read_text(encoding="utf-8")
    count = source.count(OLD)
    if count != 1:
        raise RuntimeError(f"Expected one unpatched fallback block, found {count}")
    HANDLER.write_text(source.replace(OLD, NEW, 1), encoding="utf-8")
    if TEST.exists():
        raise RuntimeError(f"{TEST} already exists; refusing to overwrite")
    TEST.write_text(TEST_CONTENT, encoding="utf-8")
    print(f"Patched {HANDLER} and created {TEST}")


if __name__ == "__main__":
    main()
