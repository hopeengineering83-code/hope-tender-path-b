/**
 * Owner UAT: "Source-verified Build Plan completeness" showed
 * Technical-Proposal.docx as OUTSIDE PLAN with four manual buttons
 * (Reclassify to plan / Mark control / Supersede duplicate / Exclude
 * outside-plan) for a file the app had generated itself, alongside
 * "Show 11 historical row(s)".
 *
 * Cause: the plan-row lookup kept whichever document reached the key first
 * (`if (!key || docByKey.has(key)) continue`). With 11 historical rows behind
 * one required file, a superseded or content-less predecessor could claim the
 * plan row, stranding the live document, which then fell through to the
 * OUTSIDE_PLAN default and demanded owner action.
 *
 * The lookup now prefers the current document. Ranking is: never-superseded,
 * then has bytes, then validated.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SRC = readFileSync("lib/engine/submission-plan-completeness.ts", "utf8");

describe("the plan row adopts the current document, not the first seen", () => {
  it("no longer skips on first-match", () => {
    assert.doesNotMatch(
      SRC,
      /if \(!key \|\| docByKey\.has\(key\)\) continue;/,
      "first-match-wins stranded the live document behind a superseded one",
    );
  });

  it("replaces a lower-ranked document already held for the key", () => {
    assert.match(SRC, /if \(!existing \|\| docRank\(doc\) > docRank\(existing\)\) docByKey\.set\(key, doc\);/);
  });

  it("ranks never-superseded above superseded, and bytes above none", () => {
    assert.match(SRC, /const superseded = \(doc\.generationStatus \?\? ""\)\.toUpperCase\(\) === "SUPERSEDED";/);
    assert.match(SRC, /return \(superseded \? 0 : 4\) \+ \(hasBytes \? 2 : 0\) \+ \(validated \? 1 : 0\);/);
  });
});

describe("rank ordering is correct", () => {
  // Mirrors the implementation so the intent is asserted, not just the text.
  const rank = (superseded: boolean, hasBytes: boolean, validated: boolean) =>
    (superseded ? 0 : 4) + (hasBytes ? 2 : 0) + (validated ? 1 : 0);

  it("a live document outranks a superseded one even when the superseded one is validated", () => {
    assert.ok(rank(false, false, false) > rank(true, true, true));
  });

  it("among live documents, one with bytes outranks one without", () => {
    assert.ok(rank(false, true, false) > rank(false, false, true));
  });

  it("validated breaks the tie between two live documents with bytes", () => {
    assert.ok(rank(false, true, true) > rank(false, true, false));
  });
});

describe("the outside-plan message is coherent and not a chore list", () => {
  it("no longer names the document as the list it is missing from", () => {
    assert.doesNotMatch(SRC, /it is not part of the tender-required file list \(\$\{doc\?\.exactFileName/);
  });

  it("states the automatic outcome instead of demanding owner action", () => {
    assert.match(SRC, /excluded from the package automatically\. No action is needed/);
    assert.doesNotMatch(SRC, /case "OUTSIDE_PLAN": return `Map this document into the submission plan or supersede it/);
  });
});
