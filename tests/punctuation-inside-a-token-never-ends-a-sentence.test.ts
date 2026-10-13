import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { segmentSentences } from "../lib/engine/sentence-segmentation";
import { containsPricingLeakage, pricingLeakageFinding } from "../lib/engine/pricing-hygiene";
import { __testing__ as exportRepair } from "../lib/engine/export-gap-repair";

/**
 * THE DEFECT, and why it is one invariant rather than two modules.
 * ----------------------------------------------------------------
 * Two sentence splitters run on the production path. They were written for
 * different jobs and drifted apart on the one rule they genuinely share: a
 * period whose neighbours make it internal punctuation is not a terminator.
 *
 * A probe over the fourteen required splitter semantics found them disagreeing
 * on ten. Most of those disagreements are each module's own correct policy on
 * newlines and terminators, and are deliberately NOT consolidated. Four were
 * this shared rule, implemented in one module and not the other:
 *
 *   "... ETB 550,074,678.02 was delivered."
 *     -> ["... ETB 550,074,678.", "02 was delivered."]
 *   "Send to tender.office@example.gov.et before the deadline."
 *     -> ["Send to tender.", "office@example.", "gov.", "et before ..."]
 *   "See https://example.gov.et/docs/v1.2/tor.pdf for the TOR."
 *     -> ["See https://example.", "gov.", "et/docs/v1.", "2/tor.", "pdf ..."]
 *   "Completed 12.03.2019 and handed over."
 *     -> ["Completed 12.03.", "2019 and handed over."]
 *
 * The consequences were real and opposite in the two modules. In the repairer,
 * the half carrying the amount was classified as pricing risk and dropped and
 * the orphan tail was written back, so a delivered client proposal stated
 * "Construction Value of Works 1M". In the judge, cutting an enumerated vault
 * reference at its ordinals severed each amount from the heading, client and
 * years that identify it as PAST, so a historical figure was reported as this
 * bid's price.
 *
 * WHAT THESE TESTS PIN
 * --------------------
 * The invariant, across sectors this firm bids in and in wording that has
 * nothing to do with any one benchmark tender: numbers, emails, URLs, dates,
 * clock times, professional-title abbreviations and list ordinals survive
 * segmentation whole. And -- the half that matters more -- that sharing the
 * rule moved no threshold: legitimate prose containing "not available", and
 * non-price technical rates, are still not pricing; and real pricing leakage
 * is still detected.
 */

const JUDGE = { newlinesAreBoundaries: true, keepTerminators: false } as const;
const REPAIR = { newlinesAreBoundaries: false, keepTerminators: true } as const;

/** Every segment, under both policies, for the invariants that hold either way. */
function bothWays(text: string): string[][] {
  return [segmentSentences(text, JUDGE), segmentSentences(text, REPAIR)];
}

function assertKeptWhole(text: string, token: string): void {
  for (const segments of bothWays(text)) {
    assert.ok(
      segments.some((segment) => segment.includes(token)),
      `"${token}" was fragmented into ${JSON.stringify(segments)}`,
    );
  }
}

describe("a token's internal punctuation is not a sentence boundary — every sector", () => {
  it("keeps a full decimal amount whole (road works)", () => {
    assertKeptWhole(
      "The asphalt overlay covered 12.4 km of the corridor at a works value of ETB 550,074,678.02 under contract RCP/2019/44. Handover was certified.",
      "ETB 550,074,678.02",
    );
  });

  it("keeps an email address whole (water supply)", () => {
    assertKeptWhole(
      "Queries go to procurement.unit@waterworks.gov.et before the closing date.",
      "procurement.unit@waterworks.gov.et",
    );
  });

  it("keeps a URL whole, including a versioned path (geotechnical)", () => {
    assertKeptWhole(
      "Borehole logs are published at https://data.geo-survey.org/reports/v1.2/bh-14.pdf for review.",
      "https://data.geo-survey.org/reports/v1.2/bh-14.pdf",
    );
  });

  it("keeps a dotted date whole (software and services)", () => {
    assertKeptWhole("The SCADA migration was completed 12.03.2019 and handed over.", "12.03.2019");
  });

  it("keeps a clock deadline whole (any sector — this is a submission rule)", () => {
    assertKeptWhole("Bids must be lodged before 10.00 a.m. on the closing date.", "10.00 a.m. on the closing date");
  });

  it("keeps an enumerated list together (logistics)", () => {
    const text = "Fleet scope: 1. Cold-chain trucks 24 units 2. Reefer trailers 6 units 3. Spare tractor heads 2 units.";
    for (const segments of bothWays(text)) assert.equal(segments.length, 1, JSON.stringify(segments));
  });

  it("keeps professional titles attached to their names (agriculture and energy)", () => {
    const text = "Dr. Abebe led the agronomy team and Eng. Lemma supervised the irrigation works.";
    for (const segments of bothWays(text)) assert.equal(segments.length, 1, JSON.stringify(segments));
  });

  it("keeps a label and its value in one unit (building consultancy)", () => {
    for (const segments of bothWays("Construction Value | ETB 550,074,678.02")) {
      assert.deepEqual(segments, ["Construction Value | ETB 550,074,678.02"]);
    }
  });
});

