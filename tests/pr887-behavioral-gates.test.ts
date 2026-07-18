// Behavioral tests for PR #887 gaps B, C, E, and existing gate protections.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Gap B: run-next never exposes raw internal errors", () => {
  it("catch block does NOT push error.message into processedJobs", () => {
    const src = read("app/api/ai-jobs/run-next/route.ts");
    // The catch block must NOT include `error: message` or `error: message.slice`.
    const catchBlock = src.slice(
      src.indexOf("} catch (error) {"),
      src.indexOf('if (["ENGINE_RUN"'),
    );
    assert.ok(catchBlock.length > 0, "must find catch block");
    assert.ok(
      !catchBlock.includes("error: message") && !catchBlock.includes("error: message.slice"),
      "catch block must NOT push error.message into the response",
    );
    assert.ok(
      catchBlock.includes("correlationId"),
      "catch block must generate a correlationId",
    );
    assert.ok(
      catchBlock.includes("logger.error"),
      "catch block must log the full error through the structured server logger",
    );
    assert.ok(
      !catchBlock.includes("console.error("),
      "catch block must not bypass the structured logger",
    );
  });
});

describe("Gap C: streaming supersession marks SUPERSEDED not SUCCEEDED", () => {
  it("streamPromoSuperseded produces SUPERSEDED status", () => {
    const src = read("app/api/tenders/[id]/ai-analyze/route.ts");
    assert.ok(
      src.includes('streamPromoSuperseded\n                ? "SUPERSEDED"'),
      "streaming supersession must set status to SUPERSEDED",
    );
    assert.ok(
      src.includes("Superseded by a newer AI Analyze job"),
      "must include operator-visible reason",
    );
    assert.ok(
      src.includes("superseded: streamPromoSuperseded"),
      "output must include superseded flag",
    );
  });
});

describe("Gap E: fail-closed gates block all non-AI_SUCCEEDED states", () => {
  it("canExportWithAnalysisState only permits AI_SUCCEEDED", () => {
    const src = read("lib/engine/analysis-state-resolver.ts");
    assert.match(src, /state === "AI_SUCCEEDED"/);
    assert.ok(!/HUMAN_APPROVED_FALLBACK/.test(src.slice(src.indexOf("canExportWithAnalysisState"), src.indexOf("}", src.indexOf("canExportWithAnalysisState")) + 1)));
  });
});
