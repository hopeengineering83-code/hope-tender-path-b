// Full-app audit — regression tests for the 12 real gaps fixed in this PR.
//
// Each test proves a specific fix and would fail if the fix were reverted.
// Tests are source-text assertions (reading the file and checking the
// structure) so they run without a database and are fast in CI.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── H1 (engine): criticalMetadataOk inverted `!` removed ───────────────────

describe("H1 — criticalMetadataOk no longer inverted", () => {
  it("the async IIFE is NOT prefixed with `!` (the old inversion)", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // The old code had: `? !(await (async () => {`
    // The fixed code has: `? (await (async () => {`
    assert.doesNotMatch(src, /\? !\(await \(async \(\) =>/, "must NOT have the inverted `!` before the async IIFE");
    assert.match(src, /\? \(await \(async \(\) =>/, "must have the non-inverted async IIFE");
  });

  it("the catch block returns false (fail-closed, not fail-open)", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // Slice the async IIFE region and check the catch returns false.
    const iifeStart = src.indexOf("? (await (async () =>");
    assert.ok(iifeStart > -1, "async IIFE must exist");
    const catchIdx = src.indexOf("} catch { return false; }", iifeStart);
    assert.ok(catchIdx > -1, "catch must return false (fail-closed) inside the IIFE");
  });
});

// ─── H3 (engine): EXPORT_BLOCKED added to union + priorityOrder + actionMap ──

describe("H3 — EXPORT_BLOCKED is selectable in canonical-workflow-decision", () => {
  it("EXPORT_BLOCKED is in the WorkflowBlockerPriority union", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    const unionMatch = src.match(/export type WorkflowBlockerPriority\s*=\s*([\s\S]*?);/);
    assert.ok(unionMatch, "union must exist");
    assert.match(unionMatch![1], /"EXPORT_BLOCKED"/, "union must include EXPORT_BLOCKED");
  });

  it("EXPORT_BLOCKED is in priorityOrder (before EXPORT_ZIP_READY)", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    const blockedIdx = src.indexOf('"EXPORT_BLOCKED"');
    const zipReadyIdx = src.indexOf('"EXPORT_ZIP_READY"');
    assert.ok(blockedIdx > -1, "EXPORT_BLOCKED must be in the file");
    assert.ok(zipReadyIdx > -1, "EXPORT_ZIP_READY must be in the file");
    // EXPORT_BLOCKED must appear before EXPORT_ZIP_READY in priorityOrder
    // (it should block before the "ready" state is reported).
    assert.ok(blockedIdx < zipReadyIdx, "EXPORT_BLOCKED must come before EXPORT_ZIP_READY");
  });

  it("EXPORT_BLOCKED has an actionMap entry", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    assert.match(src, /EXPORT_BLOCKED:\s*\{\s*action:\s*"FIX_EXPORT_BLOCKERS"/);
  });
});

// ─── H2 (engine): runtime-readiness-facts prisma select includes all fields ──

describe("H2 — runtime-readiness-facts prisma select mirrors the gate", () => {
  it("selects title, description, intakeSummary on the tender", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    // Slice the tender findFirst select block.
    const selectStart = src.indexOf("select: {");
    const selectEnd = src.indexOf("},", selectStart);
    assert.ok(selectStart > -1 && selectEnd > -1, "select block must exist");
    const selectBlock = src.slice(selectStart, selectEnd);
    assert.match(selectBlock, /title: true/);
    assert.match(selectBlock, /description: true/);
    assert.match(selectBlock, /intakeSummary: true/);
  });

  it("selects originalFileName, classification, createdAt on files", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    // Find the files select block.
    const filesIdx = src.indexOf("files: {");
    assert.ok(filesIdx > -1, "files select must exist");
    const filesBlock = src.slice(filesIdx, filesIdx + 500);
    assert.match(filesBlock, /originalFileName: true/);
    assert.match(filesBlock, /classification: true/);
    assert.match(filesBlock, /createdAt: true/);
  });
});

// ─── L2 (engine): duplicate TENDER_FACTS_INVALID removed ─────────────────────

describe("L2 — duplicate TENDER_FACTS_INVALID removed", () => {
  it("TENDER_FACTS_INVALID appears exactly once in the union", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    // Count occurrences in the GenerationBlockerCode union.
    const unionMatch = src.match(/export type GenerationBlockerCode\s*=\s*([\s\S]*?);/);
    assert.ok(unionMatch, "union must exist");
    const count = (unionMatch![1].match(/"TENDER_FACTS_INVALID"/g) || []).length;
    assert.equal(count, 1, "TENDER_FACTS_INVALID must appear exactly once in the union");
  });
});

// ─── M3 (engine): mergeFallbackRows comments/logs no longer claim rows are created ──

