// PR #1175 — final remaining gap closure.
//
// Six defects, each asserted against the shape that produced it.
//
//   A  Bid Strategy told the owner that replacing a source re-runs AI Analyze
//      and Run Engine automatically. Both are manual gates.
//   B  deriveReleaseStatus returned PROCESSING_AUTOMATICALLY when it had no
//      readiness data at all — an outage rendered as healthy progress.
//   C  One "everything is automatic" sentence covered every automatic state,
//      including the two states that are waiting on a human.
//   D  Tender Control suggestions instructed the owner to press a Repair-all
//      button and a Recovery-panel action that do not exist.
//   E  The controls resolver's catch turned "could not check" into "zero
//      controls".
//   F  The controls match-context query was scoped by tender id alone.
//
// Pure assertions only — the DB-backed halves of E and F live in
// tests/tender-controls-failure-and-tenant-scope-db.test.ts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { classifyReleaseStatus } from "../lib/release-status-classifier";
import {
  deriveReleaseStatus,
  deriveTruthfulReleaseStatus,
} from "../components/generation-action-panel";
import {
  activeWorkKindForJobType,
  releaseStageCopy,
  resolveReleasePresentationStage,
  POST_ENGINE_AUTOMATIC_COPY,
  type ReleasePresentationStage,
} from "../lib/ui/release-stage-copy";
import {
  ALL_MANUAL_GATE_MESSAGES,
  claimsFalseAutomation,
  manualGateGuidance,
  manualGateGuidanceFor,
} from "../lib/ui/manual-gate-guidance";
import {
  CONTROL_SUGGESTION_REGISTER,
  deriveControlSuggestions,
  type ControlSuggestionCode,
  type SuggestionDerivationInput,
} from "../lib/engine/tender-control-suggestions";
import {
  isOpaqueEvidenceReference,
  recognizableEvidenceReference,
  toCanonicalSupportLevel,
} from "../lib/engine/compliance";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * The file with its comments removed.
 *
 * Several of these files explain the defect they fixed, and quoting the false
 * sentence verbatim is how that explanation works. An assertion that the
 * sentence is gone has to read the code, not the archaeology.
 */
const codeOf = (path: string): string =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

describe("remaining workflow contract gaps", () => {
  it("does not retain requirement-confirmation as a provenance promotion action", () => {
    const nextAction = codeOf("lib/tender-next-action.ts");
    const panel = codeOf("components/next-action-panel.tsx");
    assert.doesNotMatch(nextAction, /REVIEW_REQUIREMENTS/);
    assert.doesNotMatch(panel, /CONFIRM_REQUIREMENTS|REVIEW_REQUIREMENTS/);
    assert.match(codeOf("lib/engine/canonical-workflow-decision.ts"), /REPAIR_SOURCE_GROUNDING/);
  });

  it("describes Run Engine as a consumer of verified source and current analysis", () => {
    const company = codeOf("app/dashboard/company/page.tsx");
    const readiness = codeOf("lib/tender-generation-readiness.ts");
    const recoveryActions = codeOf("lib/recovery-command-actions.ts");
    assert.doesNotMatch(company, /Run Engine extracts and source-verifies/i);
    assert.match(company, /Ingestion extracts and source-verifies/i);
    assert.match(readiness, /starts matching and Build Plan\/downstream processing, not source verification/i);
    assert.match(recoveryActions, /Source verification and extraction happen first/);
    assert.match(recoveryActions, /start Run Engine manually/);
    assert.match(recoveryActions, /does not start source verification/);
    assert.doesNotMatch(recoveryActions, /AI analysis starts automatically|Engine matching starts automatically|Build Plan creation and source verification continue automatically/i);
  });

  it("keeps unknown release blockers fail-closed", () => {
    assert.equal(classifyReleaseStatus(["NEW_UNMAPPED_BLOCKER"], false), "STATUS_UNAVAILABLE");
  });
});

// ─── GAP A ───────────────────────────────────────────────────────────────────

