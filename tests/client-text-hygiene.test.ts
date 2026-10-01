import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findRenderedArtifactHygieneFailures,
  findMarkdownProseHygieneFailures,
  repairClientTextHygiene,
} from "../lib/engine/client-text-hygiene";

/**
 * A delivered 36-page technical proposal carried three machine-writing
 * failures at once:
 *
 *   "#### Site and Context Analysis"        (ten of them)
 *   "The methodology the following provides tailored to the following ..."
 *   "All deliverables will undergo"
 *
 * Each came from a different layer, and none of the existing hygiene rules saw
 * any of them, because every one of those rules looks for forbidden
 * VOCABULARY (pricing terms, AI tells, placeholders) while these are failures
 * of SYNTAX and GRAMMAR.
 *
 * The rules here read structure, never subject matter, so the cases below are
 * drawn from road, water, geotechnical, urban-planning, supervision and
 * building tenders — the benchmark that exposed the defect was a healthcare
 * one, and nothing in the fix may depend on that.
 */

test("a raw Markdown heading in the rendered artifact is a failure, in any sector", () => {
  const cases = [
    "#### Site and Context Analysis",
    "### Pavement Structural Design",
    "##### Borehole Logging and Sampling",
    "## Reticulation Network Sizing",
    "###### Contract Administration Records",
  ];
  for (const line of cases) {
    const found = findRenderedArtifactHygieneFailures(`Intro paragraph.\n${line}\nBody paragraph.`);
    assert.equal(found.length, 1, line);
    assert.equal(found[0].kind, "RAW_MARKDOWN_HEADING");
    assert.equal(found[0].line, 2);
  }
});

test("rendered prose that merely mentions a hash is not a heading", () => {
  const text = "Borehole #4 was logged to 18 m. Sample #12 was tested for Atterberg limits.";
  assert.deepEqual(findRenderedArtifactHygieneFailures(text), []);
});

test("surviving emphasis markers and template syntax are failures", () => {
  const emphasis = findRenderedArtifactHygieneFailures("The **hydraulic design** follows EN 805.");
  assert.equal(emphasis.length, 1);
  assert.equal(emphasis[0].kind, "RAW_EMPHASIS_MARKERS");

  const template = findRenderedArtifactHygieneFailures("Prepared for {{clientName}} under the road package.");
  assert.equal(template.length, 1);
  assert.equal(template[0].kind, "TEMPLATE_SYNTAX");
});

test("the rendered gate never applies grammar rules, because extraction hard-wraps prose", () => {
  // This is the same sentence a PDF text extractor returns across three lines.
  // Judged line by line each fragment looks truncated; it is not.
  const wrapped = [
    "The supervision team will maintain a daily site record covering weather, labour,",
    "plant, materials delivered and instructions issued, and will reconcile that record",
    "against the contractor's monthly statement before certification.",
  ].join("\n");
  assert.deepEqual(findRenderedArtifactHygieneFailures(wrapped), []);
});

test("Markdown headings and bold runs are correct Markdown, not producer defects", () => {
  const markdown = [
    "### Geotechnical Investigation Methodology",
    "",
    "**Deliverables:**",
    "- Factual ground investigation report",
    "- Interpretative report with foundation recommendations",
  ].join("\n");
  assert.deepEqual(findMarkdownProseHygieneFailures(markdown), []);
});

test("an unfinished sentence is caught on the producer side, in any sector", () => {
  const cases: Array<[string, string]> = [
    ["All deliverables will undergo", "building/QA"],
    ["The pavement design will be checked against", "road"],
    ["Each borehole log is recorded and", "geotechnical"],
    ["The reticulation model will be calibrated using", "water"],
    ["Every interim payment certificate is issued after", "supervision"],
    ["The structure plan will be presented to", "urban planning"],
  ];
  for (const [line, sector] of cases) {
    const found = findMarkdownProseHygieneFailures(`Preceding complete sentence.\n${line}`);
    assert.equal(found.length, 1, `${sector}: ${line}`);
    assert.ok(
      found[0].kind === "UNFINISHED_SENTENCE" || found[0].kind === "DANGLING_CONNECTOR",
      `${sector}: unexpected kind ${found[0].kind}`,
    );
  }
});

test("bullet labels and table cells carry no finite verb and are left alone", () => {
  const markdown = [
    "- Site analysis report",
    "- Final drawing package",
    "- QA checklist",
    "- Pavement design report",
    "- Hydraulic calculation sheet",
    "| Phase | Deliverable | Weeks | Lead |",
    "| 1. Inception | Inception report | Weeks 1-2 | Project Principal |",
    "Deliverables:",
  ].join("\n");
  assert.deepEqual(findMarkdownProseHygieneFailures(markdown), []);
});

