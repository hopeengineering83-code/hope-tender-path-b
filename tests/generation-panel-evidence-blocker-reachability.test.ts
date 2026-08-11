// Contract — every evidence blocker the release panel classifies must be
// reachable from a source the panel actually reads.
//
// EVIDENCE_BLOCKER_CODES is the set that flips PROCESSING_AUTOMATICALLY to
// GENUINE_SOURCE_BLOCKED. Listing a code there does nothing unless some
// module the panel collects from emits it. MANDATORY_NO_FULL_SUBSTANTIAL_
// COVERAGE sat in that set for as long as the set existed while being emitted
// only by canonical-workflow-decision.ts, which the panel did not read — so
// the panel told the owner the workflow was "running ... server-side" while
// the header said source evidence was required.
//
// These assertions are static and need no database, so the reachability gap
// is caught on every run rather than only under RUN_DB_INTEGRATION.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const panelSource = read("components/generation-action-panel.tsx");

// The blocker-producing modules the panel collects from, and the collection
// expression in the panel that proves it reads each one.
const PANEL_SOURCES: Array<{ module: string; collectedBy: string }> = [
  { module: "lib/tender-generation-readiness.ts", collectedBy: "readiness?.blockers" },
  { module: "lib/tender-generation-readiness.ts", collectedBy: "readiness?.fullProposalBlockers" },
  { module: "lib/canonical-tender-readiness.ts", collectedBy: "canonicalReadiness?.blockers" },
  { module: "lib/canonical-release-decision.ts", collectedBy: "releaseDecision?.blockerCodes" },
  { module: "lib/engine/canonical-workflow-decision.ts", collectedBy: "workflowDecision?.blockerCodes" },
];

