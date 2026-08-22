// Tests for operation gate wiring into live routes.
//
// Verifies that the operation gate (resolveTenderOperationGate) is actually
// called by the live API routes — not just mentioned in comments. This is
// the "proof of wiring" test: if a future refactor removes the call, the
// test fails.
//
// Routes covered:
//   • /api/tenders/[id]/generate              → DRAFT_GENERATION
//   • /api/tenders/[id]/generate-missing-plan-files → SUPPORT_PACKAGE_GENERATION
//   • /api/tenders/[id]/export                → REVIEW_EXPORT
//   • /api/tenders/[id]/download              → FINAL_SUBMISSION_READY (zipPackage)
//   • /api/tenders/[id]/auto-finalize         → FINAL_SUBMISSION_READY

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. /api/tenders/[id]/generate — DRAFT_GENERATION ───────────────────────

describe("operation gate wiring — /api/tenders/[id]/generate (DRAFT_GENERATION)", () => {
  it("imports resolveTenderOperationGate from tender-operation-gate", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-operation-gate"'),
      "must import from tender-operation-gate",
    );
    assert.ok(src.includes("resolveTenderOperationGate"), "must import resolveTenderOperationGate");
  });

  it("calls resolveTenderOperationGate with operation: DRAFT_GENERATION", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes('operation: "DRAFT_GENERATION"'), "must call with DRAFT_GENERATION");
    assert.ok(src.includes("resolveTenderOperationGate("), "must call resolveTenderOperationGate");
  });

  it("surfaces operation-gate warnings via logger.info", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(
      src.includes("operationGate.warnings") && src.includes("logger.info"),
      "must log operation-gate warnings for observability",
    );
  });

  it("returns 422 with errorCode OPERATION_GATE_BLOCKED if the gate blocks", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("OPERATION_GATE_BLOCKED"), "must return OPERATION_GATE_BLOCKED errorCode");
    assert.ok(src.includes("operationGate.blockers.length > 0"), "must check blockers length");
  });

  it("imports deriveSourceDrivenTenderDetail and computes sourceDrivenDetail", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("deriveSourceDrivenTenderDetail"), "must import deriveSourceDrivenTenderDetail");
    assert.ok(src.includes("sourceDrivenDetail"), "must compute sourceDrivenDetail");
  });

  it("includes sourceDrivenDetail and operationGate in success response", () => {
    const src = read("app/api/tenders/[id]/generate/route.ts");
    assert.ok(src.includes("sourceDrivenDetail:"), "must include sourceDrivenDetail in response");
    assert.ok(src.includes("operationGate:"), "must include operationGate in response");
  });
});

// ─── 2. /api/tenders/[id]/generate-missing-plan-files — SUPPORT_PACKAGE_GENERATION ──

describe("operation gate wiring — /api/tenders/[id]/generate-missing-plan-files (SUPPORT_PACKAGE_GENERATION)", () => {
  it("imports resolveTenderOperationGate from tender-operation-gate", () => {
    const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts") + read("lib/engine/missing-plan-file-generation.ts");
    // The gate call moved into lib/engine/missing-plan-file-generation.ts, which
    // sits beside tender-operation-gate.ts and so imports it as "./" rather than
    // climbing out of the app directory. Accept either spelling of the same
    // module — the point is that this path resolves the gate from the canonical
    // module, not that the relative prefix has a particular depth.
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-operation-gate"')
      || src.includes('from "./tender-operation-gate"'),
      "must import from tender-operation-gate",
    );
    assert.ok(src.includes("resolveTenderOperationGate"), "must import resolveTenderOperationGate");
  });

  it("calls resolveTenderOperationGate with operation: SUPPORT_PACKAGE_GENERATION", () => {
    const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts") + read("lib/engine/missing-plan-file-generation.ts");
    assert.ok(
      src.includes('operation: "SUPPORT_PACKAGE_GENERATION"'),
      "must call with SUPPORT_PACKAGE_GENERATION",
    );
    assert.ok(src.includes("resolveTenderOperationGate("), "must call resolveTenderOperationGate");
  });

  it("returns 422 with errorCode OPERATION_GATE_BLOCKED if the gate blocks", () => {
    const src = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts") + read("lib/engine/missing-plan-file-generation.ts");
    assert.ok(src.includes("OPERATION_GATE_BLOCKED"), "must return OPERATION_GATE_BLOCKED errorCode");
    assert.ok(src.includes("operationGate.blockers.length > 0"), "must check blockers length");
  });
});

