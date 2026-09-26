// Two subsystems described the same requirement in two languages, and the gate
// was fluent in only one.
//
// The Engine grades requirements SUPPORTED / EVIDENCE_PENDING_REVIEW / PARTIAL
// / UNSUPPORTED. Every release gate counts FULL / SUBSTANTIAL. Nothing
// translated. So an Engine row reading SUPPORTED — its strongest verdict,
// meaning reviewed or selected evidence is on file — counted for exactly
// nothing, and a requirement backed by real selected projects sat uncovered
// beside a panel asking the owner for evidence they had already provided.
//
// The translation happens at the write site so that one vocabulary reaches the
// database and every reader after it. These tests pin the mapping in both
// directions: what must now count, and what must still not.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { toCanonicalSupportLevel } from "../lib/engine/compliance";

describe("the Engine records support in the vocabulary the gates count", () => {
  it("maps SUPPORTED to SUBSTANTIAL, so real selected evidence finally counts", () => {
    assert.equal(toCanonicalSupportLevel("SUPPORTED"), "SUBSTANTIAL");
  });

  it("does not promote it to FULL", () => {
    // FULL is for a generated artifact whose bytes exist and validate, or a
    // record whose required facets all match. Selected evidence on file is
    // SUBSTANTIAL. Mapping to the lower counting level keeps the claim honest.
    assert.notEqual(toCanonicalSupportLevel("SUPPORTED"), "FULL");
  });

  it("keeps evidence awaiting review out of the count", () => {
    // The half that protects the gate: evidence a human has not looked at is
    // not evidence that counts, and must not become countable by translation.
    assert.equal(toCanonicalSupportLevel("EVIDENCE_PENDING_REVIEW"), "PARTIAL");
  });

  it("leaves PARTIAL and UNSUPPORTED exactly as they were", () => {
    assert.equal(toCanonicalSupportLevel("PARTIAL"), "PARTIAL");
    assert.equal(toCanonicalSupportLevel("UNSUPPORTED"), "UNSUPPORTED");
    // An unrecognised status must pass through untouched rather than being
    // guessed upward into something countable.
    assert.equal(toCanonicalSupportLevel("SOMETHING_NEW"), "SOMETHING_NEW");
  });

  it("is applied where the row is persisted", () => {
    const engine = readFileSync("lib/engine/run-tender-engine.ts", "utf8");
    assert.match(engine, /supportLevel: toCanonicalSupportLevel\(matrix\.supportStatus\)/);
    assert.doesNotMatch(
      engine,
      /supportLevel: matrix\.supportStatus,/,
      "the untranslated status must not reach the database",
    );
  });

  it("still counts rows written before the translation existed", () => {
    // Historical rows say SUPPORTED. Dropping them from the dashboard count
    // would make a tender look worse than it is for no reason.
    const dashboard = readFileSync("app/dashboard/compliance/compliance-dashboard.tsx", "utf8");
    assert.match(dashboard, /\["SUBSTANTIAL", "FULL", "SUPPORTED"\]\.includes\(r\.supportLevel\)/);
  });
});