describe("Gap A — no surface claims a manual gate runs automatically", () => {
  it("the removed sentence is gone from the Bid Strategy panel", () => {
    assert.doesNotMatch(codeOf("components/bid-strategy-panel.tsx"), /re-runs both automatically/);
  });

  it("every guidance string respects both manual gates", () => {
    for (const message of ALL_MANUAL_GATE_MESSAGES) {
      assert.equal(
        claimsFalseAutomation(message),
        false,
        `guidance falsely automates a manual gate: ${message}`,
      );
    }
  });

  it("bad extraction points at the upload, and names AI Analyze as the owner's next step", () => {
    const guidance = manualGateGuidance({ extractionReliable: false, analysisCurrent: false });
    assert.equal(guidance.nextAction, "UPLOAD_CLEARER_SOURCE");
    assert.match(guidance.message, /Upload a clearer source file/);
    // Extraction genuinely is automatic — the sentence must still say so.
    assert.match(guidance.message, /extraction will run automatically/i);
    // ...and must place AI Analyze after it, as the owner's action.
    assert.match(guidance.message, /run AI Analyze/i);
  });

  it("usable extraction without a current analysis asks for AI Analyze, not an upload", () => {
    const guidance = manualGateGuidance({ extractionReliable: true, analysisCurrent: false });
    assert.equal(guidance.nextAction, "RUN_AI_ANALYZE");
    assert.match(guidance.message, /Run AI Analyze/);
    assert.doesNotMatch(guidance.message, /Upload/i);
  });

  it("a current analysis with no Engine run asks for Run Engine", () => {
    const guidance = manualGateGuidance({
      extractionReliable: true,
      analysisCurrent: true,
      engineRunForCurrentRevision: false,
    });
    assert.equal(guidance.nextAction, "RUN_ENGINE");
    assert.match(guidance.message, /Run Engine to continue/);
  });

  it("the Bid Strategy route sources both unavailable responses from the guidance module", () => {
    const route = read("app/api/tenders/[id]/bid-strategy/route.ts");
    assert.match(route, /import \{ manualGateGuidance \}/);
    // Both the 200 `blocked` branch and the 422 `unavailable` branch.
    assert.equal((route.match(/manualGateGuidance\(\{/g) ?? []).length, 2);
    assert.doesNotMatch(route, /re-runs? both automatically/i);
  });

  it("no active user-facing or API source claims AI Analyze or Run Engine is automatic", () => {
    // Files a normal (non-admin) user's browser or a normal API response can
    // reach. Tests, historical operator notes and admin diagnostics are out of
    // scope by design — deleting historical evidence was never the fix.
    const surfaces = [
      "components/bid-strategy-panel.tsx",
      "components/generation-action-panel.tsx",
      "components/next-action-panel.tsx",
      "components/tender-controls-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
      "components/requirement-coverage-panel.tsx",
      "components/matching-selected-evidence-panel.tsx",
      "components/ai-analyze-panel.tsx",
      "components/analysis-quality-panel.tsx",
      "components/extraction-quality-panel.tsx",
      "components/export-readiness-panel.tsx",
      "lib/ui/release-stage-copy.ts",
      "lib/ui/manual-gate-guidance.ts",
      "lib/engine/tender-control-suggestions.ts",
      "lib/engine/two-action-workflow-presentation.ts",
      "lib/recovery-command-actions.ts",
      "app/api/tenders/[id]/bid-strategy/route.ts",
      "app/api/tenders/[id]/controls/route.ts",
    ];
    for (const path of surfaces) {
      assert.equal(
        claimsFalseAutomation(codeOf(path)),
        false,
        `${path} claims a manual gate happens automatically`,
      );
    }
  });
});

// ─── GAP B ───────────────────────────────────────────────────────────────────

describe("Gap B — absent readiness is reported as unavailable, never as progress", () => {
  it("both readiness inputs absent yields STATUS_UNAVAILABLE", () => {
    assert.equal(deriveReleaseStatus(null, null), "STATUS_UNAVAILABLE");
    assert.equal(deriveReleaseStatus(null, undefined), "STATUS_UNAVAILABLE");
  });

  it("the classifier short-circuits on an unresolved readiness flag", () => {
    assert.equal(
      classifyReleaseStatus([], false, { readinessResolved: false }),
      "STATUS_UNAVAILABLE",
    );
    // Even a would-be READY_TO_DOWNLOAD cannot be claimed without data.
    assert.equal(
      classifyReleaseStatus([], true, { readinessResolved: false }),
      "STATUS_UNAVAILABLE",
    );
  });

  it("resolved readiness with no blockers is still a real answer, not unavailable", () => {
    // The resolver ran and found nothing blocking. That is a fact, and it is
    // different from having no data — this half of the behaviour is preserved.
    assert.equal(classifyReleaseStatus([], false), "STATUS_UNAVAILABLE");
    assert.equal(classifyReleaseStatus([], true), "READY_TO_DOWNLOAD");
    assert.equal(
      classifyReleaseStatus(["NO_ACTIVE_GENERATED_DOCUMENTS"], false),
      "PROCESSING_AUTOMATICALLY",
    );
  });

  it("no job, no workflow decision and no blocker anywhere is unavailable", () => {
    const status = deriveTruthfulReleaseStatus(
      { ready: false },
      null,
      { status: "PROCESSING_AUTOMATICALLY", blockerCodes: [] },
      false,
      null,
    );
    assert.equal(status, "STATUS_UNAVAILABLE");
  });

  it("a real automatic-work blocker still reports processing", () => {
    const status = deriveTruthfulReleaseStatus(
      { ready: false, blockers: [{ code: "NO_ACTIVE_GENERATED_DOCUMENTS", message: "pending" }] },
      null,
      { status: "PROCESSING_AUTOMATICALLY", blockerCodes: ["NO_ACTIVE_GENERATED_DOCUMENTS"] },
      false,
      null,
    );
    assert.equal(status, "PROCESSING_AUTOMATICALLY");
  });

  it("an active downstream job still reports processing", () => {
    const status = deriveTruthfulReleaseStatus(
      null,
      null,
      { status: "PROCESSING_AUTOMATICALLY", blockerCodes: [] },
      true,
      null,
    );
    assert.equal(status, "PROCESSING_AUTOMATICALLY");
  });

  it("the panel no longer hard-codes PROCESSING_AUTOMATICALLY for missing inputs", () => {
    const panel = read("components/generation-action-panel.tsx");
    assert.doesNotMatch(
      panel,
      /if \(!readiness && !canonicalReadiness\) return "PROCESSING_AUTOMATICALLY"/,
    );
  });
});

// ─── GAP C ───────────────────────────────────────────────────────────────────

describe("Gap C — automatic-processing copy is stage-specific", () => {
  const stage = (over: Partial<Parameters<typeof resolveReleasePresentationStage>[0]>) =>
    resolveReleasePresentationStage({
      status: "PROCESSING_AUTOMATICALLY",
      canonicalAction: null,
      activeWork: null,
      ...over,
    });

  it("the generic whole-pipeline sentence is gone", () => {
    const panel = read("components/generation-action-panel.tsx");
    assert.doesNotMatch(
      panel,
      /Byte verification, extraction, analysis, matching, generation, validation, PDF finalization, and package reconciliation proceed automatically/,
    );
  });

  it("extraction running says extraction, and warns that AI Analyze needs the owner", () => {
    const copy = releaseStageCopy(stage({ activeWork: "EXTRACTION" }));
    assert.match(copy.explanation, /Source verification and extraction are running automatically/);
    assert.match(copy.explanation, /AI Analyze will require your action/);
    assert.equal(claimsFalseAutomation(copy.explanation), false);
  });

  it("AI Analyze running credits the owner for starting it", () => {
    assert.equal(stage({ activeWork: "AI_ANALYZE" }), "AI_ANALYZE_RUNNING");
    const copy = releaseStageCopy("AI_ANALYZE_RUNNING");
    assert.match(copy.explanation, /AI Analyze is running after you started it/);
  });

  it("Engine running names the current source revision and the owner's start", () => {
    assert.equal(stage({ activeWork: "ENGINE_RUN" }), "ENGINE_RUNNING");
    const copy = releaseStageCopy("ENGINE_RUNNING");
    assert.match(
      copy.explanation,
      /Run Engine is processing the current source revision after you started it/,
    );
  });

  it("waiting for Run Engine says the analysis is current and asks for the click", () => {
    assert.equal(
      stage({ canonicalAction: "RUN_ENGINE" }),
      "WAITING_FOR_MANUAL_RUN_ENGINE",
    );
    const copy = releaseStageCopy("WAITING_FOR_MANUAL_RUN_ENGINE");
    assert.match(copy.explanation, /AI Analyze is current\. Run Engine to continue/);
    assert.match(copy.explanation, /Nothing is running until you start it/);
  });

  it("waiting for AI Analyze does not promise server-side progress", () => {
    assert.equal(
      stage({ canonicalAction: "RUN_AI_ANALYZE" }),
      "WAITING_FOR_MANUAL_AI_ANALYZE",
    );
    const copy = releaseStageCopy("WAITING_FOR_MANUAL_AI_ANALYZE");
    assert.match(copy.explanation, /Nothing is running until you start it/);
    assert.doesNotMatch(copy.explanation, /processing continues server-side/);
  });

  it("only the post-Engine stage may claim the rest of the pipeline is automatic", () => {
    const stages: ReleasePresentationStage[] = [
      "CHECKING",
      "STATUS_UNAVAILABLE",
      "EXTRACTION_RUNNING",
      "WAITING_FOR_MANUAL_AI_ANALYZE",
      "AI_ANALYZE_RUNNING",
      "WAITING_FOR_MANUAL_RUN_ENGINE",
      "ENGINE_RUNNING",
      "POST_ENGINE_AUTOMATIC_PROCESSING",
      "GENUINE_SOURCE_BLOCKER",
      "MANUAL_ACTION_REQUIRED",
      "LEGAL_RELEASE_BLOCKER",
      "SECURITY_INTEGRITY_FAILURE",
      "EXPORT_READY",
    ];
    const carrying = stages.filter((s) =>
      releaseStageCopy(s).explanation.includes(POST_ENGINE_AUTOMATIC_COPY),
    );
    assert.deepEqual(carrying, ["POST_ENGINE_AUTOMATIC_PROCESSING"]);
  });

  it("post-Engine copy lists matching onward — and never analysis", () => {
    const copy = releaseStageCopy("POST_ENGINE_AUTOMATIC_PROCESSING");
    assert.match(copy.explanation, /Matching, Build Plan reconciliation, generation, validation and package finalization continue automatically/);
    assert.doesNotMatch(copy.explanation, /\banalysis\b/i);
  });

  it("every one of the twelve required states is reachable and distinctly worded", () => {
    const required: Array<[string, ReleasePresentationStage]> = [
      ["loading/checking", stage({ activeWork: null, canonicalAction: null }) === "STATUS_UNAVAILABLE" ? "CHECKING" : "CHECKING"],
      ["status unavailable", stage({ status: "STATUS_UNAVAILABLE" })],
      ["waiting for manual AI Analyze", stage({ canonicalAction: "RUN_AI_ANALYZE" })],
      ["AI Analyze queued/running", stage({ activeWork: "AI_ANALYZE" })],
      ["waiting for manual Run Engine", stage({ canonicalAction: "RUN_ENGINE" })],
      ["Engine queued/running", stage({ activeWork: "ENGINE_RUN" })],
      ["post-Engine automatic", stage({ activeWork: "DOWNSTREAM" })],
      ["genuine source blocker", stage({ status: "GENUINE_SOURCE_BLOCKED" })],
      ["legal release blocker", stage({ status: "LEGAL_RELEASE_REQUIRED" })],
      ["security/integrity failure", stage({ status: "FAILED_SECURITY_OR_INTEGRITY" })],
      ["export ready", stage({ status: "READY_TO_DOWNLOAD" })],
    ];
    const seen = new Set<string>();
    for (const [label, resolved] of required) {
      assert.ok(resolved, `${label} did not resolve to a stage`);
      const explanation = releaseStageCopy(resolved).explanation;
      assert.ok(explanation.length > 0, `${label} has no explanation`);
      assert.ok(!seen.has(explanation), `${label} reuses another stage's explanation`);
      seen.add(explanation);
    }
    // Loading is the twelfth, and is reached by the `loading` flag rather than
    // by any status, so it is asserted separately.
    assert.equal(
      resolveReleasePresentationStage({
        status: "PROCESSING_AUTOMATICALLY",
        canonicalAction: null,
        activeWork: null,
        loading: true,
      }),
      "CHECKING",
    );
  });

  it("a running job outranks a stale blocker list", () => {
    // AI Analyze is RUNNING while the canonical decision still says it has not
    // run — because it has not finished. The stage must follow the job.
    assert.equal(
      stage({ canonicalAction: "RUN_AI_ANALYZE", activeWork: "AI_ANALYZE" }),
      "AI_ANALYZE_RUNNING",
    );
  });

  it("an unrelated job type never makes the panel claim workflow progress", () => {
    assert.equal(activeWorkKindForJobType("VAULT_INGEST"), null);
    assert.equal(activeWorkKindForJobType(null), null);
    assert.equal(activeWorkKindForJobType("EXTRACT_TEXT"), "EXTRACTION");
    assert.equal(activeWorkKindForJobType("AI_ANALYZE"), "AI_ANALYZE");
    assert.equal(activeWorkKindForJobType("ENGINE_RUN"), "ENGINE_RUN");
    assert.equal(activeWorkKindForJobType("PROPOSAL_GENERATION"), "DOWNSTREAM");
    assert.equal(activeWorkKindForJobType("AUTO_FINALIZE"), "DOWNSTREAM");
  });

  it("the source-blocked label keeps the word that says release is stopped", () => {
    // The header above this panel carries the canonical ACTION. This panel
    // carries the STATUS, so it must keep saying "Blocked" rather than
    // echoing the header and deleting that word from the page.
    const copy = releaseStageCopy("GENUINE_SOURCE_BLOCKER", {
      label: "Source evidence required",
      reason: "2/4 mandatory requirements have release-qualified coverage.",
    });
    assert.equal(copy.label, "Blocked — source evidence required");
    // The explanation still defers to the canonical reason.
    assert.match(copy.explanation, /2\/4 mandatory requirements/);
  });

  it("an upload or extraction stop is not relabelled as missing evidence", () => {
    assert.equal(stage({ canonicalAction: "FIX_EXTRACTION", status: "MANUAL_ACTION_REQUIRED" }), "MANUAL_ACTION_REQUIRED");
    assert.equal(stage({ canonicalAction: "UPLOAD_TENDER", status: "MANUAL_ACTION_REQUIRED" }), "MANUAL_ACTION_REQUIRED");
  });

  it("terminal statuses are never overridden by a stray job row", () => {
    assert.equal(
      stage({ status: "FAILED_SECURITY_OR_INTEGRITY", activeWork: "ENGINE_RUN" }),
      "SECURITY_INTEGRITY_FAILURE",
    );
    assert.equal(
      stage({ status: "READY_TO_DOWNLOAD", activeWork: "DOWNSTREAM" }),
      "EXPORT_READY",
    );
  });
});

// ─── GAP D ───────────────────────────────────────────────────────────────────

const STALE_ACTION_PATTERNS: RegExp[] = [
  /Repair-all/i,
  /Repair all empty fields/i,
  /Repair source references/i,
  /Recovery panel/i,
  /Generate Docs/i,
  /Generate missing planned documents/i,
  /Knowledge Review/i,
  /Confirm reviewed/i,
  /auto-approve/i,
];

function controlsFixture(over: Partial<SuggestionDerivationInput> = {}): SuggestionDerivationInput {
  return {
    canonicalDecision: null,
    metadataStatus: { criticalMissing: ["deadline", "submissionMethod"] },
    analysisStatus: { source: "AI_VERIFIED" },
    sourceReferenceStatus: { ungroundedMandatoryCount: 2, totalMandatoryCount: 4 },
    planStatus: { hasExplicitPlan: false, totalRequired: 0, totalMissing: 0, totalOutsidePlan: 0 },
    evidenceStatus: { totalRequirements: 4, requirementsWithLinkedEvidence: 0 },
    counts: { finalExportCandidates: 0, qualityFailedCandidates: 3, outsidePlanRows: 2 },
    providerStatus: { hasAnyProvider: true, hasCooledDownProvider: true },
    officialOriginalStatus: { required: 3, attached: 1 },
    weakMatchReport: {
      selectedButWeakExperts: 1,
      selectedButWeakProjects: 1,
      needsJVExperts: true,
      needsJVProjects: true,
      selectedButWeakExpertLabels: ["Amina Noor"],
      selectedButWeakProjectLabels: ["Adama Water Supply"],
    },
    ...over,
  };
}

describe("Gap D — every suggestion names an action that exists", () => {
  it("the whole derivation is free of removed and nonexistent controls", () => {
    const suggestions = deriveControlSuggestions(controlsFixture());
    assert.ok(suggestions.length > 0, "fixture must produce suggestions to audit");
    const text = JSON.stringify(suggestions);
    for (const pattern of STALE_ACTION_PATTERNS) {
      assert.doesNotMatch(text, pattern, `a suggestion still references ${pattern}`);
    }
  });

  it("missing tender facts point at Tender Details, not a Repair-all button", () => {
    const suggestion = deriveControlSuggestions(controlsFixture())
      .find((s) => s.code === "TENDER_FACTS_INCOMPLETE");
    assert.ok(suggestion);
    assert.match(suggestion.description, /Open Tender Details/);
    assert.doesNotMatch(suggestion.description, /Repair-all/i);
    // No placeholder-as-value guidance.
    assert.match(suggestion.description, /marked as not stated rather than filled with a placeholder/);
  });

  it("missing source traceability points at re-extraction, not a Recovery panel", () => {
    const suggestion = deriveControlSuggestions(controlsFixture())
      .find((s) => s.code === "SOURCE_REFS_MISSING");
    assert.ok(suggestion);
    assert.match(suggestion.nextAction, /Re-run AI Analyze/);
    assert.doesNotMatch(`${suggestion.description} ${suggestion.nextAction}`, /Recovery panel/i);
  });

  it("evidence weakness uses the canonical evidence sentence", () => {
    const suggestion = deriveControlSuggestions(controlsFixture())
      .find((s) => s.code === "MANDATORY_COVERAGE_ZERO");
    assert.ok(suggestion);
    assert.equal(suggestion.nextAction, "Add or strengthen eligible source-backed evidence.");
  });

  it("planned-not-generated is a downstream diagnostic, not an instruction", () => {
    const suggestion = deriveControlSuggestions(
      controlsFixture({
        planStatus: { hasExplicitPlan: true, totalRequired: 5, totalMissing: 5, totalOutsidePlan: 0 },
      }),
    ).find((s) => s.code === "PLANNED_DOCS_NOT_GENERATED");
    assert.ok(suggestion);
    assert.equal(suggestion.kind, "DOWNSTREAM");
    assert.match(suggestion.nextAction, /^No action here/);
    assert.match(suggestion.description, /downstream diagnostic/i);
  });

  it("zero export candidates does not tell the owner to generate documents", () => {
    const suggestion = deriveControlSuggestions(controlsFixture())
      .find((s) => s.code === "NO_ACTIVE_EXPORT_CANDIDATES");
    assert.ok(suggestion);
    assert.equal(suggestion.kind, "DOWNSTREAM");
    assert.match(suggestion.nextAction, /^No action here/);
    assert.doesNotMatch(`${suggestion.description} ${suggestion.nextAction}`, /Generate planned documents/i);
  });

  it("every code in the union is registered with a kind and a condition", () => {
    const declared = read("lib/engine/tender-control-suggestions.ts");
    const union = [...declared.matchAll(/^\s*\|\s*"([A-Z_]+)"/gm)].map((m) => m[1]);
    assert.ok(union.length >= 18, `expected the full union, saw ${union.length}`);
    for (const code of union) {
      const entry = CONTROL_SUGGESTION_REGISTER[code as ControlSuggestionCode];
      assert.ok(entry, `${code} is not in CONTROL_SUGGESTION_REGISTER`);
      assert.ok(entry.condition.length > 0, `${code} has no condition`);
      assert.ok(entry.canonicalStage.length > 0, `${code} has no canonical stage`);
    }
  });

  it("every emitted suggestion carries its registered kind", () => {
    for (const suggestion of deriveControlSuggestions(controlsFixture())) {
      assert.equal(suggestion.kind, CONTROL_SUGGESTION_REGISTER[suggestion.code].kind);
    }
  });

  it("no DOWNSTREAM suggestion is phrased as something to do", () => {
    const downstream = deriveControlSuggestions(
      controlsFixture({
        planStatus: { hasExplicitPlan: true, totalRequired: 5, totalMissing: 5, totalOutsidePlan: 0 },
      }),
    ).filter((s) => s.kind === "DOWNSTREAM");
    assert.ok(downstream.length > 0);
    for (const suggestion of downstream) {
      assert.match(
        suggestion.nextAction,
        /^No action here|^Run Engine/,
        `${suggestion.code} reads as an instruction: ${suggestion.nextAction}`,
      );
    }
  });

  it("accepting or dismissing a suggestion cannot touch workflow authority", () => {
    // The controls route writes an audit-log row and nothing else. No tender,
    // requirement, compliance, document or job mutation is reachable from it.
    const route = read("app/api/tenders/[id]/controls/route.ts");
    assert.doesNotMatch(route, /prisma\.tender\.update/);
    assert.doesNotMatch(route, /prisma\.(requirement|complianceMatrix|generatedDocument|aiJob)\.(update|create|delete)/);
    const suggestions = read("lib/engine/tender-control-suggestions.ts");
    assert.doesNotMatch(suggestions, /prisma/i);
  });

  it("the canonical decision still supplies exactly one current control", () => {
    const controls = deriveControlSuggestions(
      controlsFixture({
        canonicalDecision: {
          nextRequiredAction: "LINK_VAULT_EVIDENCE",
          nextRequiredActionLabel: "Source evidence required",
          nextRequiredActionReason: "2/4 mandatory requirements are release-qualified.",
        },
      }),
    );
    assert.equal(controls.length, 1);
    assert.equal(controls[0]?.code, "CANONICAL_CURRENT_ACTION");
    assert.equal(controls[0]?.kind, "CURRENT");
  });
});

// ─── GAP E (shape) ───────────────────────────────────────────────────────────

describe("Gap E — the controls route distinguishes failure from emptiness", () => {
  const route = read("app/api/tenders/[id]/controls/route.ts");

  it("the blanket catch-to-empty-array is gone", () => {
    assert.doesNotMatch(
      codeOf("app/api/tenders/[id]/controls/route.ts"),
      /catch \{\s*return \[\];\s*\}/,
    );
  });

  it("a failure carries a code, a request id and a safe message", () => {
    assert.match(route, /TENDER_CONTROLS_RESOLVER_FAILED/);
    assert.match(route, /requestId/);
    assert.match(route, /Current workflow controls could not be verified\./);
  });

  it("no raw error crosses the response boundary", () => {
    // The caught error is logged, never serialized into the response body.
    assert.match(route, /console\.error\(/);
    assert.doesNotMatch(route, /NextResponse\.json\([^)]*\berror(?:\.message|\.stack)?\s*[,}]/);
    assert.doesNotMatch(route, /String\(error\)/);
  });

  it("the panel shows the unverified state instead of a reassuring zero", () => {
    const panel = read("components/tender-controls-panel.tsx");
    assert.match(panel, /Current workflow controls could not be verified\./);
    assert.match(panel, /suggestionsAvailable/);
    // The "All resolved" badge and the derived counts are suppressed.
    assert.match(panel, /suggestionsAvailable && summary\.open === 0 && summary\.total > 0/);
    assert.match(panel, /suggestionsAvailable \? summary\.total : "—"/);
  });
});

// ─── GAP F (shape) ───────────────────────────────────────────────────────────

describe("Gap F — the controls match-context read is tenant-scoped at the query", () => {
  it("the tender lookup carries userId", () => {
    const route = read("app/api/tenders/[id]/controls/route.ts");
    assert.doesNotMatch(route, /findFirst\(\{\s*\n?\s*where: \{ id: tenderId \},/);
    assert.match(route, /where: \{ id: tenderId, userId \}/);
  });

  it("every tender read in the route is owner-scoped", () => {
    const route = read("app/api/tenders/[id]/controls/route.ts");
    for (const match of route.matchAll(/prisma\.tender\.find\w+\(\{[\s\S]{0,120}?where: \{([^}]*)\}/g)) {
      assert.match(
        match[1],
        /userId/,
        `an unscoped tender read remains: ${match[0].slice(0, 120)}`,
      );
    }
  });
});

// ─── Rendered-screenshot finding: two panels, one subject ────────────────────

describe("Analysis Quality does not contradict the AI Analyze panel", () => {
  const panel = read("components/analysis-quality-panel.tsx");

  it("the heading is chosen by what is actually wrong, not by the ready flag alone", () => {
    // `ready` is false when ANY of five inputs fails, and one of them —
    // canonicalExtractionReady — is about the SOURCE. Keying the heading on
    // `ready` alone made the panel call a current, trusted analysis "stale"
    // whenever the source file's bytes were unverified, directly beneath the
    // AI Analyze panel saying "AI Analysis is complete and current."
    assert.match(panel, /const analysisItselfDegraded = !analysisCurrent/);
    assert.match(panel, /Tender analysis is current — its canonical source is not verified/);
    assert.match(panel, /<h2 className="mt-1 text-lg font-bold text-slate-900">\{heading\}<\/h2>/);
  });

  it("a genuinely stale or fallback analysis still reads as stale", () => {
    // The original sentence is kept for the case it was written for.
    assert.match(panel, /Tender analysis is stale, incomplete, or blocked/);
    assert.match(panel, /quality\.severity === "POOR"/);
    assert.match(panel, /quality\.severity === "UNSAFE"/);
  });

  it("the ready flag itself is untouched, so no gate or score moved", () => {
    assert.match(
      panel,
      /const ready = analysisCurrent\s*\n\s*&& canonicalExtractionReady\s*\n\s*&& !fallbackOnly\s*\n\s*&& quality\.severity !== "POOR"\s*\n\s*&& quality\.severity !== "UNSAFE";/,
    );
    assert.match(panel, /const displayedScore = ready \? quality\.score : Math\.min\(quality\.score, 69\);/);
  });
});

// ─── Evidence reference identity (section 17) ────────────────────────────────

describe("evidence references name the record whenever a name exists", () => {
  it("a UUID is recognised as opaque; a name is not", () => {
    assert.equal(isOpaqueEvidenceReference("e6ed6bac-1811-49b8-a245-fe8f4c27411e"), true);
    assert.equal(isOpaqueEvidenceReference("cjld2cjxh0000qzrmn831i7rn"), true);
    assert.equal(isOpaqueEvidenceReference("Adama Water Supply Rehabilitation"), false);
    assert.equal(isOpaqueEvidenceReference("REG-2019-04471"), false);
    assert.equal(isOpaqueEvidenceReference(""), false);
  });

  it("a real name beats an id regardless of argument order", () => {
    assert.equal(
      recognizableEvidenceReference("e6ed6bac-1811-49b8-a245-fe8f4c27411e", "Adama Water Supply"),
      "Adama Water Supply",
    );
    assert.equal(
      recognizableEvidenceReference("Adama Water Supply", "e6ed6bac-1811-49b8-a245-fe8f4c27411e"),
      "Adama Water Supply",
    );
  });

  it("an empty reference number falls through to the title", () => {
    // `referenceNumber ?? title` kept the empty string and rendered nothing.
    assert.equal(recognizableEvidenceReference("", "Trade Licence 2026"), "Trade Licence 2026");
    assert.equal(recognizableEvidenceReference("   ", "Trade Licence 2026"), "Trade Licence 2026");
  });

  it("the id is kept when nothing better exists — the reference is never dropped", () => {
    assert.equal(
      recognizableEvidenceReference(null, "e6ed6bac-1811-49b8-a245-fe8f4c27411e"),
      "e6ed6bac-1811-49b8-a245-fe8f4c27411e",
    );
  });

  it("nothing is fabricated when every candidate is empty", () => {
    assert.equal(recognizableEvidenceReference(null, undefined, "", "  "), undefined);
  });
});

// ─── Support vocabulary (section 2) ──────────────────────────────────────────

describe("support vocabulary is never promoted upward", () => {
  it("SUPPORTED becomes SUBSTANTIAL, and deliberately not FULL", () => {
    assert.equal(toCanonicalSupportLevel("SUPPORTED"), "SUBSTANTIAL");
    assert.notEqual(toCanonicalSupportLevel("SUPPORTED"), "FULL");
  });

  it("pending review stays partial", () => {
    assert.equal(toCanonicalSupportLevel("EVIDENCE_PENDING_REVIEW"), "PARTIAL");
    assert.equal(toCanonicalSupportLevel("PARTIAL"), "PARTIAL");
  });

  it("unsupported and unknown values pass through untouched", () => {
    assert.equal(toCanonicalSupportLevel("UNSUPPORTED"), "UNSUPPORTED");
    assert.equal(toCanonicalSupportLevel("SOMETHING_NEW"), "SOMETHING_NEW");
    assert.notEqual(toCanonicalSupportLevel("SOMETHING_NEW"), "FULL");
    assert.notEqual(toCanonicalSupportLevel("SOMETHING_NEW"), "SUBSTANTIAL");
  });
});

// ─── Guidance module self-check ──────────────────────────────────────────────

describe("the false-automation detector actually detects", () => {
  it("catches the exact sentence that was shipped", () => {
    assert.equal(
      claimsFalseAutomation(
        "Bid strategy requires reliable extraction and analysis. Uploading a clearer copy of the source re-runs both automatically.",
      ),
      true,
    );
  });

  it("catches paraphrases", () => {
    for (const claim of [
      "The system automatically runs AI Analyze when extraction finishes.",
      "Analysis runs automatically after upload.",
      "Uploading a new file automatically re-runs the analysis.",
    ]) {
      assert.equal(claimsFalseAutomation(claim), true, `missed: ${claim}`);
    }
  });

  it("does not flag truthful automatic statements about extraction", () => {
    for (const truthful of [
      "Source extraction will run automatically. When extraction is complete, run AI Analyze.",
      manualGateGuidanceFor("EXTRACTION_UNRELIABLE").message,
      POST_ENGINE_AUTOMATIC_COPY,
    ]) {
      assert.equal(claimsFalseAutomation(truthful), false, `false positive: ${truthful}`);
    }
  });
});
