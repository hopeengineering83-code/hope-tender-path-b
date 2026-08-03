// Regression proof for PR #936 gap fixes.
//
// 1. getCurrentConfirmedBuildPlan is FAIL-CLOSED: corrupted plan items or a
//    hash-verification failure can never validate a confirmed plan. (An
//    earlier revision returned ok:true from the catch block, silently
//    skipping both the staleness check and the metadata-evidence check.)
// 2. Reduced unit-test prisma mocks (no tenderMetadataOverride delegate) are
//    detected EXPLICITLY and skip hash verification — errors do not.
// 3. The repair response contract understands UNRESOLVED: the route emits it
//    for unverifiable source quotes and the client must not misreport it as
//    an ERROR.
// 4. Wiring: canonical-tender-readiness and final-submission-readiness use
//    the confirmed BuildPlan (NO_CURRENT_CONFIRMED_BUILD_PLAN blocker), not
//    the derived-fallback plan.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { getCurrentConfirmedBuildPlan } from "../lib/engine/build-plan";
import { parseRepairMetadataResponse, buildRepairMessage, countOutcomesByStatus } from "../lib/engine/repair-metadata-contract";

const planItems = [{
  canonicalId: "doc-1", exactFileName: "Technical Proposal.docx", exactOrder: 1,
  documentType: "TECHNICAL_PROPOSAL", required: true, format: "DOCX", envelope: "TECHNICAL",
  sourceRequirementIds: [], brandingAllowed: true, signatureAllowed: true, stampAllowed: true,
}];

function confirmedPlanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1", tenderId: "t1", status: "CONFIRMED", revision: 1,
    contentHash: "hash-1", confirmedRevision: 1, confirmedContentHash: "hash-1",
    itemsJson: JSON.stringify(planItems),
    ...overrides,
  };
}

describe("getCurrentConfirmedBuildPlan — fail-closed verification", () => {
  it("client without a buildPlan delegate → blocked (no confirmed plan)", async () => {
    const prisma = { tender: { findFirst: async () => null } };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, false);
  });

  it("no CONFIRMED plan row → blocked", async () => {
    const prisma = { buildPlan: { findFirst: async () => null }, tender: { findFirst: async () => null } };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /No confirmed Build Plan/);
  });

  it("corrupted itemsJson (invalid JSON) → blocked, never ok", async () => {
    const prisma = {
      buildPlan: { findFirst: async () => confirmedPlanRow({ itemsJson: "{not json" }) },
      tender: { findFirst: async () => null },
      tenderMetadataOverride: { findMany: async () => [] },
    };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /corrupted/i);
  });

  it("itemsJson that parses to a non-array → blocked, never ok", async () => {
    const prisma = {
      buildPlan: { findFirst: async () => confirmedPlanRow({ itemsJson: JSON.stringify({ sneaky: true }) }) },
      tender: { findFirst: async () => null },
      tenderMetadataOverride: { findMany: async () => [] },
    };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /corrupted/i);
  });

  it("FAIL CLOSED: hash verification error on a full client → blocked (regression: used to return ok:true)", async () => {
    const prisma = {
      buildPlan: { findFirst: async () => confirmedPlanRow() },
      // Full client shape (both delegates present) so hash verification runs;
      // the tender read then fails like a transient DB error would.
      tender: { findFirst: async () => { throw new Error("db down"); } },
      tenderMetadataOverride: { findMany: async () => [] },
    };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, false, "a verification failure must NEVER validate the plan");
    assert.match((result as { blocker: string }).blocker, /could not be verified/i);
  });

  it("full client with recomputable state → stale plan is blocked (hash mismatch)", async () => {
    const prisma = {
      buildPlan: { findFirst: async () => confirmedPlanRow() },
      tender: {
        findFirst: async () => ({
          id: "t1", title: "Tender", reference: "REF-1", exactFileNaming: null, exactFileOrder: null,
          submissionMethod: null, submissionAddress: null, submissionEmails: null, submissionEmailSubject: null,
          deadline: null, procuringEntityName: null, clientName: null,
          files: [], requirements: [],
        }),
      },
      tenderMetadataOverride: { findMany: async () => [] },
    };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    // The stored confirmedContentHash "hash-1" can never equal a real
    // recomputed canonical hash, so the plan must be reported stale.
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /stale|mismatch/i);
  });

  it("reduced unit-test mock (no tenderMetadataOverride delegate) skips verification and returns parsed items", async () => {
    const prisma = {
      buildPlan: { findFirst: async () => confirmedPlanRow() },
      tender: { findFirst: async () => ({ id: "t1" }) },
      // no tenderMetadataOverride → explicitly detected as a reduced mock
    };
    const result = await getCurrentConfirmedBuildPlan(prisma as any, "t1", "u1");
    assert.equal(result.ok, true, "reduced mocks are an explicit, detected accommodation — not an error path");
    assert.ok(Array.isArray((result as { items: unknown[] }).items));
    assert.equal((result as { items: Array<{ exactFileName: string }> }).items[0].exactFileName, "Technical Proposal.docx");
  });
});

