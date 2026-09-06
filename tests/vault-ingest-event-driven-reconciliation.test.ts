// Source-text contract test: VAULT_INGEST now triggers event-driven
// requirement-coverage reconciliation for the company's active tenders
// after ingestion completes.
//
// Before this fix, reconciliation only ran inside ENGINE_RUN and on the
// manual "Request recovery" endpoint at
// /api/tenders/:id/requirement-coverage/auto-sync. A tender whose only
// change was "the company just uploaded a new Expert CV that satisfies
// one of its mandatory EXPERT requirements" had to wait for the next
// Engine run, or for a user to open the Requirements and Evidence panel
// and click "Request recovery". That violated the "durable, revision-
// bound, event-driven — not dependent on opening the panel" contract.
//
// This test proves the wiring at the source level: the VAULT_INGEST
// handler imports reconcileAutomaticRequirementCoverage, calls it for
// each of the company's active (non-final) tenders after vault.complete,
// records a vault.coverage-reconciled step, and never lets a per-tender
// failure block the overall job.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const handler = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

describe("VAULT_INGEST triggers event-driven requirement-coverage reconciliation", () => {
  it("imports reconcileAutomaticRequirementCoverage", () => {
    assert.match(
      handler,
      /import \{[^}]*reconcileAutomaticRequirementCoverage[^}]*\} from "\.\/engine\/reconcile-automatic-requirement-coverage"/,
    );
  });

  it("calls reconcileAutomaticRequirementCoverage for each active tender after vault.complete", () => {
    const completeIdx = handler.indexOf('stepName: "vault.complete"');
    assert.ok(completeIdx > -1, "vault.complete step must exist");
    const region = handler.slice(completeIdx, completeIdx + 4000);
    assert.match(region, /reconcileAutomaticRequirementCoverage\(/);
    assert.match(region, /prisma\.tender\.findMany/);
    assert.match(region, /status: \{ notIn: \["ARCHIVED", "WITHDRAWN", "NO_BID"\] \}/);
  });

  it("records a vault.coverage-reconciled step", () => {
    assert.match(handler, /stepName: "vault\.coverage-reconciled"/);
  });

  it("never lets a per-tender reconciliation failure block the overall VAULT_INGEST job", () => {
    const completeIdx = handler.indexOf('stepName: "vault.complete"');
    const region = handler.slice(completeIdx, completeIdx + 5000);
    // The per-tender try/catch logs a warning but does not re-throw.
    assert.match(region, /catch \(error\) \{[\s\S]*?reconcileFailures \+= 1/);
    // The outer try/catch wraps the entire sweep.
    assert.match(region, /catch \(error\) \{[\s\S]*?logger\.warn\("\[job-handler\] VAULT_INGEST coverage reconciliation sweep failed"/);
  });
});

describe("automaticStateFor binds AUTO_RESOLVING to the exact requirement", () => {
  const route = readFileSync("app/api/tenders/[id]/requirement-coverage/route.ts", "utf8");

  it("only returns AUTO_RESOLVING when the requirement itself lacks source trace", () => {
    const idx = route.indexOf("function automaticStateFor(");
    assert.ok(idx > -1, "automaticStateFor must exist");
    const region = route.slice(idx, idx + 1500);
    // The condition must be `resolverRunning && !hasSourceRef`, not just `resolverRunning`.
    assert.match(region, /if \(input\.resolverRunning && !input\.hasSourceRef\) return "AUTO_RESOLVING"/);
    // The old "resolverRunning alone implies AUTO_RESOLVING" branch must not remain.
    assert.doesNotMatch(region, /if \(input\.resolverRunning\) return "AUTO_RESOLVING"/);
  });
});
