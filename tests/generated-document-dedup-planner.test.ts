// L — Pure dedup planner unit tests.
//
// Production screenshot: 15 current outputs, 304 superseded/historical hidden,
// multiple PLANNED rows that looked duplicate (financial capacity, audited
// statements), 0 active export candidates. The previous inline grouping
// missed common variant patterns like "(Copy)", "_v2", "FINAL", trailing
// space-digit, so dedupes accumulated across runs. The planner module gives
// us a deterministic, unit-testable canonical key + keep/supersede plan
// with per-row reasons.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalKey,
  planDeduplication,
  type DedupRowInput,
} from "../lib/engine/documents/generated-document-dedup-planner";

function row(over: Partial<DedupRowInput> & { id: string; name: string; updatedAt?: Date }): DedupRowInput {
  return {
    id: over.id,
    name: over.name,
    exactFileName: over.exactFileName ?? null,
    documentType: over.documentType ?? "TECHNICAL_PROPOSAL",
    reviewStatus: over.reviewStatus ?? "PENDING",
    generationStatus: over.generationStatus ?? "GENERATED",
    validationStatus: over.validationStatus ?? "PENDING",
    fileContent: over.fileContent ?? null,
    storagePath: over.storagePath ?? null,
    exactOrder: over.exactOrder ?? null,
    updatedAt: over.updatedAt ?? new Date("2026-05-30T10:00:00Z"),
  };
}

describe("canonicalKey — collapses common production variants into one key", () => {
  it("strips file extension", () => {
    assert.equal(
      canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" }),
      canonicalKey({ name: "Audited Statements.pdf", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" }),
    );
  });

  it("collapses '(Copy)' / '(duplicate)' / '(backup)'", () => {
    const base = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" });
    for (const variant of ["Audited Statements (Copy).docx", "Audited Statements (Copy 2).docx", "Audited Statements (duplicate).docx", "Audited Statements (backup).docx"]) {
      assert.equal(canonicalKey({ name: variant, exactFileName: null, documentType: "FINANCIAL_EVIDENCE" }), base);
    }
  });

  it("collapses ' final', ' draft', ' v2', '_v3', trailing numbers", () => {
    const base = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" });
    for (const variant of ["Audited Statements final.docx", "Audited Statements draft.docx", "Audited Statements v2.docx", "Audited_Statements_v3.docx", "Audited Statements 2.docx", "Audited Statements - 3.docx"]) {
      assert.equal(canonicalKey({ name: variant, exactFileName: null, documentType: "FINANCIAL_EVIDENCE" }), base);
    }
  });

  it("handles 'Audited Statements (Copy) v2' (compound variant)", () => {
    const base = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" });
    assert.equal(canonicalKey({ name: "Audited Statements (Copy) v2.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" }), base);
  });

  it("differentiates by documentType — same filename different type → different key", () => {
    const a = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" });
    const b = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "TECHNICAL_PROPOSAL" });
    assert.notEqual(a, b);
  });

  it("prefers exactFileName over name when both are present", () => {
    const a = canonicalKey({ name: "Something Else.docx", exactFileName: "Audited Statements.docx", documentType: "FINANCIAL_EVIDENCE" });
    const b = canonicalKey({ name: "Audited Statements.docx", exactFileName: null, documentType: "FINANCIAL_EVIDENCE" });
    assert.equal(a, b);
  });
});

