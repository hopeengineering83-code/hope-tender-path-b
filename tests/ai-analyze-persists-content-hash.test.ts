// Regression: the AI Analyze route MUST persist analysisInputHash on the AiJob.
//
// ROOT CAUSE (production bug): the streaming + non-streaming AI Analyze route
// computed the canonical content hash (lib/engine/tender-analysis-content.ts)
// and stored it only inside the input/output JSON blob as `contentHash`, but
// never wrote the durable `AiJob.analysisInputHash` column.
//
// Downstream, the release snapshot (lib/engine/tender-release-snapshot.ts) and
// the generation-readiness gate (lib/engine/generation-readiness-gate.ts) both
// compare the CURRENT content hash against `latestJob.analysisInputHash`. With
// the column left null, `contentHashMatch` was ALWAYS false, so every tender —
// even immediately after a successful AI Analyze — reported:
//
//   "Tender content changed since the last analysis. Re-run AI Analyze."
//
// That single null cascaded into: canonical-workflow-decision.staleAnalysis=true
// ("Stale — re-run required"), requirements marked untrusted (0/N mandatory
// traced), and generation/export permanently blocked. The user was stuck in an
// infinite "Re-run AI Analyze" loop with no possible resolution.
//
// This test locks the fix: the route must bind analysisInputHash to the same
// canonical contentHash it already computes, at both the job-create and the
// SUCCEEDED-finalization points, for both the streaming and non-streaming paths.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTE = resolve(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts");
const src = readFileSync(ROUTE, "utf8");

describe("AI Analyze route persists analysisInputHash (content-hash binding)", () => {
  it("binds analysisInputHash to the canonical contentHash", () => {
    assert.ok(
      src.includes("analysisInputHash: contentHash"),
      "route must write `analysisInputHash: contentHash` so the release snapshot + generation gate can confirm the analysis is current",
    );
  });

  it("writes analysisInputHash in at least the create AND finalize paths (streaming + non-streaming)", () => {
    // Four write sites: streaming create, streaming SUCCEEDED update,
    // non-streaming create, non-streaming SUCCEEDED update. Require >= 4 so a
    // regression that drops the binding from any single path is caught.
    const occurrences = src.split("analysisInputHash: contentHash").length - 1;
    assert.ok(
      occurrences >= 4,
      `expected analysisInputHash binding in all 4 AiJob write sites (streaming+non-streaming create+finalize), found ${occurrences}`,
    );
  });

  it("uses the canonical Scheme-A hash builder (tender-analysis-content), matching the snapshot/gate", () => {
    // The release snapshot and generation gate compute currentContentHash via
    // buildTenderAnalysisContent + computeAnalysisContentHash from
    // lib/engine/tender-analysis-content. The route MUST bind the SAME hash,
    // otherwise the comparison can never match even when the column is written.
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-analysis-content"'),
      "route must import the canonical content-hash builder used by the snapshot + gate",
    );
    assert.match(
      src,
      /const contentHash = computeAnalysisContentHash\(/,
      "route must derive contentHash from computeAnalysisContentHash (canonical Scheme-A hash)",
    );
  });
});

describe("release snapshot + generation gate compare against analysisInputHash (canonical Scheme-A)", () => {
  it("release snapshot reads analysisInputHash and compares to the canonical current hash", () => {
    const snap = readFileSync(resolve(process.cwd(), "lib/engine/tender-release-snapshot.ts"), "utf8");
    assert.ok(snap.includes("analysisInputHash: true"), "snapshot must select analysisInputHash");
    assert.ok(snap.includes("contentHashMatch"), "snapshot must compute contentHashMatch");
    assert.ok(
      snap.includes('from "./tender-analysis-content"') || snap.includes("tender-analysis-content"),
      "snapshot must use the canonical Scheme-A hash builder",
    );
  });

  it("generation gate reads analysisInputHash and compares to the canonical current hash", () => {
    const gate = readFileSync(resolve(process.cwd(), "lib/engine/generation-readiness-gate.ts"), "utf8");
    assert.ok(gate.includes("analysisInputHash"), "gate must read analysisInputHash");
    assert.ok(gate.includes("computeAnalysisContentHash"), "gate must use the canonical Scheme-A hash builder");
  });
});
