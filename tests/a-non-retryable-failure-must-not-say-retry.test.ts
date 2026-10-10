import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { publicJobFailureMessage } from "../lib/prisma-schema-compatibility";

/**
 * THE DEFECT, read off two hosted acceptance runs.
 * ------------------------------------------------
 * AUTO_FINALIZE names the documents it could not converge:
 *
 *   throw new Error(`AUTO_FINALIZE_NOT_CONVERGED — ${result.blockers.join("; ")}`)
 *
 * That list is the only actionable thing about the failure. It fell into the
 * generic branch of publicJobFailureMessage and reached the owner as:
 *
 *   "The background job could not complete. Retry once; if it fails again,
 *    share the reference with an administrator. Reference: e868c168"
 *
 * The advice is not merely unhelpful, it is wrong: this blocker is classified
 * NON_RETRYABLE by stage-retry-policy precisely because the state does not
 * change on its own, so "retry once" sends the owner to burn a retry on a
 * condition that cannot resolve itself. Two runs were diagnosed by guessing
 * because of it.
 *
 * This mirrors the treatment TITLE_SOURCE_PROVENANCE_INVALID already gets in
 * the same function: keep the code, keep the instruction, keep the reference.
 */

const REF = "e868c168";

describe("a non-retryable failure never tells the owner to retry", () => {
  it("keeps the blocker list AUTO_FINALIZE recorded", () => {
    const message = publicJobFailureMessage(
      new Error("AUTO_FINALIZE_NOT_CONVERGED — Technical Proposal.pdf: blocked by hygiene; Company Profile.docx: unvalidated"),
      REF,
    );
    assert.match(message, /AUTO_FINALIZE_NOT_CONVERGED/);
    assert.match(message, /Technical Proposal\.pdf: blocked by hygiene/);
    assert.match(message, /Company Profile\.docx: unvalidated/);
    assert.match(message, new RegExp(REF));
  });

  it("does not advise a retry that cannot help", () => {
    const message = publicJobFailureMessage(
      new Error("AUTO_FINALIZE_NOT_CONVERGED — Technical Proposal.pdf: blocked by hygiene"),
      REF,
    );
    assert.doesNotMatch(message, /Retry once/i);
    assert.match(message, /Retrying will not help/i);
  });

  it("says so plainly when the failure recorded no blockers at all", () => {
    // A reason that is empty must read as empty, not as a blocker list.
    const message = publicJobFailureMessage(new Error("AUTO_FINALIZE_NOT_CONVERGED"), REF);
    assert.match(message, /recorded no blocker list/i);
    assert.match(message, new RegExp(REF));
  });

  it("leaves every other failure shape exactly as it was", () => {
    // The generic fallback is still the right answer for an unrecognised
    // error, and the existing special cases must not be disturbed.
    assert.match(
      publicJobFailureMessage(new Error("connect ETIMEDOUT 10.0.0.1:5432"), REF),
      /The background job could not complete\. Retry once/,
    );
    assert.match(
      publicJobFailureMessage(new Error("ENGINE_SOURCE_REVISION_STALE"), REF),
      /superseded/i,
    );
    assert.match(
      publicJobFailureMessage(new Error("Tender not found"), REF),
      /required source record no longer exists/i,
    );
  });

  it("redacts a secret that reached the blocker text", () => {
    // The blockers are document names and readiness codes, but this message is
    // shown to a user, so it is not trusted to be clean.
    const message = publicJobFailureMessage(
      new Error("AUTO_FINALIZE_NOT_CONVERGED — failed calling provider with sk-ant-api03-SUPERSECRETVALUE1234567890"),
      REF,
    );
    assert.doesNotMatch(message, /SUPERSECRETVALUE1234567890/);
  });

  it("bounds the length, so one failure cannot flood the surface", () => {
    const message = publicJobFailureMessage(
      new Error(`AUTO_FINALIZE_NOT_CONVERGED — ${"Document.pdf: blocked; ".repeat(200)}`),
      REF,
    );
    assert.ok(message.length < 700, `message was ${message.length} characters`);
  });
});