function evidenceBlockerCodes(): string[] {
  const block = panelSource.match(/const EVIDENCE_BLOCKER_CODES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "EVIDENCE_BLOCKER_CODES must remain a literal set in the panel");
  return [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
}

describe("generation panel evidence blockers are reachable", () => {
  it("the panel collects from every listed producer module", () => {
    for (const source of PANEL_SOURCES) {
      assert.ok(
        panelSource.includes(source.collectedBy),
        `collectedBlockerCodes must read ${source.collectedBy} (${source.module})`,
      );
    }
  });

  it("every evidence blocker code is emitted by a producer the panel actually reads", () => {
    // Deliberately derived from the panel's own collection expressions rather
    // than from the PANEL_SOURCES list: a producer the panel stopped reading
    // must stop counting towards reachability, which is exactly the failure
    // that hid the coverage blocker.
    const producers = [...new Set(
      PANEL_SOURCES
        .filter((source) => panelSource.includes(source.collectedBy))
        .map((source) => source.module),
    )].map((module) => ({ module, source: read(module) }));

    const unreachable: string[] = [];
    for (const code of evidenceBlockerCodes()) {
      const emitted = producers.some((producer) => producer.source.includes(`"${code}"`));
      if (!emitted) unreachable.push(code);
    }
    assert.deepEqual(
      unreachable,
      [],
      "these codes can never reach the panel, so they can never flip the status",
    );
  });

  it("the workflow decision can only contribute the mandatory-coverage blocker", () => {
    // Bounds the blast radius of reading the canonical decision: of every
    // stage it can block on, only the coverage gate is an evidence blocker.
    // If a future stage joins EVIDENCE_BLOCKER_CODES, that is a deliberate
    // decision and this assertion must be updated with it.
    const workflowSource = read("lib/engine/canonical-workflow-decision.ts");
    const priorityBlock = workflowSource.match(
      /export type WorkflowBlockerPriority =([\s\S]*?);/,
    );
    assert.ok(priorityBlock, "WorkflowBlockerPriority must remain a literal union");
    const stages = [...priorityBlock[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
    assert.ok(stages.length > 10, "expected the full workflow priority union");

    const evidence = new Set(evidenceBlockerCodes());
    assert.deepEqual(
      stages.filter((stage) => evidence.has(stage)),
      ["MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"],
    );
  });

  it("keeps the mandatory-coverage gate itself intact", () => {
    // The gate is genuine — Bid Strategy independently reports the same
    // capability gap. This test exists so a future "fix" for the
    // contradiction cannot resolve it by relaxing the gate instead.
    const workflowSource = read("lib/engine/canonical-workflow-decision.ts");

    // This assertion used to pin the literal comparison
    // `input.mandatoryFullOrSubstantialCoverageCount < input.mandatoryRequirementCount`.
    // The comparison now allows exactly one exemption — mandatory requirements
    // whose outstanding evidence is a file this workflow itself generates —
    // because without it the tender was unsatisfiable: a submission requirement
    // is answered by a generated document, and this gate was refusing to let
    // generation start until that document existed.
    //
    // The intent of the test is unchanged and is asserted more strictly below:
    // the gate still exists, still fires on genuinely unsupported requirements,
    // is still unbypassable by a confirmation click, and the one exemption is
    // counted from the database rather than assumed. Behavioural proof of all
    // four lives in tests/planned-output-generation-deadlock.test.ts.
    assert.match(
      workflowSource,
      /blockerCodes\.push\("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"\);/,
      "the gate must still exist",
    );
    assert.match(workflowSource, /no confirmation click can bypass this gate/);

    // The exemption may only ever be the planned-output count. If a future
    // change widens what is subtracted from the coverage requirement, this
    // fails and the author has to justify it here.
    assert.match(
      workflowSource,
      /const mandatoryCoveredForGeneration =\s*\n?\s*input\.mandatoryFullOrSubstantialCoverageCount \+ \(input\.mandatoryAwaitingPlannedOutputCount \?\? 0\);/,
      "the only relaxation permitted is requirements awaiting a file this workflow generates",
    );

    // Fail closed when the count is absent: an unsupplied exemption must mean
    // "nothing is exempt", never "exempt everything".
    assert.match(
      workflowSource,
      /mandatoryAwaitingPlannedOutputCount \?\? 0/,
      "an absent exemption count must default to zero",
    );

    // And it must be measured, not asserted: the count comes from requirements
    // that actually carry a planned-artifact row and are not otherwise covered.
    assert.match(
      workflowSource,
      /evidenceType: "AUTO_PLANNED_ARTIFACT"/,
      "the exemption must be derived from real compliance rows",
    );
    assert.match(
      workflowSource,
      /NOT: \{ complianceMatrixRows: \{ some: \{ supportLevel: \{ in: \["FULL", "SUBSTANTIAL"\] \} \} \} \}/,
      "a requirement already covered by real evidence must not also be counted as exempt",
    );
  });

  it("only a genuinely running job may keep the 'processing automatically' claim", () => {
    // Asserted as the invariant rather than one literal expression: any
    // reclassification must be reachable ONLY from PROCESSING_AUTOMATICALLY
    // and ONLY when no downstream job is queued, so a real running worker can
    // never be overridden into a blocked state.
    assert.match(
      panelSource,
      /if \(status !== "PROCESSING_AUTOMATICALLY" \|\| activeDownstreamWork\) return status;/,
      "the status guard must short-circuit before any reclassification",
    );
    assert.match(panelSource, /if \(evidenceBlocked\) return "GENUINE_SOURCE_BLOCKED";/);
    assert.match(panelSource, /if \(requiresManualAction\(workflowDecision\)\) return "MANUAL_ACTION_REQUIRED";/);
    // And "queued downstream work" must keep meaning a real job row.
    assert.match(panelSource, /jobType: \{ in: \["ENGINE_RUN", "PROPOSAL_GENERATION", "AUTO_FINALIZE"\] \}/);
    assert.match(panelSource, /status: \{ in: \["QUEUED", "RUNNING"\] \}/);
  });

  it("a manual gate can never be presented as automatic server-side processing", () => {
    // The panel must treat only the server-owned actions as automatic. If a
    // future stage is added to this set, that is a deliberate claim that a
    // worker owns it end to end.
    const automatic = panelSource.match(/const AUTOMATIC_NEXT_ACTIONS = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(automatic, "AUTOMATIC_NEXT_ACTIONS must remain a literal set");
    const actions = [...automatic[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(actions, ["AUTOMATIC_PROCESSING", "EXPORT_READY"]);

    // AI Analyze and Run Engine are deliberate manual gates and must not be
    // in it, or the false "processing continues server-side" claim returns.
    for (const manual of ["RUN_AI_ANALYZE", "RESUME_AI_ANALYZE", "RUN_ENGINE"]) {
      assert.ok(!actions.includes(manual), `${manual} is a manual gate`);
    }
  });

  it("the panel and the header read the same presented decision", () => {
    // Both must apply presentTwoActionWorkflowDecision, or they can word the
    // same stop differently again.
    const route = read("app/api/tenders/[id]/workflow-center/route.ts");
    assert.match(route, /presentTwoActionWorkflowDecision\(/);
    assert.match(panelSource, /presentTwoActionWorkflowDecision\(raw\)/);
    assert.match(panelSource, /nextRequiredActionLabel: decision\.nextRequiredActionLabel/);
    assert.match(panelSource, /nextRequiredActionReason: decision\.nextRequiredActionReason/);
  });
});
