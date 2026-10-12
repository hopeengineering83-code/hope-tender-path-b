/**
 * Engine sentinels must not reach the reader.
 *
 * The injectors mark already-inserted content with HTML comments —
 * "<!-- cover-page:markdown -->" (cover-page-injector.ts) and
 * "<!-- signature-block:injected -->" (generate-elite.ts) — so a second pass
 * does not duplicate a cover page or a signature block. They are bookkeeping.
 *
 * markdownToDocx() had no rule for them, so it rendered each one as an ordinary
 * paragraph. Found by generating a real technical proposal through the real
 * pipeline and reading the produced .docx: the literal text
 * "<!-- cover-page:markdown -->" sat in the middle of the cover page, and
 * "<!-- signature-block:injected -->" sat above the signature block, in a
 * document meant to be submitted to a client.
 *
 * Every document the app produces passes through this one function, so the rule
 * is asserted here rather than per-injector: a sentinel introduced later cannot
 * leak by being forgotten.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { markdownToDocx } from "../lib/engine/generate-elite";

/** The visible text of every rendered paragraph, flattened. */
function visibleText(md: string): string {
  return JSON.stringify(markdownToDocx(md));
}

describe("markdownToDocx does not render engine sentinels", () => {
  it("drops the two sentinels the injectors actually emit", () => {
    for (const sentinel of ["<!-- cover-page:markdown -->", "<!-- signature-block:injected -->"]) {
      const rendered = visibleText(`# Technical Proposal\n\n${sentinel}\n\nReal prose follows.`);
      assert.ok(!rendered.includes("cover-page:markdown") && !rendered.includes("signature-block:injected"),
        `sentinel leaked into the document: ${sentinel}`);
    }
  });

  it("drops an arbitrary comment, not just the two known ones", () => {
    // The guarantee is about HTML comments as a class. A sentinel added next
    // year must be covered without anyone editing this renderer again.
    const rendered = visibleText("# Heading\n\n<!-- some-future-marker:v2 -->\n\nBody.");
    assert.ok(!rendered.includes("some-future-marker"), "an unknown sentinel leaked");
  });

  it("keeps the surrounding prose", () => {
    const rendered = visibleText("# Technical Proposal\n\n<!-- cover-page:markdown -->\n\nReal prose follows.");
    assert.ok(rendered.includes("Real prose follows."), "dropping the comment removed real content");
    assert.ok(rendered.includes("Technical Proposal"), "dropping the comment removed the heading");
  });

  it("does not swallow prose that merely mentions an arrow or dash", () => {
    // Guard against an over-broad rule: only a whole-line HTML comment goes.
    const rendered = visibleText("The design shall meet the 2019 code --> see Annex B.");
    assert.ok(rendered.includes("see Annex B"), "ordinary prose was dropped");
  });
});