describe("repair contract — UNRESOLVED is a first-class outcome status", () => {
  it("parseRepairMetadataResponse preserves UNRESOLVED (not coerced to ERROR)", () => {
    const parsed = parseRepairMetadataResponse({
      success: false,
      outcomes: [{ field: "reference", status: "UNRESOLVED", reason: "Source quote not found in active tender file." }],
      outcomesByField: {},
    });
    assert.ok(parsed);
    assert.equal(parsed!.outcomes[0].status, "UNRESOLVED");
  });

  it("countOutcomesByStatus counts UNRESOLVED separately from ERROR", () => {
    const counts = countOutcomesByStatus([
      { field: "reference", status: "UNRESOLVED" },
      { field: "deadline", status: "REPAIRED" },
    ]);
    assert.equal(counts.UNRESOLVED, 1);
    assert.equal(counts.ERROR, 0);
  });

  it("buildRepairMessage reports UNRESOLVED as manual-review info, not as an error", () => {
    const { kind, message } = buildRepairMessage([
      { field: "reference", status: "UNRESOLVED", reason: "quote unverified" },
    ]);
    assert.equal(kind, "info");
    assert.match(message, /unresolved/i);
  });

  it("truly unknown statuses still coerce to ERROR", () => {
    const parsed = parseRepairMetadataResponse({ outcomes: [{ field: "x", status: "WHATEVER" }] });
    assert.equal(parsed!.outcomes[0].status, "ERROR");
  });

  it("the repair route emits UNRESOLVED without casting around the contract type", () => {
    const source = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");
    assert.match(source, /status:\s*"UNRESOLVED"/);
    assert.ok(!source.includes('"UNRESOLVED" as any'), "UNRESOLVED must be part of the typed contract, not casted");
  });
});

