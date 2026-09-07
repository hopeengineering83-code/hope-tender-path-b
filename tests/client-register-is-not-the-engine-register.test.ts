import { test } from "node:test";
import assert from "node:assert/strict";

import { applyClientRegister } from "../lib/engine/client-register";

/**
 * The delivered PDF used the word "reviewed" 28 times. Inside the engine it
 * means SOURCE_VERIFIED and governs what may be claimed; in front of an
 * evaluator it means nothing, and it reads as a bidder hedging its own track
 * record. Every fixture below is a verbatim sentence from that document.
 *
 * The load-bearing assertion in this file is the second group: a rewrite that
 * made any claim LARGER would be a worse defect than the one it fixed.
 */

test("the engine's verification vocabulary leaves the client document", () => {
  const cases: Array<[string, RegExp]> = [
    [
      "Hope Urban Planning Architectural and Engineering Consultancy PLC has reviewed G+6 General Hospital – Dr Abdul Seid (Gimba City) as relevant reference experience.",
      /presents G\+6 General Hospital/,
    ],
    [
      "Hope Urban Planning Architectural and Engineering Consultancy PLC brings relevant reviewed experience to this assignment.",
      /brings relevant experience to this assignment/,
    ],
    [
      "Led by Ahmed Kebede Tekaw, General Manager, whose reviewed record states 11+ years of professional experience, the proposed team is structured around the tender's required disciplines.",
      /, with 11\+ years of professional experience,/,
    ],
    [
      "Ahmed Kebede Tekaw is proposed as General Manager and has 11 years experience recorded in the reviewed specialist record.",
      /has 11 years of experience\./,
    ],
    [
      "Kemal Mohammed Zeinu is proposed as Senior Environmental & Electrical Expert against the reviewed specialist record.",
      /Electrical Expert\.$/,
    ],
    [
      "The table below maps reviewed specialist disciplines to relevant project records.",
      /maps each specialist's disciplines/,
    ],
    [
      "Reviewed hospital and medical-centre records inform the healthcare-specific delivery approach described in this proposal.",
      /^hospital and medical-centre records inform/i,
    ],
  ];

  for (const [before, expected] of cases) {
    const after = applyClientRegister(before).text;
    assert.match(after, expected, `not rewritten:\n  ${before}\n  -> ${after}`);
    assert.ok(!/\breviewed\b/i.test(after), `"reviewed" survives:\n  ${after}`);
  }
});

test("no rewrite makes a claim larger than the one it replaces", () => {
  // Every figure and every named entity in the input must still be present,
  // and no superlative or absolute may appear that was not there before.
  const inputs = [
    "Led by Ahmed Kebede Tekaw, General Manager, whose reviewed record states 11+ years of professional experience, the team is set.",
    "Ahmed Kebede Tekaw has 11 years experience recorded in the reviewed specialist record.",
    "Hope PLC has reviewed Woldia–Dessie Road Upgrading as relevant reference experience.",
  ];

  const INFLATION = /\b(?:leading|foremost|best|unrivalled|unmatched|guarantee[ds]?|proven track record|award-winning|expert in all)\b/i;

  for (const before of inputs) {
    const after = applyClientRegister(before).text;
    for (const figure of before.match(/\d+\+?/g) ?? []) {
      assert.ok(after.includes(figure), `the figure ${figure} was lost from:\n  ${after}`);
    }
    for (const name of ["Ahmed Kebede Tekaw", "Woldia–Dessie Road Upgrading", "Hope PLC"]) {
      if (before.includes(name)) assert.ok(after.includes(name), `${name} was lost`);
    }
    assert.ok(!INFLATION.test(after), `a rewrite introduced a stronger claim:\n  ${after}`);
    assert.ok(after.length <= before.length, `a rewrite grew the sentence:\n  ${after}`);
  }
});

test("the firm's real review process is left exactly as written", () => {
  // These describe an actual quality control the bidder is committing to. They
  // are the reason this pass is anchored to the provenance phrasing rather
  // than to the word "reviewed".
  const keep = [
    "Every deliverable package is reviewed through three mandatory stages before issue.",
    "Quality is gated inside the phase — the deliverable is peer-reviewed against the applicable standards and the tender's own requirements before it is issued.",
    "Risks identified at inception are tracked in the live risk register, reviewed monthly, and re-scored after each mitigation action.",
    "Three-stage internal review — schematic, developed, pre-issue review by named senior reviewers.",
  ];
  for (const line of keep) {
    assert.equal(applyClientRegister(line).text, line, `a real QA commitment was altered:\n  ${line}`);
  }
});

test("an internal confidence caveat is removed, a real qualification is not", () => {
  const caveat =
    "The proposed disciplines are mapped to the tender's healthcare scope; individual experience claims remain limited to each reviewed specialist record.";
  const result = applyClientRegister(caveat);
  assert.equal(result.caveatsRemoved, 1);
  assert.equal(result.text, "The proposed disciplines are mapped to the tender's healthcare scope.");

  // A sentence that genuinely narrows a claim must survive untouched: removing
  // it would turn a bounded commitment into an unbounded one.
  for (const realQualification of [
    "Radiation shielding and licensing activities are included only where the confirmed equipment brief and applicable authority require them.",
    // Reads like boilerplate; is not. It says the firm's own standards do not
    // override the tender's or the authority's.
    "Each applicable standard remains subject to the tender and authority requirements.",
  ]) {
    assert.equal(applyClientRegister(realQualification).text, realQualification);
  }
});

test("this application's internal names never reach the client", () => {
  // "the firm's vault" is what this app calls its evidence store. It reached a
  // delivered proposal as "3 reviewed expert(s) from the firm's supervision
  // vault", which tells an evaluator nothing and reveals how the document was
  // assembled. Both producers are fixed at source; this pins them.
  const { buildMobilizationTable } = require("../lib/engine/mobilization-and-checklist") as {
    buildMobilizationTable: (opts: { experts: unknown[] }) => string;
  };
  void buildMobilizationTable;

  const sources = [
    require("node:fs").readFileSync("lib/engine/mobilization-and-checklist.ts", "utf8"),
    require("node:fs").readFileSync("lib/engine/understanding-and-value-added.ts", "utf8"),
  ] as string[];

  for (const source of sources) {
    // Only client-facing template literals matter; comments explaining the
    // defect are expected to mention it.
    const emitted = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
      .join("\n");
    assert.ok(!/firm's vault/.test(emitted), "the internal store name is still emitted to the client");
  }
});
