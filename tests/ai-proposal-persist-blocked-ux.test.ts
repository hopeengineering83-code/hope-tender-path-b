/**
 * Source-inspection test for the ai-proposal route's persist-blocked UX gap
 * fix (audit gap G5).
 *
 * Previously, when the central generation gate blocked the persist of a
 * GeneratedDocument, the route still returned `{ success: true, proposal, ... }`
 * with no indication that the proposal was NOT saved. The audit called this a
 * UX gap: the user receives no signal that they need to fix tender-level
 * blockers before their draft will be persisted.
 *
 * The fix tracks `persistBlocked` + `persistBlockerCode` + `persistBlockerDetail`
 * and surfaces them in the response when the gate blocks the persist.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("ai-proposal route — persistBlocked UX signal (G5 fix)", () => {
  const src = read("app/api/tenders/[id]/ai-proposal/route.ts");

  it("declares persistBlocked tracking variables before the gate call", () => {
    assert.ok(
      src.includes("let persistBlocked = false;"),
      "must declare persistBlocked tracking variable",
    );
    assert.ok(
      src.includes("let persistBlockerCode: string | null = null;"),
      "must declare persistBlockerCode tracking variable",
    );
    assert.ok(
      src.includes("let persistBlockerDetail: string | null = null;"),
      "must declare persistBlockerDetail tracking variable",
    );
  });

  it("sets persistBlocked = true when the gate fails", () => {
    const gateFailIdx = src.indexOf("if (!centralGate.ok) {");
    const setBlockedIdx = src.indexOf("persistBlocked = true;");
    assert.ok(gateFailIdx > -1, "must have gate-fail branch");
    assert.ok(setBlockedIdx > -1, "must set persistBlocked = true");
    assert.ok(
      setBlockedIdx > gateFailIdx,
      "persistBlocked = true must be set inside the gate-fail branch",
    );
  });

  it("captures blockerCode and blockerDetail from the gate result", () => {
    // The gate's blockerCode/blockerDetail can be undefined; the route coerces
    // to null with ?? so the response type stays string | null.
    assert.ok(
      src.includes("persistBlockerCode = centralGate.blockerCode ?? null;"),
      "must capture persistBlockerCode from centralGate.blockerCode (coerced to null)",
    );
    assert.ok(
      src.includes("persistBlockerDetail = centralGate.blockerDetail ?? null;"),
      "must capture persistBlockerDetail from centralGate.blockerDetail (coerced to null)",
    );
  });

  it("surfaces persistBlocked in the success response when set", () => {
    // The response must conditionally include persistBlocked fields so the
    // client can show the user that the proposal was NOT saved.
    assert.ok(
      src.includes("...(persistBlocked ? {"),
      "response must conditionally spread persistBlocked fields",
    );
    assert.ok(
      src.includes("persistBlocked: true,"),
      "response must include persistBlocked: true when blocked",
    );
    assert.ok(
      src.includes("persistBlockerCode,"),
      "response must include persistBlockerCode when blocked",
    );
    assert.ok(
      src.includes("persistBlockerDetail,"),
      "response must include persistBlockerDetail when blocked",
    );
  });
});