describe("the two policies stay different, because they answer different questions", () => {
  it("the judge treats one cell per line as one unit; the repairer does not break a paragraph", () => {
    const table = "Project\nSolar mini-grid, Afar\nContract Value\nUSD 18,940,000.00";
    assert.deepEqual(segmentSentences(table, JUDGE), [
      "Project",
      "Solar mini-grid, Afar",
      "Contract Value",
      "USD 18,940,000.00",
    ]);
    assert.equal(segmentSentences(table, REPAIR).length, 1, "a wrapped paragraph is not several claims");
  });

  it("the repairer keeps punctuation, because its output is delivered prose", () => {
    const text = "The design is complete. Supervision follows. Is the addendum binding? Yes.";
    assert.deepEqual(segmentSentences(text, REPAIR), [
      "The design is complete.",
      "Supervision follows.",
      "Is the addendum binding?",
      "Yes.",
    ]);
    assert.ok(
      segmentSentences(text, JUDGE).every((segment) => !/[.!?]$/.test(segment) || segment === "Yes."),
      "the judge drops terminators it used as delimiters",
    );
  });

  it("still splits ordinary sentences — this is not a rule that merges everything", () => {
    for (const segments of bothWays("The design is complete. Supervision follows. Handover is final.")) {
      assert.equal(segments.length, 3, JSON.stringify(segments));
    }
  });
});

describe("sharing the rule weakened no detection", () => {
  const TECHNICAL = { name: "Technical Proposal", exactFileName: "Technical Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "docx" };

  it("still detects this bid's offered price in a technical document", () => {
    assert.equal(
      containsPricingLeakage("Our total professional fee for this assignment is ETB 4,250,000.00.", TECHNICAL),
      true,
    );
  });

  it("still detects it when the amount sits at the end of a decimal that no longer splits", () => {
    // The exact shape the shared rule now keeps whole. If keeping it whole had
    // let it past the detector, the fix would have bought a fragment and sold a
    // leak.
    const finding = pricingLeakageFinding(
      "The price we quote for this proposal is USD 18,940,000.00 inclusive of all taxes.",
      TECHNICAL,
    );
    assert.ok(finding, "an offered price must still be found");
  });

  it("does not read 'not available' in legitimate prose as pricing or as a placeholder", () => {
    assert.equal(
      containsPricingLeakage("The geotechnical annex is not available in the issued documents. We request it by addendum.", TECHNICAL),
      false,
    );
  });

  it("does not read a non-price technical rate as money", () => {
    for (const sentence of [
      "The lost-time injury frequency rate was 0.42 per 200,000 hours worked.",
      "Compaction achieved 98.5 per cent of maximum dry density.",
      "The pump duty point is 12.5 l/s at 34.0 m head.",
    ]) {
      assert.equal(containsPricingLeakage(sentence, TECHNICAL), false, sentence);
    }
  });

  it("does not read a past project's delivered works value as this bid's price", () => {
    assert.equal(
      containsPricingLeakage(
        "Reference project, completed 2018: Construction Value of Works ETB 550,074,678.02 for the regional water utility.",
        TECHNICAL,
      ),
      false,
    );
  });
});

describe("the delivered-bytes failure this came from cannot recur", () => {
  const TECHNICAL = {
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.docx",
    documentType: "TECHNICAL_PROPOSAL",
    format: "docx",
  } as Parameters<typeof exportRepair.safeParagraphText>[1];

  it("never writes back a headless remainder of an amount", () => {
    // "Construction Value of Works 1M" reached a client: the unsafe half was
    // dropped and the orphan tail written back. The rewriter must keep the
    // paragraph or remove it, and never emit the tail.
    const safe = exportRepair.safeParagraphText(
      "Our fee for this assignment is ETB 550.1M and is payable monthly.",
      TECHNICAL,
    );
    assert.doesNotMatch(safe, /\d{1,3}M\b/, `orphan tail in ${JSON.stringify(safe)}`);
  });

  it("does not cut a full amount at its decimal point", () => {
    const safe = exportRepair.safeParagraphText(
      "Reference project: Construction Value of Works ETB 550,074,678.02, completed 2018.",
      TECHNICAL,
    );
    assert.doesNotMatch(safe, /550,074,678\.\s*$/, "an amount was cut at its decimal point");
    if (safe) assert.match(safe, /550,074,678\.02/, "a kept historical value must be kept whole");
  });
});