describe("confirmed BuildPlan is enforced on the readiness gates (P1-D wiring)", () => {
  const canonical = readFileSync("lib/canonical-tender-readiness.ts", "utf8");
  const finalReadiness = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");

  it("canonical-tender-readiness uses the confirmed BuildPlan and the NO_CURRENT_CONFIRMED_BUILD_PLAN blocker", () => {
    assert.match(canonical, /getCurrentConfirmedBuildPlan/);
    assert.match(canonical, /NO_CURRENT_CONFIRMED_BUILD_PLAN/);
    assert.ok(!canonical.includes("buildSubmissionPlanWithDerivedFallback"), "derived fallback must not feed the canonical readiness gate");
  });

  it("final-submission-readiness uses the confirmed BuildPlan for the export plan reconciliation", () => {
    assert.match(finalReadiness, /getCurrentConfirmedBuildPlan/);
    assert.match(finalReadiness, /NO_CURRENT_CONFIRMED_BUILD_PLAN/);
    assert.match(finalReadiness, /const hasExplicitPlanScope = confirmedPlan\.ok;/);
    assert.ok(!finalReadiness.includes("buildSubmissionPlanWithDerivedFallback"), "derived fallback must not feed the final-export readiness");
  });

  it("confirmed-plan consumers use the safely parsed items — no raw JSON.parse of itemsJson at call sites", () => {
    for (const path of [
      "lib/engine/workflow/workflow-state.ts",
      "app/api/tenders/[id]/auto-finalize/route.ts",
      "app/api/tenders/[id]/supersede-outside-plan/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.ok(!/JSON\.parse\([^)]*itemsJson/.test(source), `${path} must consume confirmedPlan.items instead of re-parsing itemsJson`);
    }
  });

  it("the central readiness gate validates confirmed-plan documents from the safely parsed items", () => {
    const gate = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.match(gate, /validateConfirmedPlanDocuments\(prisma, tenderId, userId, confirmed\.items\)/);
    // The gate's recorded-DRAFT-plan hash check still parses its own row; that
    // path is wrapped by the gate-wide try/catch → GATE_INTERNAL_ERROR (fail
    // closed), so it is intentionally not part of this assertion.
  });

  it('plan approval keys on the confirmed BuildPlan, not the unreachable tender.status === "PLAN_APPROVED"', async () => {
    // "PLAN_APPROVED" is not a legal tender status: nothing can write it, so
    // any approval check that requires it is permanently false in production.
    const { TENDER_STATUSES } = await import("../lib/tender-workflow");
    assert.ok(!(TENDER_STATUSES as readonly string[]).includes("PLAN_APPROVED"));
    for (const path of [
      "lib/engine/workflow/workflow-state.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /confirmedPlan\.ok \? "CANONICAL_APPROVED"/, `${path} must derive approval from the confirmed BuildPlan`);
    }
  });

  it("reconcile-docs requires a current confirmed Build Plan and reconciles against its items", () => {
    const source = readFileSync("app/api/tenders/[id]/reconcile-docs/route.ts", "utf8");
    assert.match(source, /getCurrentConfirmedBuildPlan/);
    assert.match(source, /BUILD_PLAN_NOT_CONFIRMED/);
    assert.ok(!source.includes("buildSubmissionPlanWithDerivedFallback"), "reconciliation must never supersede documents against a derived heuristic plan");
  });

  it("every remaining plan consumer follows the confirmed Build Plan — no derived-fallback authority anywhere", () => {
    // Files where the plan drives mutations, gates, or user-facing plan
    // counts. buildSubmissionPlan(WithDerivedFallback) may only remain in the
    // draft-creation path (lib/engine/build-plan.ts, generate planOnly) and
    // in submission-plan.ts itself.
    for (const path of [
      "app/api/tenders/[id]/generate-missing-plan-files/route.ts",
      "app/api/tenders/[id]/reconcile-docs/route.ts",
      "components/final-package-manifest-panel.tsx",
      // components/tender-release-state-panel.tsx was deleted as unrendered
      // dead code (nothing imports or renders it).
      "lib/engine/submission-plan-completeness.ts",
      "lib/engine/workflow/workflow-state.ts",
      "lib/canonical-tender-readiness.ts",
      "lib/engine/final-submission-readiness.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      if (path === "lib/engine/submission-plan-completeness.ts") {
        // The resolver keeps the derived fallback ONLY for tenders without a
        // confirmed plan, and must prefer confirmedPlanItems when provided.
        assert.match(source, /confirmedPlanItems/);
        continue;
      }
      assert.ok(!source.includes("buildSubmissionPlanWithDerivedFallback"), `${path} must not use the derived-fallback plan`);
    }
  });

  it("generate route scopes reconciliation to the confirmed plan; generate-missing-plan-files allows draft work without confirmed plan", () => {
    const generate = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
    assert.match(generate, /const confirmedPlanForRun = await getCurrentConfirmedBuildPlan\(prisma, id, userId\);/);
    assert.match(generate, /const explicitSubmissionScope = confirmedPlanForRun\.ok;/);
    const missing = readFileSync("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8");
    // BuildPlan requirement relaxed for draft — confirmed plan no longer required for missing-plan-files;
    assert.match(missing, /confirmedPlan\.items/);
  });

  it("submission-plan GET and lifecycle orchestrator pass confirmed items into completeness", () => {
    // The GET route no longer resolves this itself — it and the automatic
    // finalize pipeline share loadSubmissionPlanCompleteness, so the confirmed
    // plan is applied in exactly one place for both. Assert the guarantee at
    // its new home, and that the route actually goes through it.
    const route = readFileSync("app/api/tenders/[id]/submission-plan/route.ts", "utf8");
    assert.match(route, /loadSubmissionPlanCompleteness\(prisma, id, actor\.id\)/);
    const loader = readFileSync("lib/engine/submission-plan-completeness.ts", "utf8");
    assert.match(loader, /confirmedPlanItems: confirmedPlan\.ok \? confirmedPlan\.items : null/);
    const orchestrator = readFileSync("lib/engine/tender-lifecycle-orchestrator.ts", "utf8");
    assert.match(orchestrator, /confirmedPlanItems: confirmedPlan\.ok \? confirmedPlan\.items : null/);
  });
});

describe("completeness resolver — confirmed plan authority (real function calls)", () => {
  it("confirmedPlanItems override the derived plan and set CONFIRMED_BUILD_PLAN", async () => {
    const { resolveSubmissionPlanCompleteness } = await import("../lib/engine/submission-plan-completeness");
    const report = resolveSubmissionPlanCompleteness({
      tender: { id: "t1", title: "T", exactFileNaming: null, exactFileOrder: null, requirements: [] } as never,
      generatedDocuments: [],
      confirmedPlanItems: [{
        canonicalId: "doc-1", exactFileName: "Technical Proposal.docx", exactOrder: 1,
        documentType: "TECHNICAL_PROPOSAL", required: true, format: "DOCX", envelope: "TECHNICAL",
        sourceRequirementIds: [],
      } as never],
    });
    assert.equal(report.planState, "CONFIRMED_BUILD_PLAN");
    assert.equal(report.requiresUserConfirmation, false);
    assert.equal(report.hasExplicitScope, true);
    assert.equal(report.totalRequired, 1);
    assert.equal(report.totalMissing, 1, "the confirmed file has no generated doc yet — it must count as missing");
  });

  it("without confirmedPlanItems the derived behavior is unchanged (requirements → derived draft)", async () => {
    const { resolveSubmissionPlanCompleteness } = await import("../lib/engine/submission-plan-completeness");
    const report = resolveSubmissionPlanCompleteness({
      tender: {
        id: "t1", title: "T", exactFileNaming: null, exactFileOrder: null,
        requirements: [{ id: "r1", title: "Technical Proposal", requirementType: "TECHNICAL_PROPOSAL", priority: "MANDATORY" }],
      } as never,
      generatedDocuments: [],
    });
    assert.notEqual(report.planState, "CONFIRMED_BUILD_PLAN");
  });
});

describe("deadline validity — stored values vs extraction candidates", () => {
  it("a passed deadline stays structurally valid as a STORED value", async () => {
    const { isParseableDeadlineValue, isValidDeadlineCandidate } = await import("../lib/engine/source-grounded-metadata-repair");
    const lastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    assert.equal(isParseableDeadlineValue(lastYear), true, "historical deadlines are real data, not invalid data");
    assert.equal(isValidDeadlineCandidate(lastYear), false, "but a NEW extraction candidate that old signals contamination");
  });

  it("placeholders, labels, and garbage are invalid in both modes", async () => {
    const { isParseableDeadlineValue, isValidDeadlineCandidate } = await import("../lib/engine/source-grounded-metadata-repair");
    for (const bad of ["TBD", "Deadline", "not-a-date", "", null, undefined, 42]) {
      assert.equal(isParseableDeadlineValue(bad), false, `stored: ${String(bad)}`);
      assert.equal(isValidDeadlineCandidate(bad), false, `candidate: ${String(bad)}`);
    }
  });

  it("re-extract keeps stored historical deadlines and candidate-validates extracted ones", () => {
    const source = readFileSync("app/api/tenders/[id]/re-extract-metadata/route.ts", "utf8");
    assert.match(source, /field === "deadline" && !isParseableDeadlineValue\(value\)/);
    assert.match(source, /isValidDeadlineCandidate\(metadata\.deadline\) \? metadata\.deadline : null/);
  });
});
