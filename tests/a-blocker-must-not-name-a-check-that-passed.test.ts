import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { exportBlockReason, deriveDocumentOutputState } from "../lib/engine/document-output-state";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-16, the first model-backed package this app has ever produced was
 * refused. The authoritative gate said, verbatim:
 *
 *   blockers: [{"code": "PDF_REQUIRED_NOT_READY", "message": "The document
 *     failed the canonical narrative-quality rubric ..."}]
 *   documentCount=1  failureCount=0  exportReadyDocumentsTotal=0
 *
 * `failureCount=0`. The narrative rubric had PASSED. The sentence naming it was
 * `exportBlockReason("QUALITY_BLOCKED")` — a fixed string asserting a specific
 * authority that the function had no way to know was responsible.
 *
 * `resolveCurrentDocumentVerdict` ORs two independent checks:
 *
 *   score = qualityScore === "BLOCKED" || validation.status === "BLOCKED"
 *
 * and `validateDocumentQuality` blocks on placeholders, AI traces, an empty
 * body, an envelope mismatch, or boilerplate density >= 5 — none of which is
 * the narrative rubric. So `qualityBlocked` records THAT a check refused, never
 * WHICH. Attributing it to the rubric sends the reader to rewrite prose to fix
 * a placeholder.
 *
 * THE FIX IS NOT TO WEAKEN EITHER CHECK so they agree. Both were correct: the
 * rubric passed and the validator refused. The blocker now carries the
 * verdict's own reasons, so it states which check failed and why.
 */
describe("a blocker must not name a check that passed", () => {
  const blocked = {
    id: "doc-1",
    name: "Technical Proposal.pdf",
    format: "pdf",
    exactFileName: "Technical Proposal.pdf",
    fileContent: "JVBERi0xLjQK",
    qualityBlocked: true,
  };

  it("no longer asserts the narrative rubric when it cannot know that", () => {
    const reason = exportBlockReason("QUALITY_BLOCKED");
    assert.ok(reason);
    // The exact misattribution that shipped. It must not come back.
    assert.equal(
      /failed the canonical narrative-quality rubric/.test(reason),
      false,
      "QUALITY_BLOCKED must not attribute itself to the narrative rubric",
    );
    // And it must not send an automated operator to a UI panel instead.
    assert.equal(/Document Validator shows the score/.test(reason), false);
  });

  it("states which check refused, in the verdict's own words", () => {
    const reason = exportBlockReason("QUALITY_BLOCKED", {
      qualityBlockReasons: [
        "[PLACEHOLDER] Document contains placeholder text: 'Bid-Team to confirm'",
        "[ENVELOPE_MISMATCH] Financial pricing content detected in a TECHNICAL document",
      ],
    });
    assert.ok(reason);
    assert.match(reason, /PLACEHOLDER/);
    assert.match(reason, /Bid-Team to confirm/);
    assert.match(reason, /ENVELOPE_MISMATCH/);
    // A reader must be able to act without opening another surface.
    assert.equal(/Document Validator shows the score/.test(reason), false);
  });

  it("says the reasons were not supplied rather than inventing one", () => {
    // Metadata-only callers still exist and cannot pay for the verdict. They
    // must get an honest "not supplied here", not a confident wrong authority.
    for (const detail of [undefined, null, { qualityBlockReasons: null }, { qualityBlockReasons: [] }, { qualityBlockReasons: ["   "] }]) {
      const reason = exportBlockReason("QUALITY_BLOCKED", detail as never);
      assert.ok(reason);
      assert.match(reason, /were not supplied to this surface/);
      assert.equal(/canonical narrative-quality rubric/.test(reason), false);
    }
  });

  it("still blocks: naming the reason must not make the document exportable", () => {
    // The point is attribution, not permission. A quality-blocked document is
    // still quality-blocked, and ranks above every "looks ready" state.
    assert.equal(deriveDocumentOutputState(blocked as never), "QUALITY_BLOCKED");
    assert.notEqual(deriveDocumentOutputState(blocked as never), "READY_FOR_EXPORT");
    assert.ok(exportBlockReason(deriveDocumentOutputState(blocked as never), blocked as never));
  });

  it("the readiness model passes the verdict's reasons to the blocker", () => {
    // Without this wiring the new parameter is dead and every blocker falls
    // back to "not supplied" — which would look like a fix while changing
    // nothing an operator reads.
    const source = readFileSync("lib/engine/final-package-readiness-model.ts", "utf8");
    assert.match(source, /qualityBlockReasons:\s*qualityBlockReasonsById\.get\(document\.id\)/);
    assert.match(source, /exportBlockReason\(deriveDocumentOutputState\(document\), document\)/);
    assert.match(source, /exportBlockReason\(state, document\)/);
  });
});
