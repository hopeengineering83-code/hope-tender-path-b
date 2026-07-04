/**
 * Regression tests for the legacy-tender-reconciliation module.
 *
 * The module is currently dead code (zero production callers — see audit
 * agent-ffd8fd85). These tests pin the detector logic so that:
 *   1. The four unique detector categories are preserved for future wiring.
 *   2. The obvious bugs (unused import, unsafe JSON.parse) are caught if
 *      they regress.
 *   3. The module's shape (exports, types, dry-run contract) is locked.
 *
 * These are source-inspection + pure-logic tests (no DB) because the
 * module's reconcileTender function requires a PrismaClient. A future
 * integration test can exercise the full function against a real DB.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("legacy-tender-reconciliation — module shape and detector logic", () => {
  const src = read("lib/engine/legacy-tender-reconciliation.ts");

  it("exports reconcileTender function", () => {
    assert.ok(
      src.includes("export async function reconcileTender"),
      "must export reconcileTender",
    );
  });

  it("exports ReconciliationFinding, ReconciliationReport, ReconciliationOptions types", () => {
    assert.ok(src.includes("export type ReconciliationFinding"), "must export ReconciliationFinding");
    assert.ok(src.includes("export type ReconciliationReport"), "must export ReconciliationReport");
    assert.ok(src.includes("export type ReconciliationOptions"), "must export ReconciliationOptions");
  });

  it("does NOT import isGroundedEvidence (unused import removed)", () => {
    // The previous version imported isGroundedEvidence but never called it.
    // The detector uses field.isGrounded from the resolver's output instead.
    assert.ok(
      !src.includes('import { isGroundedEvidence } from "./evidence-grounding"'),
      "isGroundedEvidence import must be removed (unused — detector uses field.isGrounded)",
    );
  });

  it("wraps JSON.parse of audit metadata in try/catch (safe idempotency check)", () => {
    // The idempotency check parses existing.metadata. A malformed string
    // (e.g., from a manual DB edit) would throw and abort the reconciliation.
    // The fix wraps it in try/catch — fail-open for the idempotency check.
    const parseIdx = src.indexOf("JSON.parse(existing.metadata)");
    const tryIdx = src.lastIndexOf("try {", parseIdx);
    const catchIdx = src.indexOf("} catch {", parseIdx);
    assert.ok(parseIdx > -1, "must call JSON.parse on existing.metadata");
    assert.ok(tryIdx > -1, "must have a try block before JSON.parse");
    assert.ok(catchIdx > -1, "must have a catch block after JSON.parse");
    assert.ok(tryIdx < parseIdx, "try must come before JSON.parse");
    assert.ok(catchIdx > parseIdx, "catch must come after JSON.parse");
  });

  it("reconcileTender enforces dryRun || idempotencyKey || confirmedBy before mutating", () => {
    // The mutation block must be gated on all three conditions.
    assert.ok(
      src.includes('if (!options.dryRun && options.idempotencyKey && options.confirmedBy)'),
      "mutation block must be gated on !dryRun && idempotencyKey && confirmedBy",
    );
  });

  it("detector 1: checks for raw/effective contradictions", () => {
    assert.ok(
      src.includes("field.rawValue && field.effectiveValue && field.rawValue !== field.effectiveValue"),
      "must detect raw-vs-effective contradictions",
    );
  });

  it("detector 2: checks for stale source evidence (fileId not in active files)", () => {
    assert.ok(
      src.includes("field.sourceFileId && !activeFileIds.has(field.sourceFileId)"),
      "must detect stale source fileId",
    );
  });

  it("detector 3: checks for invalid page provenance (sourcePage > totalPages)", () => {
    assert.ok(
      src.includes("field.sourcePage > file.totalPages"),
      "must detect sourcePage exceeding totalPages",
    );
  });

  it("detector 4: checks for orphaned MANDATORY requirements", () => {
    assert.ok(
      src.includes('req.priority === "MANDATORY"'),
      "must check MANDATORY requirements for orphaned source files",
    );
    assert.ok(
      src.includes("!req.sourceTenderFileId || !activeFileIds.has(req.sourceTenderFileId)"),
      "must detect requirements with missing or inactive sourceTenderFileId",
    );
  });

  it("detector 5: informational check for stale GeneratedDocument rows", () => {
    assert.ok(
      src.includes('d.generationStatus === "SUPERSEDED" || d.reviewStatus === "REJECTED"'),
      "must count superseded/rejected GeneratedDocument rows as info findings",
    );
  });

  it("mutation clears stale evidence (sets to null, does NOT delete)", () => {
    // The mutation must set sourceTenderFileId and sourcePageNumber to null
    // for stale requirement evidence — never delete the requirement itself.
    assert.ok(
      src.includes("data: { sourceTenderFileId: null, sourcePageNumber: null }"),
      "must clear stale evidence by setting to null (not deleting)",
    );
  });

  it("mutation writes an audit record with TENDER_RECONCILIATION action", () => {
    assert.ok(
      src.includes('action: "TENDER_RECONCILIATION"'),
      "must write an audit record with action TENDER_RECONCILIATION",
    );
    assert.ok(
      src.includes("idempotencyKey: options.idempotencyKey"),
      "audit record must include the idempotencyKey in metadata",
    );
  });

  it("mutation wraps requirement update in a transaction", () => {
    assert.ok(
      src.includes("prisma.$transaction"),
      "mutation must run inside a transaction",
    );
  });

  it("returns a ReconciliationReport with findings, summary, and humanReadable", () => {
    assert.ok(src.includes("return {"), "must return an object");
    assert.ok(src.includes("tenderId,"), "must return tenderId");
    assert.ok(src.includes("tenderTitle: tender.title"), "must return tenderTitle");
    assert.ok(src.includes("dryRun: options.dryRun"), "must return dryRun flag");
    assert.ok(src.includes("findings,"), "must return findings array");
    assert.ok(src.includes("summary,"), "must return summary object");
    assert.ok(src.includes("humanReadable: lines.join"), "must return humanReadable string");
  });
});
