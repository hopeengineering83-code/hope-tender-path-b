/**
 * A ready package may not name a blocker.
 *
 * Found on a live READY tender whose ZIP downloads (HTTP 200, three DOCX):
 * GET /api/tenders/[id]/export-readiness answered
 *
 *   { ok: true, status: "READY", blockers: [],
 *     primaryBlockerReason: "Evaluation criteria were not extracted — verify
 *                            scoring manually before export." }
 *
 * That string is an advisory the same payload lists under `warnings` and
 * marks LOW/non-blocking. The envelope's `blockers[0] ?? warnings[0]`
 * fallback promoted it into a field whose name asserts the opposite.
 *
 * The same route's nested `exportReadiness.primaryBlockerReason` answered
 * null for that package, so one response carried two answers to one
 * question — the failure mode this repository keeps producing: one rule
 * written in two places whose copies disagree.
 *
 * Nothing rendered the contradiction, because both current consumers guard
 * on `!ok` first. That is the reason this is worth pinning rather than a
 * reason to leave it: the next surface to read the field without that guard
 * would tell an owner their downloadable package is blocked.
 *
 * The advisory is not suppressed anywhere — it stays in `warnings` with its
 * own nextAction. Only the blocker-named fields go quiet when there is no
 * blocker.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildPublicReadinessEnvelope,
  assertPublicReadinessAgreement,
} from "../lib/engine/public-readiness-envelope";

const ADVISORY = {
  code: "EVALUATION_CRITERIA_ADVISORY",
  message: "Evaluation criteria were not extracted — verify scoring manually before export.",
  nextAction: "Review the tender document for any scoring/evaluation section.",
  severity: "LOW",
};

const COUNTS = {
  requiredDocumentsTotal: 3,
  generatedDocumentsTotal: 6,
  exportReadyDocumentsTotal: 3,
};

describe("public readiness envelope: primary blocker fields", () => {
  it("names no blocker on the exact live READY payload", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: true,
      blockers: [],
      warnings: [ADVISORY],
      primaryBlockerReason: null,
      primaryFixAction: null,
      ...COUNTS,
    });

    assert.equal(envelope.status, "READY");
    assert.equal(envelope.ok, true);
    assert.equal(envelope.blockers.length, 0);
    assert.equal(
      envelope.primaryBlockerReason,
      null,
      `a ready package has no primary blocker; got ${JSON.stringify(envelope.primaryBlockerReason)}`,
    );
    assert.equal(envelope.primaryFixAction, null, "and no blocker fix action");
  });

  it("still publishes the advisory, so nothing is hidden", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: true, blockers: [], warnings: [ADVISORY], ...COUNTS,
    });
    assert.equal(envelope.warnings.length, 1);
    assert.match(envelope.warnings[0]!.message, /Evaluation criteria/);
    assert.match(String(envelope.warnings[0]!.nextAction), /scoring\/evaluation section/);
  });

  it("does not let a caller-supplied reason survive a READY verdict", () => {
    // A caller passing a stale reason must not be able to reintroduce the
    // contradiction through the input fields either.
    const envelope = buildPublicReadinessEnvelope({
      ok: true,
      blockers: [],
      warnings: [],
      primaryBlockerReason: "Export gate is not satisfied.",
      primaryFixAction: "Resolve all export gate blockers.",
      ...COUNTS,
    });
    assert.equal(envelope.status, "READY");
    assert.equal(envelope.primaryBlockerReason, null);
    assert.equal(envelope.primaryFixAction, null);
  });

  it("keeps naming the blocker when the package really is blocked", () => {
    const envelope = buildPublicReadinessEnvelope({
      ok: false,
      blockers: [{
        code: "DOCUMENTS_NOT_GENERATED",
        message: "2 required document(s) are planned but not generated.",
        nextAction: "Run Engine to generate the planned documents.",
        severity: "HIGH",
      }],
      warnings: [ADVISORY],
      ...COUNTS,
      exportReadyDocumentsTotal: 0,
    });

    assert.equal(envelope.status, "BLOCKED");
    assert.match(String(envelope.primaryBlockerReason), /planned but not generated/);
    assert.match(String(envelope.primaryFixAction), /Run Engine/);
  });

  it("still surfaces a reason when the block has no itemised blocker", () => {
    // ok:false with an empty blocker list is the case the warnings fallback
    // was written for. A blocked owner must still be told something, so that
    // path is kept — it is only the READY case that goes quiet.
    const envelope = buildPublicReadinessEnvelope({
      ok: false, blockers: [], warnings: [ADVISORY], ...COUNTS,
    });
    assert.equal(envelope.ok, false);
    assert.match(String(envelope.primaryBlockerReason), /Evaluation criteria/);
  });

  it("reports the contradiction as a contradiction", () => {
    const honest = buildPublicReadinessEnvelope({
      ok: true, blockers: [], warnings: [ADVISORY], ...COUNTS,
    });
    assert.deepEqual(assertPublicReadinessAgreement([honest]), { ok: true, contradictions: [] });

    // Hand-built payload of the shape the envelope used to produce.
    const contradictory = { ...honest, primaryBlockerReason: ADVISORY.message };
    const verdict = assertPublicReadinessAgreement([contradictory]);
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.contradictions.some((c) => /ready payload names a primary blocker/i.test(c)),
      `agreement check must catch it; got ${JSON.stringify(verdict.contradictions)}`,
    );
  });
});