describe("M3 — mergeFallbackRows no-op contradiction fixed", () => {
  it("the old misleading log message is gone", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The old log said "Created N deterministic fallback compliance rows"
    // which was false — mergeFallbackRows is a no-op.
    assert.doesNotMatch(src, /Created \$\{fallback\.rows\.length\} deterministic fallback compliance rows/);
  });

  it("the new log message accurately describes the no-op boundary", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /mergeFallbackRows is fail-closed no-op/);
  });

  it("the comment explains the evidence-provenance boundary", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // After #1055 merge, the comment text changed. Check for the key phrases
    // that prove the evidence-provenance boundary is documented.
    assert.ok(
      src.includes("mergeFallbackRows") && src.includes("evidence-provenance"),
      "must reference mergeFallbackRows and evidence-provenance boundary",
    );
    assert.ok(
      src.includes("diagnostic rows not persisted as compliance evidence") ||
      src.includes("NOT Company Vault evidence") ||
      src.includes("diagnostics only"),
      "must state that tender-source diagnostics are NOT Company Vault evidence",
    );
  });
});

// ─── H1 (UI): BidDecisionForm role gate ──────────────────────────────────────
//
// components/bid-control-verdict-panel.tsx was retired in favor of the
// canonical Tender Release State. BidDecisionForm (the genuine "record a
// human bid decision" feature, not a duplicate verdict display) now mounts
// inside components/tender-release-state-panel.tsx, gated by a canMutate
// PROP computed once in app/dashboard/tenders/[id]/page.tsx via the same
// getCurrentUser + canMutateTender pattern the old panel used locally —
// the protected property (REVIEWER/VIEWER must never see the mutation form)
// now holds via prop-drilling from the already-verified page-level check
// rather than a component-local recomputation.
describe("H1 (UI) — BidDecisionForm role gate", () => {
  it("page.tsx computes canMutate via getCurrentUser + canMutateTender", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(src, /import \{ getSession, getCurrentUser \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/auth"/);
    assert.match(src, /const currentUser = await getCurrentUser\(\)/);
    assert.match(src, /const canMutate = canMutateTender\(currentUser\?\.role\)/);
  });

  it("TenderReleaseStatePanel gates BidDecisionForm behind the canMutate prop, defaulting to false", () => {
    const src = read("components/tender-release-state-panel.tsx");
    assert.match(src, /canMutate = false/, "canMutate must default to false, never rendering the form by accident");
    assert.match(src, /\{canMutate && <BidDecisionForm tenderId=\{tenderId\} \/>\}/);
  });

  it("page.tsx passes canMutate into TenderReleaseStatePanel", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(src, /<TenderReleaseStatePanel tenderId=\{tender\.id\} canMutate=\{canMutate\}/);
  });
});

// H6 (UI) and L8 (UI) tested action-anchor href details specific to
// tender-health-score-panel.tsx's per-item "next best action" tile list.
// The canonical Tender Release State panel does not replicate that anchor-
// link affordance — it surfaces one primaryNextAction as plain label/reason
// text sourced directly from getCanonicalTenderWorkflowDecision (see the
// "canonical Tender Release State inherits ... gating" tests in
// tests/release-snapshot-panel-truth.test.ts), so there is no local anchor
// mapping left to regress.

// ─── M3 (UI): dead EXTRACTION_NOT_READY branch removed ───────────────────────

describe("M3 (UI) — dead EXTRACTION_NOT_READY branch removed", () => {
  it("extractionBlocked const is gone", () => {
    const src = read("components/engine-action-panel.tsx");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /const extractionBlocked = result\?\.code === "EXTRACTION_NOT_READY"/);
  });

  it("Force run once button JSX is gone", () => {
    const src = read("components/engine-action-panel.tsx");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    // The button JSX must be gone (comments mentioning the old label are OK).
    assert.doesNotMatch(codeOnly, /<BoltIcon \/>\s*Force run once/);
    assert.doesNotMatch(codeOnly, /title="Force run Engine once/);
  });
});

// ─── M4 (UI): dead ocrProvider state removed ─────────────────────────────────

describe("M4 (UI) — dead ocrProvider state removed", () => {
  it("ocrProvider useState is gone", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /const \[ocrProvider, setOcrProvider\] = useState/);
  });

  it("the ocrProvider conditional in fetchOptions is gone", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /isReExtract && ocrProvider !== "auto"/);
  });
});

// ─── L9 (UI): dead MISSING substring removed ─────────────────────────────────

describe("L9 (UI) — dead MISSING substring removed", () => {
  it("state.includes('MISSING') is gone from stateColor", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.doesNotMatch(src, /state\.includes\("MISSING"\)/);
  });
});

// ─── H3 (API): admin/db-integrity no longer leaks raw connection error ───────

describe("H3 (API) — admin/db-integrity does not leak raw connection error", () => {
  it("does NOT use err.message.slice for connectionError", () => {
    const src = read("app/api/admin/db-integrity/route.ts");
    assert.doesNotMatch(src, /connectionError = err instanceof Error \? err\.message\.slice/);
  });

  it("uses a fixed safe message", () => {
    const src = read("app/api/admin/db-integrity/route.ts");
    assert.match(src, /connectionError = "Connection check failed \(see server logs\)\."/);
  });

  it("logs the error server-side (constructor name only, not raw message)", () => {
    const src = read("app/api/admin/db-integrity/route.ts");
    assert.match(src, /logger\.error\("\[db-integrity\] connection check failed"/);
    assert.match(src, /detail: err instanceof Error \? err\.constructor\.name : typeof err/);
  });
});
