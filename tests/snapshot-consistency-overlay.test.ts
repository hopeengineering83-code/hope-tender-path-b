/**
 * Guardrail for the additive "honest UI" snapshot-consistency overlay.
 *
 * These are source-level contracts (no DB / no render needed). They lock in
 * that the overlay:
 *   - reads the SAME authoritative snapshot endpoint the metadata panels use,
 *   - derives its verdict from the snapshot's eligibility fields + revision,
 *   - is fail-safe (renders nothing when the snapshot is unavailable),
 *   - is mounted additively in the readiness panels that independently fetch
 *     their own readiness (the real contradiction sources),
 * and crucially that the overlay NEVER becomes a replacement for those panels'
 * existing logic (it must not delete their own readiness fetches).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("snapshot-consistency overlay (additive honest-UI)", () => {
  const badge = read("components/snapshot-consistency-badge.tsx");

  it("reads the authoritative workflow-center snapshot endpoint", () => {
    assert.ok(
      badge.includes("/workflow-center"),
      "overlay must read the same authoritative snapshot endpoint the metadata panels use",
    );
  });

  it("derives its verdict from the snapshot eligibility fields + revision", () => {
    assert.ok(badge.includes("generationEligible"), "must reference snapshot.generationEligible");
    assert.ok(badge.includes("exportEligible"), "must reference snapshot.exportEligible");
    assert.ok(badge.includes("finalZipEligible"), "must reference snapshot.finalZipEligible");
    assert.ok(badge.includes("snapshotRevision"), "must surface the snapshotRevision token");
  });

  it("is fail-safe: renders nothing when the snapshot is unavailable", () => {
    assert.ok(
      badge.includes("if (!snapshot) return null"),
      "overlay must render nothing (never block the host panel) when the snapshot is unavailable",
    );
  });

  it("warns only when the host's local verdict disagrees with the snapshot", () => {
    assert.ok(
      badge.includes("localEligible !== undefined && localEligible !== eligible"),
      "mismatch warning must trigger only when a local verdict is supplied AND it differs",
    );
  });

  it("is mounted across all readiness/verdict panels for full coverage", () => {
    for (const panel of [
      "components/final-submission-control-center.tsx",
      "components/canonical-readiness-score-widget.tsx",
      "components/bid-control-verdict-panel.tsx",
      "components/tender-health-score-panel.tsx",
      "app/dashboard/tenders/[id]/executive-snapshot.tsx",
      // Recovery Command Center and Workflow Control Center each compute
      // their verdict via their own separate orchestrator (respectively
      // tender-lifecycle-orchestrator.ts's computeTenderLifecycle, and
      // getCanonicalTenderWorkflowDecision) rather than the shared release
      // snapshot the panels above compare against — without the overlay a
      // real disagreement between either of them and the snapshot would be
      // completely invisible in the UI.
      "components/tender-recovery-command-center.tsx",
      "components/tender-workflow-action-center.tsx",
    ]) {
      const src = read(panel);
      assert.ok(
        src.includes("SnapshotConsistencyBadge"),
        `${panel} must mount the additive SnapshotConsistencyBadge overlay`,
      );
    }
  });

  it("recovery-command-center compares its own final-submission verdict to the snapshot", () => {
    const recovery = read("components/tender-recovery-command-center.tsx");
    assert.ok(
      recovery.includes('verdict="finalZip"') && recovery.includes('localEligible={data.finalSubmissionStatus === "READY"}'),
      "tender-recovery-command-center must pass its own finalSubmissionStatus-derived verdict so a disagreement with the snapshot is surfaced",
    );
  });

  it("workflow-control-center compares its own Export ZIP stage status to the matching snapshot field (exportEligible, not the stricter finalZipEligible)", () => {
    const workflow = read("components/tender-workflow-action-center.tsx");
    assert.ok(
      workflow.includes('verdict="export"') && workflow.includes('stages.find((s) => s.stage === 10)?.status === "READY"'),
      "tender-workflow-action-center must pass its own Export ZIP stage verdict so a disagreement with the snapshot is surfaced",
    );
    // The Export ZIP stage's own status (workflow-center/route.ts) is
    // computed from snapshot.exportEligible, not snapshot.finalZipEligible.
    // finalZipBlockers is a strict superset of exportBlockers
    // (release-snapshot-eligibility.ts), so exportEligible=true while
    // finalZipEligible=false is a real, reachable state — comparing against
    // "finalZip" here would fire false-positive disagreement warnings.
    assert.doesNotMatch(
      workflow,
      /verdict="finalZip"/,
      "must not compare the Export ZIP stage (driven by exportEligible) against the stricter finalZipEligible tier",
    );
  });

  it("bid-control-verdict-panel compares its strict full-proposal verdict to the snapshot", () => {
    const bid = read("components/bid-control-verdict-panel.tsx");
    assert.ok(
      bid.includes("localEligible={fullProposalReady}"),
      "bid-control-verdict-panel must pass its strict full-proposal verdict so a disagreement is surfaced",
    );
  });

  it("does NOT remove the panels' own readiness fetches (overlay is additive, not a replacement)", () => {
    const finalCenter = read("components/final-submission-control-center.tsx");
    assert.ok(
      finalCenter.includes("/export-readiness"),
      "final-submission-control-center must KEEP its own export-readiness fetch (overlay is additive)",
    );
    const scoreWidget = read("components/canonical-readiness-score-widget.tsx");
    assert.ok(
      scoreWidget.includes("/readiness-score"),
      "canonical-readiness-score-widget must KEEP its own readiness-score fetch (overlay is additive)",
    );
  });

  it("final-submission-control-center compares its own export verdict to the snapshot", () => {
    const finalCenter = read("components/final-submission-control-center.tsx");
    assert.ok(
      finalCenter.includes("localEligible={exportReadiness"),
      "final-submission-control-center must pass its local export verdict so a disagreement is surfaced",
    );
  });
});
