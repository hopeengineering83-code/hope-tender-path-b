// Regression test: both phrasings of the same unresolved stub must fail closed.
//
// proposal-benchmark-guard's normalizeWeakText() rewrites every placeholder,
// TBD, TODO, template variable and AI refusal it cannot resolve into a
// bid-team stub. It emits that stub in two phrasings:
//
//   "Bid-team to confirm before submission."   (one call site)
//   "to be confirmed by bid team"              (every other call site)
//
// Authority review's INTERNAL_NOTE_RE listed only the first. So the rarer
// wording was correctly treated as a CRITICAL BID_TEAM_STUB and blocked export,
// while the dominant wording — the same unresolved value, produced by the same
// function, meaning the same thing — travelled all the way into a client-facing
// tender submission with nothing objecting.
//
// These assert behavior through runAuthorityReview(), not the regex, so the
// guarantee survives a refactor of the pattern.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { runAuthorityReview, type DocumentInput } from "../lib/engine/authority-review";

function reviewContent(content: string) {
  const doc: DocumentInput = {
    id: "doc-1",
    name: "Technical Proposal.docx",
    documentType: "TECHNICAL_PROPOSAL",
    contentSummary: content,
    exactFileName: "Technical Proposal.docx",
  };
  return runAuthorityReview(
    [doc],
    [{ exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL" }],
    [],
  );
}

describe("authority review — bid-team stub phrasings", () => {
  it("blocks the long-recognised phrasing", () => {
    const result = reviewContent("Delivery schedule: Bid-Team to confirm before submission.");
    assert.ok(
      result.blockers.some((b) => b.code === "BID_TEAM_STUB"),
      "the original phrasing must remain a bid-team stub blocker",
    );
    assert.notEqual(result.status, "AUTHORITY_READY");
  });

  it("blocks the phrasing the normalizer actually emits most often", () => {
    const result = reviewContent("Contract value to be confirmed by bid team.");
    assert.ok(
      result.blockers.some((b) => b.code === "BID_TEAM_STUB"),
      "an unresolved stub must block export regardless of which wording produced it",
    );
    assert.ok(
      result.blockers.some((b) => b.severity === "CRITICAL"),
      "an unresolved value reaching a client document is a CRITICAL defect",
    );
    assert.notEqual(
      result.status,
      "AUTHORITY_READY",
      "a document carrying an unresolved stub must never be reported authority-ready",
    );
  });

  it("treats a hyphen or a space in 'bid team' the same way", () => {
    for (const phrasing of [
      "Start date to be confirmed by bid team.",
      "Start date to be confirmed by bid-team.",
    ]) {
      const result = reviewContent(phrasing);
      assert.ok(
        result.blockers.some((b) => b.code === "BID_TEAM_STUB"),
        `"${phrasing}" must be caught — punctuation must not decide whether export is blocked`,
      );
    }
  });

  it("leaves a genuinely resolved document alone", () => {
    const result = reviewContent(
      "Contract value: ETB 24,500,000. Delivery schedule: 18 months from contract signature.",
    );
    assert.ok(
      !result.blockers.some((b) => b.code === "BID_TEAM_STUB" || b.code === "INTERNAL_NOTE"),
      "a document with real values must not be flagged as carrying a stub",
    );
  });
});