test("complete sentences pass, whatever they are about", () => {
  const markdown = [
    "The box-culvert hydraulic design is verified against the 1-in-50-year flood.",
    "Every borehole is logged to refusal and sampled at 1.5 m intervals.",
    "The master plan is presented at inception, draft and final stages;",
    "Interim certificates are issued monthly (subject to measurement).",
  ].join("\n");
  assert.deepEqual(findMarkdownProseHygieneFailures(markdown), []);
});

test("the repairer removes an unfinished fragment and never completes it", () => {
  const markdown = [
    "#### Deliverables and Quality Assurance",
    "All deliverables will undergo",
    "**Deliverables:**",
    "- Final drawing package",
  ].join("\n");
  const result = repairClientTextHygiene(markdown);
  assert.equal(result.removedLines, 1);
  assert.ok(!result.text.includes("All deliverables will undergo"));
  // The heading, the label and the bullet all survive.
  assert.ok(result.text.includes("#### Deliverables and Quality Assurance"));
  assert.ok(result.text.includes("- Final drawing package"));
  // Nothing was invented to fill the gap.
  assert.ok(!/undergo\s+\w/.test(result.text));
});

test("the repairer leaves a healthy document byte-identical in its prose", () => {
  const markdown = [
    "## Road and Infrastructure Methodology",
    "",
    "The alignment is set out from the approved control network.",
    "- Pavement design report",
    "",
    "## Water and Sanitation Methodology",
    "",
    "The reticulation network is sized for the 20-year design horizon.",
  ].join("\n");
  const result = repairClientTextHygiene(markdown);
  assert.equal(result.removedLines, 0);
  for (const line of markdown.split("\n").filter(Boolean)) {
    assert.ok(result.text.includes(line), line);
  }
});

/**
 * The AI-tell rewrite in generate-elite.ts and the AI-tell DETECTOR in
 * detection-patterns.ts must describe the same phrase. They did not: the
 * detector flags /\bbelow is (?:a|the|my)\b/, while the rewrite fired on any
 * "below is" at all — so it also caught "below" used as an ordinary adverb and
 * a delivered proposal read
 *
 *   "The methodology the following provides tailored to the following
 *    identified service streams: architecture, mep."
 *
 * A rewrite that is broader than the detector it serves rewrites text nobody
 * ever objected to, and there is no reason for it to be broader.
 */
test("the AI-tell rewrite is no broader than the detector it serves", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  const rewrites = [...source.matchAll(/\.replace\((\/\\b[Bb]elow is[^/]*\/[gimsuy]*)\s*,\s*"([^"]*)"\)/g)];
  assert.ok(rewrites.length >= 1, "generate-elite.ts no longer rewrites the 'below is' AI tell");

  const apply = (text: string): string => {
    let out = text;
    for (const [, pattern, replacement] of rewrites) {
      // eslint-disable-next-line no-eval
      out = out.replace(eval(pattern) as RegExp, replacement);
    }
    return out;
  };

  // The AI tell is still rewritten, and reads correctly afterwards.
  assert.equal(apply("Below is a summary of the pavement design."), "The following provides a summary of the pavement design.");
  assert.equal(apply("below is the borehole schedule."), "the following provides the borehole schedule.");

  // Ordinary adverbial "below" is left alone, in any sector.
  for (const sentence of [
    "The methodology below is tailored to the following identified service streams: architecture, mep.",
    "The reticulation layout below is sized for the 20-year horizon.",
    "The alignment shown below is set out from the approved control network.",
    "The phasing table below is gated by client sign-off.",
  ]) {
    assert.equal(apply(sentence), sentence, sentence);
  }
});

/**
 * The AI-trace DETECTOR had the same defect as the rewrite: alongside the
 * precise /\bbelow is (?:a|the|my)\b/ it carried a bare /\bBelow is\b/, which
 * condemns ordinary English. That bare pattern is why the blind rewrite
 * existed at all — the rewrite was there to keep the detector quiet — so
 * narrowing the rewrite without removing the pattern only moved the failure
 * from garbled prose to a blocked PDF ("failed the content quality gate (AI
 * trace text)").
 */
test("the AI-trace detector flags the preamble, not the adverb", async () => {
  const { AI_TRACE_PATTERNS } = await import("../lib/engine/detection-patterns");
  const flags = (text: string): boolean => AI_TRACE_PATTERNS.some((pattern) => pattern.test(text));

  // Still caught: the assistant preamble.
  assert.ok(flags("Below is a summary of the proposed approach."));
  assert.ok(flags("below is the schedule you asked for."));

  // No longer condemned: "below" as an ordinary adverb, across sectors.
  for (const sentence of [
    "The methodology below is tailored to the following identified service streams.",
    "The pavement structure shown below is designed for a 20-year life.",
    "The reticulation schematic below is indicative only.",
    "The borehole location plan below is drawn to scale.",
    "The phasing table below is gated by client sign-off.",
  ]) {
    assert.equal(flags(sentence), false, sentence);
  }
});