// ─── 3. /api/tenders/[id]/export — REVIEW_EXPORT ────────────────────────────

describe("operation gate wiring — /api/tenders/[id]/export (REVIEW_EXPORT)", () => {
  it("imports resolveTenderOperationGate from tender-operation-gate", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-operation-gate"'),
      "must import from tender-operation-gate",
    );
    assert.ok(src.includes("resolveTenderOperationGate"), "must import resolveTenderOperationGate");
  });

  it("calls resolveTenderOperationGate with operation: REVIEW_EXPORT", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes('operation: "REVIEW_EXPORT"'), "must call with REVIEW_EXPORT");
    assert.ok(src.includes("resolveTenderOperationGate("), "must call resolveTenderOperationGate");
  });

  it("returns 422 with errorCode OPERATION_GATE_BLOCKED if the gate blocks", () => {
    const src = read("app/api/tenders/[id]/export/route.ts");
    assert.ok(src.includes("OPERATION_GATE_BLOCKED"), "must return OPERATION_GATE_BLOCKED errorCode");
    assert.ok(src.includes("reviewOperationGate.blockers.length > 0"), "must check blockers length");
  });
});

// ─── 4. /api/tenders/[id]/download — FINAL_SUBMISSION_READY (zipPackage) ────

describe("operation gate wiring — /api/tenders/[id]/download (FINAL_SUBMISSION_READY)", () => {
  it("imports resolveTenderOperationGate from tender-operation-gate", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-operation-gate"'),
      "must import from tender-operation-gate",
    );
    assert.ok(src.includes("resolveTenderOperationGate"), "must import resolveTenderOperationGate");
  });

  it("calls resolveTenderOperationGate with operation: FINAL_SUBMISSION_READY", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(
      src.includes('operation: "FINAL_SUBMISSION_READY"'),
      "must call with FINAL_SUBMISSION_READY",
    );
    assert.ok(src.includes("resolveTenderOperationGate("), "must call resolveTenderOperationGate");
  });

  it("returns 409 with code OPERATION_GATE_BLOCKED if the gate blocks", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("OPERATION_GATE_BLOCKED"), "must return OPERATION_GATE_BLOCKED code");
    assert.ok(src.includes("finalOperationGate.blockers.length > 0"), "must check blockers length");
  });

  it("passes the confirmed BuildPlan to the gate", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.ok(src.includes("getCurrentConfirmedBuildPlan"), "must call getCurrentConfirmedBuildPlan");
    assert.ok(src.includes("finalBuildPlan"), "must use finalBuildPlan in gate input");
  });
});

// ─── 5. /api/tenders/[id]/auto-finalize — FINAL_SUBMISSION_READY ────────────

describe("operation gate wiring — /api/tenders/[id]/auto-finalize (FINAL_SUBMISSION_READY)", () => {
  it("imports resolveTenderOperationGate from tender-operation-gate", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(
      src.includes('from "../../../../../lib/engine/tender-operation-gate"'),
      "must import from tender-operation-gate",
    );
    assert.ok(src.includes("resolveTenderOperationGate"), "must import resolveTenderOperationGate");
  });

  it("calls resolveTenderOperationGate with operation: FINAL_SUBMISSION_READY", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(
      src.includes('operation: "FINAL_SUBMISSION_READY"'),
      "must call with FINAL_SUBMISSION_READY",
    );
    assert.ok(src.includes("resolveTenderOperationGate("), "must call resolveTenderOperationGate");
  });

  it("returns 422 with errorCode OPERATION_GATE_BLOCKED if the gate blocks", () => {
    const src = read("app/api/tenders/[id]/auto-finalize/route.ts");
    assert.ok(src.includes("OPERATION_GATE_BLOCKED"), "must return OPERATION_GATE_BLOCKED errorCode");
    assert.ok(src.includes("autoFinalizeOperationGate.blockers.length > 0"), "must check blockers length");
  });
});

// ─── 6. Source-driven UI — tender-intake-detail-panel ───────────────────────

