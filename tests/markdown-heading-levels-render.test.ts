import { test } from "node:test";
import assert from "node:assert/strict";

import { markdownToDocx } from "../lib/engine/generate-elite";

/**
 * markdownToDocx understood "# ", "## " and "### " only. A "#### " line fell
 * through to the paragraph branch, so the reader saw the literal hashes: a
 * delivered 36-page technical proposal carried ten of them, including
 * "#### Site and Context Analysis" and "#### MEP System Design", because the
 * service-stream methodology builder writes its subsections at heading level 4.
 *
 * Markdown has six levels and any producer may use any of them, so the fix
 * belongs in the renderer rather than in a rule telling each producer what
 * this renderer happens to support.
 */

function styleOf(paragraph: unknown): string | null {
  const match = /"w:pStyle","root":\[\{"rootKey":"_attr","root":\{"val":\{"key":"w:val","value":"([^"]+)"/.exec(
    JSON.stringify(paragraph),
  );
  return match ? match[1] : null;
}

/** Visible text of a paragraph: the string children of its w:t nodes. */
function renderedText(paragraph: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as { rootKey?: unknown; root?: unknown };
    if (record.rootKey === "w:t" && Array.isArray(record.root)) {
      for (const child of record.root) if (typeof child === "string") parts.push(child);
      return;
    }
    walk(record.root);
  };
  walk(paragraph);
  return parts.join("");
}

test("every Markdown heading level renders as a Word heading, not as body text", () => {
  const levels: Array<[string, string]> = [
    ["# Section A", "Heading1"],
    ["## A.1 Company Overview", "Heading2"],
    ["### Geotechnical Investigation", "Heading3"],
    ["#### Borehole Logging", "Heading4"],
    ["##### Sample Scheduling", "Heading5"],
    ["###### Laboratory Test Register", "Heading6"],
  ];
  for (const [markdown, expectedStyle] of levels) {
    const [paragraph] = markdownToDocx(markdown);
    assert.equal(styleOf(paragraph), expectedStyle, markdown);
    // The hashes are heading syntax, never content.
    assert.ok(!renderedText(paragraph).includes("#"), markdown);
  }
});

test("no rendered paragraph carries raw heading syntax, across sectors", () => {
  const markdown = [
    "# Technical Proposal",
    "#### Pavement Structural Design",
    "#### Reticulation Network Sizing",
    "##### Contract Administration Records",
    "Body text explaining the approach.",
  ].join("\n");
  for (const paragraph of markdownToDocx(markdown)) {
    assert.ok(!/^#{1,6}\s/.test(renderedText(paragraph)), renderedText(paragraph));
  }
});

test("a hash inside prose is still prose", () => {
  const [paragraph] = markdownToDocx("Borehole #4 was logged to refusal at 18 m.");
  assert.equal(styleOf(paragraph), null);
  assert.ok(renderedText(paragraph).includes("#4"));
});
