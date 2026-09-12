import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression pin for two halves of the same live-tender failure:
//
//   "missing planned documents and safe repairs are automatically handled"
//   ...and yet the workflow stopped on an auto-resolvable missing-document
//   blocker, because:
//
//   (a) the confirmed Build Plan still demanded
//       "Financial Proposal Omission.docx" — a file invented from a rule — and
//       the plan's freshness hash is computed over its STORED items, so
//       correcting the classifier could not stale it; and
//   (b) the automatic chain never generated a missing planned file at all. It
//       repaired, validated and finalised documents that already existed, then
//       reported the shortfall as a terminal blocker, while the only thing that
//       could create those files was a button the owner had to press.

import { findNonDeliverablePlanItems } from "../lib/engine/build-plan";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function planItem(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: "c1",
    exactFileName: "Technical Proposal.pdf",
    exactOrder: 1,
    documentType: "TECHNICAL_PROPOSAL",
    required: true,
    format: "PDF",
    envelope: "TECHNICAL",
    sourceRequirementIds: [],
    notes: null,
    ...overrides,
  } as never;
}

describe("A confirmed plan demanding a rule-not-a-file is stale", () => {
  it("finds the live tender's phantom deliverable in a stored plan", () => {
    const phantom = findNonDeliverablePlanItems([
      planItem(),
      planItem({ canonicalId: "c2", exactFileName: "Financial Proposal Omission.docx", exactOrder: 2, format: "DOCX" }),
    ]);
    assert.equal(phantom.length, 1);
    assert.equal(phantom[0].exactFileName, "Financial Proposal Omission.docx");
    assert.ok(phantom[0].rationale.length > 0, "the blocker must say why the item is not a deliverable");
  });

  it("leaves a plan of genuine deliverables alone", () => {
    const phantom = findNonDeliverablePlanItems([
      planItem(),
      planItem({ canonicalId: "c2", exactFileName: "Expert CVs.docx", exactOrder: 2, format: "DOCX" }),
      planItem({ canonicalId: "c3", exactFileName: "Financial Proposal Form.xlsx", exactOrder: 3, format: "XLSX" }),
      planItem({ canonicalId: "c4", exactFileName: "Bill of Quantities.xlsx", exactOrder: 4, format: "XLSX" }),
    ]);
    assert.deepEqual(phantom, []);
  });

  it("ignores items with no file name rather than inventing a blocker", () => {
    assert.deepEqual(findNonDeliverablePlanItems([planItem({ exactFileName: "" })]), []);
  });

  it("flags only positively-identified rules, never the classifier's catch-all", () => {
    // shouldBePlannedFile is false for four categories and only two of them are
    // phantoms. ORIGINAL_EVIDENCE_ATTACHMENT is a real document that is
    // attached rather than generated, and INTERNAL_COMPLIANCE_CONTROL is the
    // catch-all for text the classifier does not recognise. Treating the
    // catch-all as a phantom fail-closed every confirmed plan carrying a
    // tersely-named item — caught by the metadata-evidence PostgreSQL proof on
    // a plan item named "1.docx".
    assert.deepEqual(findNonDeliverablePlanItems([
      planItem({ exactFileName: "1.docx" }),
      planItem({ canonicalId: "c2", exactFileName: "2.docx", exactOrder: 2 }),
      planItem({ canonicalId: "c3", exactFileName: "Annex A.pdf", exactOrder: 3 }),
    ]), [], "an unrecognised file name is not evidence that the item is a rule");
  });

  it("the confirmed-plan resolver fails closed on a phantom item", () => {
    const src = read("lib/engine/build-plan.ts");
    assert.ok(src.includes("findNonDeliverablePlanItems(items)"),
      "getCurrentConfirmedBuildPlan must check the stored items against current classification");
    const check = src.indexOf("const phantomItems = findNonDeliverablePlanItems(items);");
    const hashCheck = src.indexOf("const hashOk =");
    assert.ok(check > 0 && check < hashCheck,
      "the phantom check must run regardless of the hash — the hash is computed over the stored items and cannot notice this");
    assert.match(src.slice(check, check + 900), /Run Engine to rebuild and re-confirm the plan/);
  });
});

describe("AUTO_FINALIZE generates the planned files the package is missing", () => {
  const service = read("lib/ai-jobs/auto-finalize-continuation-service.ts");

  it("runs the missing-file generation stage", () => {
    assert.ok(service.includes("auto-finalize.missing-file-generation"), "the stage must be recorded");
    assert.ok(service.includes("generateMissingPlanFiles"), "the stage must call the shared implementation");
  });

  it("generates BEFORE repair, validation and PDF finalisation", () => {
    // A file created after validation would be reported unvalidated forever.
    const generate = service.indexOf("auto-finalize.missing-file-generation");
    const repair = service.indexOf("auto-finalize.export-repair");
    const validate = service.indexOf("auto-finalize.canonical-validation");
    const pdf = service.indexOf("auto-finalize.pdf-finalization");
    assert.ok(generate > 0 && generate < repair, "generation must precede export repair");
    assert.ok(generate < validate, "generation must precede canonical validation");
    assert.ok(generate < pdf, "generation must precede PDF finalisation");
  });

  it("runs the same implementation the API route runs", () => {
    const route = read("app/api/tenders/[id]/generate-missing-plan-files/route.ts");
    assert.ok(route.includes("generateMissingPlanFiles"),
      "the route must be a thin wrapper over the shared implementation");
    assert.ok(!route.includes("withTransactionalGenerationGate"),
      "the route must not keep a second copy of the persistence logic");
  });

  it("keeps every fail-closed gate on the shared path", () => {
    const shared = read("lib/engine/missing-plan-file-generation.ts");
    for (const gate of [
      "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      "ANALYSIS_FROM_WEAK_EXTRACTION",
      "ANALYSIS_FROM_PARTIAL_EXTRACTION",
      "MISSING_CLIENT_DETAILS",
      "assertTenderReadyForGenerationAndExport",
      "getCurrentConfirmedBuildPlan",
      "resolveTenderOperationGate",
      "withTransactionalGenerationGate",
      "BUILD_PLAN_CHANGED_BEFORE_PERSISTENCE",
    ]) {
      assert.ok(shared.includes(gate), `the shared implementation must still enforce ${gate}`);
    }
  });

  it("still refuses to invent a file that must be an official original", () => {
    const shared = read("lib/engine/missing-plan-file-generation.ts");
    assert.ok(shared.includes("keepPlanned"), "official originals must stay PLANNED, not be generated");
    assert.ok(shared.includes("REQUIRES_ORIGINAL_OR_FORMAT_FINALIZATION"),
      "a row awaiting its original must carry an integrity failure code naming what is awaited");
  });

  it("names why the package is still short instead of reporting a bare count", () => {
    assert.match(service, /automatic generation could not run/);
    assert.match(service, /awaiting the tender-issued original/);
  });
});
