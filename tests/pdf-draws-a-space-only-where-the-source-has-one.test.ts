import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutWords, parseInlineRuns } from "../lib/engine/proposal-pdf";

/**
 * The delivered PDF read:
 *
 *   A.4 Key Personnel  Ahmed Kebede Tekaw , General Manager & Practicing ...
 *   Project Manager (single-point-of-accountability) : Ahmed Kebede Tekaw
 *   ... a 7,000 m² project in Ethiopia , on which the firm performed ...
 *
 * The markdown behind each has no space there — "**Ahmed Kebede Tekaw**,
 * General Manager", "**Project Manager (single-point-of-accountability)**:
 * ...". The renderer advanced the cursor by a full space after EVERY word but
 * the last, so two source-adjacent tokens were drawn apart wherever a styled
 * run ended against punctuation.
 *
 * It is a one-character defect that appears on every bolded label in a
 * thirty-four page document.
 */

function render(markdown: string): string {
  // Reconstruct what the reader sees: each word, with a space after it only
  // where the layout says to draw one.
  return layoutWords(parseInlineRuns(markdown))
    .map((word) => word.text + (word.space ? " " : ""))
    .join("");
}

test("a styled run ending against punctuation draws no space", () => {
  const cases = [
    ["**Ahmed Kebede Tekaw**, General Manager & Practicing Professional Engineer",
      "Ahmed Kebede Tekaw, General Manager & Practicing Professional Engineer"],
    ["**Project Manager (single-point-of-accountability)**: Ahmed Kebede Tekaw",
      "Project Manager (single-point-of-accountability): Ahmed Kebede Tekaw"],
    ["a 7,000 m² project in **Ethiopia**, on which the firm performed",
      "a 7,000 m² project in Ethiopia, on which the firm performed"],
    ["**Total**; **subtotal**: and *emphasis*.", "Total; subtotal: and emphasis."],
  ];
  for (const [markdown, expected] of cases) {
    assert.equal(render(markdown), expected, `wrong spacing for: ${markdown}`);
  }
});

test("ordinary spacing is unchanged", () => {
  for (const line of [
    "The engagement is delivered in 5 phases.",
    "Led by **Ahmed Kebede Tekaw**, the proposed team is structured around the tender's disciplines.",
    "**Bold start** and a plain tail.",
    "A tail that is **bold at the end**",
  ]) {
    assert.equal(render(line), line.replace(/\*+/g, ""), `spacing changed for: ${line}`);
  }
});

test("a run boundary mid-word does not invent a space", () => {
  // "re**structure**d" is one word split across two runs.
  assert.equal(render("re**structur**ed text"), "restructured text");
});

test("every word carries its own style", () => {
  const words = layoutWords(parseInlineRuns("plain **bold** *italic* ***both***"));
  assert.deepEqual(
    words.map((w) => [w.text, w.bold, w.italic]),
    [["plain", false, false], ["bold", true, false], ["italic", false, true], ["both", true, true]],
  );
  // Only the last word has no following space.
  assert.deepEqual(words.map((w) => w.space), [true, true, true, false]);
});

test("a word's text no longer carries its trailing space", () => {
  // The width measured for layout must be the width of the word, not the word
  // plus a space that was also being added separately.
  for (const word of layoutWords(parseInlineRuns("one two three"))) {
    assert.equal(word.text, word.text.trim(), `"${word.text}" still carries whitespace`);
  }
});