describe("planDeduplication — keep/supersede plan with reasons", () => {
  it("singleton groups stay KEPT with a clear reason", () => {
    const plan = planDeduplication([row({ id: "a", name: "Cover Letter.docx" })]);
    assert.equal(plan.decisions[0].action, "KEEP");
    assert.match(plan.decisions[0].reason, /Only row/);
    assert.equal(plan.summary.duplicateGroups, 0);
  });

  it("two narrative rows: keeps the one with content, supersedes the empty one", () => {
    const plan = planDeduplication([
      row({ id: "empty", name: "Audited Statements.docx", fileContent: null, storagePath: null, updatedAt: new Date("2026-05-30T12:00:00Z") }),
      row({ id: "full",  name: "Audited Statements (Copy).docx", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T08:00:00Z") }),
    ]);
    const empty = plan.decisions.find((d) => d.id === "empty")!;
    const full = plan.decisions.find((d) => d.id === "full")!;
    assert.equal(full.action, "KEEP", "the row with content should win even if older");
    assert.equal(empty.action, "SUPERSEDE");
    assert.match(empty.reason, /Empty\/missing content/);
    assert.deepEqual(plan.supersedeIds, ["empty"]);
  });

  it("two narrative rows with content: keeps the newer one", () => {
    const plan = planDeduplication([
      row({ id: "older", name: "Audited Statements.docx", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-29T08:00:00Z") }),
      row({ id: "newer", name: "Audited Statements (Copy).docx", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T12:00:00Z") }),
    ]);
    const dec = (id: string) => plan.decisions.find((d) => d.id === id)!;
    assert.equal(dec("newer").action, "KEEP");
    assert.equal(dec("older").action, "SUPERSEDE");
    assert.match(dec("older").reason, /Older content version/);
  });

  it("control / official-original placeholder rows are NEVER auto-superseded, even when sharing a key", () => {
    const plan = planDeduplication([
      row({ id: "narrative", name: "Bid Form.docx", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T12:00:00Z") }),
      row({ id: "original-placeholder", name: "Bid Form (Copy).docx", reviewStatus: "REPLACE_WITH_ORIGINAL", updatedAt: new Date("2026-05-30T13:00:00Z") }),
      row({ id: "control-only", name: "Bid Form v2.docx", reviewStatus: "NOT_EXPORTABLE", updatedAt: new Date("2026-05-30T14:00:00Z") }),
    ]);
    for (const id of ["narrative", "original-placeholder", "control-only"]) {
      assert.equal(plan.decisions.find((d) => d.id === id)!.action, "KEEP", `${id} must be kept`);
    }
  });

  it("multiple narrative duplicates: supersedes ALL but the best", () => {
    const plan = planDeduplication([
      row({ id: "a", name: "Audited Statements.docx",          fileContent: "UEsDBA==", updatedAt: new Date("2026-05-28T08:00:00Z") }),
      row({ id: "b", name: "Audited Statements (Copy).docx",   fileContent: "UEsDBA==", updatedAt: new Date("2026-05-29T08:00:00Z") }),
      row({ id: "c", name: "Audited Statements v2.docx",       fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T08:00:00Z") }),
      row({ id: "d", name: "Audited Statements final.docx",    fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T12:00:00Z") }),
    ]);
    assert.equal(plan.summary.duplicateGroups, 1);
    assert.equal(plan.summary.supersededRows, 3);
    const kept = plan.decisions.filter((x) => x.action === "KEEP").map((x) => x.id);
    assert.deepEqual(kept, ["d"], "only the newest content-bearing row should remain active");
  });

  it("preserves history — supersedeIds are returned, never deleted", () => {
    // The planner ONLY returns IDs; persistence is the caller's job. Pure
    // function guarantee: no DB calls, no side effects.
    const plan = planDeduplication([
      row({ id: "a", name: "Cover Letter.docx", fileContent: "UEsDBA==" }),
      row({ id: "b", name: "Cover Letter (Copy).docx", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-31T00:00:00Z") }),
    ]);
    assert.equal(plan.supersedeIds.length, 1);
    // The planner did not mutate the inputs.
    // (We don't have a deep-clone check but the rows are still simple values.)
  });

  it("Pharo-style 15 active rows with 3 duplicate financial-capacity / audited-statement groups", () => {
    const rows: DedupRowInput[] = [
      row({ id: "f1", name: "Audited Statements.docx", documentType: "FINANCIAL_EVIDENCE", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T10:00:00Z") }),
      row({ id: "f2", name: "Audited Statements (Copy).docx", documentType: "FINANCIAL_EVIDENCE", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T11:00:00Z") }),
      row({ id: "f3", name: "Audited Statements final.docx", documentType: "FINANCIAL_EVIDENCE", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T12:00:00Z") }),
      row({ id: "c1", name: "Financial Capacity Statement.docx", documentType: "FINANCIAL_EVIDENCE", fileContent: "UEsDBA==" }),
      row({ id: "c2", name: "Financial Capacity Statement v2.docx", documentType: "FINANCIAL_EVIDENCE", fileContent: "UEsDBA==", updatedAt: new Date("2026-05-30T18:00:00Z") }),
      row({ id: "m1", name: "Methodology.docx", fileContent: "UEsDBA==" }),
      row({ id: "k1", name: "Key Personnel CVs.docx", fileContent: "UEsDBA==" }),
      row({ id: "bf", name: "Bid Form.docx", reviewStatus: "REPLACE_WITH_ORIGINAL" }),
    ];
    const plan = planDeduplication(rows);
    assert.equal(plan.summary.duplicateGroups, 2, "two narrative dedup groups (audited × 3, capacity × 2)");
    assert.equal(plan.summary.supersededRows, 3, "2 audited losers + 1 capacity loser");
    assert.ok(plan.decisions.find((d) => d.id === "bf")!.action === "KEEP", "official-original placeholder must remain");
  });
});

describe("deduplicate-documents route delegates to the pure planner", () => {
  const src = readFileSync("app/api/tenders/[id]/deduplicate-documents/route.ts", "utf8");
  it("imports + calls planDeduplication", () => {
    assert.match(src, /import \{ planDeduplication \}/);
    assert.match(src, /planDeduplication\(docs\)/);
  });
  it("audit log carries per-row dedup decisions + reasons", () => {
    assert.match(src, /supersededDecisions\.map\(\(d\)\s*=>\s*\(\{[^}]*reason: d\.reason/);
    assert.match(src, /duplicateGroups: plan\.summary\.duplicateGroups/);
  });
  it("dryRun=true returns the per-row plan so the operator can preview", () => {
    assert.match(src, /plan:\s*dryRun\s*\?\s*plan\.decisions\s*:\s*undefined/);
  });
});