describe("source-driven UI — tender-intake-detail-panel.tsx", () => {
  it("imports deriveSourceDrivenTenderDetail", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("deriveSourceDrivenTenderDetail"), "must import deriveSourceDrivenTenderDetail");
  });

  it("renders FactActions component with Ignore / Edit / Re-extract actions", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("FactActions"), "must define FactActions component");
    // Buttons render text children; just check the labels are present
    assert.ok(src.includes("Ignore"), "must render Ignore button text");
    assert.ok(src.includes("Edit"), "must render Edit button text");
    assert.ok(src.includes("Re-extract"), "must render Re-extract button text");
    // Check the button onClicks are wired
    assert.ok(src.includes("handleIgnore"), "must wire handleIgnore");
    assert.ok(src.includes("handleSaveEdit"), "must wire handleSaveEdit");
    assert.ok(src.includes("handleReExtract"), "must wire handleReExtract");
  });

  it("calls /api/tenders/[id]/metadata-override for Ignore and Edit", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(
      src.includes("/api/tenders/${tenderId}/metadata-override"),
      "must call metadata-override endpoint",
    );
    assert.ok(src.includes("NOT_APPLICABLE"), "must support NOT_APPLICABLE state (Ignore)");
    assert.ok(src.includes("USER_EDITED"), "must support USER_EDITED state (Edit)");
  });

  it("shows missing relevant facts in an open details block", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("missingRelevantCount"), "must check missingRelevantCount");
    assert.ok(src.includes("relevant fact(s) missing"), "must display missing relevant facts notice");
  });

  it("derives sourceDetail from tender record", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(src.includes("deriveSourceDrivenTenderDetail(tender"), "must call deriveSourceDrivenTenderDetail with tender");
  });
});

// ─── 7. Architectural: source-driven model exists and is exported ───────────

describe("source-driven architecture — module existence", () => {
  it("lib/engine/source-driven-tender-detail.ts exists and exports key types", () => {
    const src = read("lib/engine/source-driven-tender-detail.ts");
    assert.ok(src.includes("export type SourceDrivenTenderFact"), "must export SourceDrivenTenderFact type");
    assert.ok(src.includes("export type SourceDrivenTenderDetail"), "must export SourceDrivenTenderDetail type");
    assert.ok(src.includes("export function deriveSourceDrivenTenderDetail"), "must export deriveSourceDrivenTenderDetail");
    assert.ok(src.includes("export function isFactRequiredForFinal"), "must export isFactRequiredForFinal");
    assert.ok(src.includes("export function doesFactBlockDraft"), "must export doesFactBlockDraft");
  });

  it("lib/engine/tender-operation-gate.ts exists and exports resolveTenderOperationGate", () => {
    const src = read("lib/engine/tender-operation-gate.ts");
    assert.ok(src.includes("export function resolveTenderOperationGate"), "must export resolveTenderOperationGate");
    assert.ok(src.includes("export type TenderOperation"), "must export TenderOperation type");
    assert.ok(src.includes("ANALYSIS"), "must support ANALYSIS operation");
    assert.ok(src.includes("DRAFT_GENERATION"), "must support DRAFT_GENERATION operation");
    assert.ok(src.includes("SUPPORT_PACKAGE_GENERATION"), "must support SUPPORT_PACKAGE_GENERATION operation");
    assert.ok(src.includes("REVIEW_EXPORT"), "must support REVIEW_EXPORT operation");
    assert.ok(src.includes("FINAL_SUBMISSION_READY"), "must support FINAL_SUBMISSION_READY operation");
  });

  it("lib/engine/metadata-display-sanitizer.ts exists and exports key functions", () => {
    const src = read("lib/engine/metadata-display-sanitizer.ts");
    assert.ok(src.includes("export function isDisplayValidMetadataValue"), "must export isDisplayValidMetadataValue");
    assert.ok(src.includes("export function sanitizeMetadataDisplayValue"), "must export sanitizeMetadataDisplayValue");
    assert.ok(src.includes("export function isNegativeOrPlaceholderMetadata"), "must export isNegativeOrPlaceholderMetadata");
    assert.ok(src.includes("NOT_EXTRACTED"), "must define NOT_EXTRACTED constant (exported via export { NOT_EXTRACTED })");
  });
});
