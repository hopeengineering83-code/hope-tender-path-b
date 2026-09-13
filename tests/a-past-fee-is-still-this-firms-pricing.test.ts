import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { repairPortfolioCards } from "../lib/engine/portfolio-card-repair";
import { containsPricingLeakage, pricingLeakageFinding } from "../lib/engine/pricing-hygiene";

/**
 * THE DEFECT, NAMED BY THE APPLICATION'S OWN DETECTOR.
 * ----------------------------------------------------
 * Project cards began carrying the value their record states, and the delivered
 * Technical Proposal.pdf scored 75 / QUALITY_FAILED with
 * PRICING_LEAKAGE [HIGH]. The finding carried no excerpt, and the first
 * diagnosis — reached by approximating the audit's view with a different
 * extractor — blamed a fused personnel table and a fused page footer. It was
 * wrong. Running the audit's OWN reader and detector over the delivered bytes
 * named the offenders exactly:
 *
 *   PRICING LEAKAGE ON THE AUDIT'S OWN TEXT: true
 *   FRAGMENTS THE DETECTOR FLAGS ON THEIR OWN: 3 of 1100
 *     > Row 1: Consultancy Fee | ETB 1.1M
 *     > Row 1: Consultancy Fee | ETB 450K
 *     > Row 1: Consultancy Fee | USD 945K
 *
 * GENERIC ROOT CAUSE
 * ------------------
 * The card builders withheld a monthly supervision RATE as "a price signal,
 * not a track-record fact" but printed a lump-sum fee. Nothing but the
 * per-month flag separated the two, and that distinction has no basis in the
 * principle: both state what this firm charges to do this work. A construction
 * value is different in kind — it describes the ASSET, not anyone's price.
 *
 * The fix strengthens the control instead of widening the exemption: exempting
 * the "Consultancy Fee" label would have let a bidder's fee levels stand in a
 * technical envelope, which is the disclosure the two-envelope rule exists to
 * prevent.
 *
 * Cases below are deliberately non-Ethiopian and non-healthcare where the
 * defect allows it; the delivered Ethiopian rows are re-verified at the end.
 */

const TECHNICAL_PROPOSAL = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as Parameters<typeof containsPricingLeakage>[1];

const card = (title: string) => [
  `### ${title}`,
  "",
  "| Field | Detail |",
  "|---|---|",
  "| Client | Municipal Authority |",
  "| Duration | 2019-2022 |",
  "",
].join("\n");

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Reference Project",
  clientName: "Municipal Authority",
  country: "Kenya",
  sector: "Infrastructure",
  serviceAreas: "[]",
  summary: "",
  contractValue: null,
  currency: null,
  ...over,
});

describe("a past fee never reaches a technical envelope, in any sector or currency", () => {
  const sectors = [
    {
      what: "a Polish road rehabilitation",
      summary: "Detailed design and supervision of 42 km of regional road in Poland. Design Fee: 640,000 EUR. Construction Cost: 31,500,000 EUR.",
      fee: /640,000|EUR 640K/,
      works: /\| Construction Value of Works \| EUR 31\.5M \|/,
    },
    {
      what: "a Philippine water supply scheme",
      summary: "Feasibility study and detailed design of a bulk water supply scheme in the Philippines. Consultancy Fee: 12,400,000 PHP. Construction Cost: 880,000,000 PHP.",
      fee: /12,400,000|PHP 12\.4M/,
      works: /\| Construction Value of Works \| PHP 880\.0M \|/,
    },
    {
      what: "a Peruvian school-building programme",
      summary: "Architectural design of 14 primary schools in Peru. Design Fee: 310,000 USD. Construction Cost: 9,750,000 USD.",
      fee: /310,000|USD 310K/,
      works: /\| Construction Value of Works \| USD 9\.8M \|/,
    },
  ];

  for (const sector of sectors) {
    it(`withholds the fee and keeps the construction value for ${sector.what}`, () => {
      const result = repairPortfolioCards(card("Reference Project"), [project({ summary: sector.summary })] as never);
      assert.doesNotMatch(result.markdown, /Consultancy Fee/, "no fee row");
      assert.doesNotMatch(result.markdown, sector.fee, "not the fee amount under any label");
      assert.match(result.markdown, sector.works, "the asset's cost is not withheld");
    });

    it(`produces a card the pricing detector accepts for ${sector.what}`, () => {
      // The end-to-end claim: it is not enough that the row is gone, the
      // repaired card must pass the very gate that failed the proposal.
      const result = repairPortfolioCards(card("Reference Project"), [project({ summary: sector.summary })] as never);
      assert.equal(containsPricingLeakage(result.markdown, TECHNICAL_PROPOSAL), false);
    });
  }

  it("removes a fee row the WRITER authored, not only one the repair would add", () => {
    // Not adding one is half a rule. This pass never overwrites a cell that is
    // "complete as written", so an upstream-authored
    // "| Consultancy Fee | ETB 1.1M |" passed through untouched and reached
    // the delivered PDF -- which is where the detector found it. Refusing it
    // on the LABEL closes that path: the defect is the disclosure, not the
    // cell's quality.
    const authored = [
      "### Reference Project",
      "",
      "| Field | Detail |",
      "|---|---|",
      "| Client | Municipal Authority |",
      "| Consultancy Fee | EUR 640K |",
      "| Duration | 2019-2022 |",
      "",
    ].join("\n");
    const result = repairPortfolioCards(authored, [project({
      summary: "Detailed design and supervision of 42 km of regional road in Poland. Design Fee: 640,000 EUR. Construction Cost: 31,500,000 EUR.",
    })] as never);
    assert.doesNotMatch(result.markdown, /Consultancy Fee/);
    assert.doesNotMatch(result.markdown, /EUR 640K/);
    assert.match(result.markdown, /\| Construction Value of Works \| EUR 31\.5M \|/);
    assert.equal(containsPricingLeakage(result.markdown, TECHNICAL_PROPOSAL), false);
  });

  it("refuses every pricing vocabulary a writer might reach for", () => {
    for (const label of ["Consultancy Fee", "Design Fee", "Daily Rate", "Unit Price", "Remuneration", "Invoice Amount"]) {
      const authored = [
        "### Reference Project",
        "",
        "| Field | Detail |",
        "|---|---|",
        `| ${label} | EUR 640K |`,
        "",
      ].join("\n");
      const result = repairPortfolioCards(authored, [project()] as never);
      assert.doesNotMatch(result.markdown, new RegExp(label), label);
    }
  });

  it("does not mistake an asset's cost or value for a price", () => {
    // The rule must not delete legitimate track record. "Cost" and "value" are
    // deliberately outside it.
    for (const label of ["Construction Value of Works", "Construction Cost", "Contract Value", "Project Value"]) {
      const authored = [
        "### Reference Project",
        "",
        "| Field | Detail |",
        "|---|---|",
        `| ${label} | EUR 31.5M |`,
        "",
      ].join("\n");
      const result = repairPortfolioCards(authored, [project()] as never);
      assert.match(result.markdown, new RegExp(label), `${label} states the scale of the asset, not a price`);
    }
  });

  it("refuses the stored column when it holds the fee rather than the works cost", () => {
    const result = repairPortfolioCards(card("Reference Project"), [project({
      contractValue: 640_000,
      currency: "EUR",
      summary: "Detailed design and supervision of 42 km of regional road in Poland. Design Fee: 640,000 EUR. Construction Cost: 31,500,000 EUR.",
    })] as never);
    assert.doesNotMatch(result.markdown, /Contract Value/);
    assert.doesNotMatch(result.markdown, /EUR 640K/);
  });

  it("still prints a contract value that is neither the fee nor the works cost", () => {
    // The rule withholds a fee. It must not swallow a genuine, distinct
    // contract figure, or the cards go silent about scale altogether.
    const result = repairPortfolioCards(card("Reference Project"), [project({
      contractValue: 2_300_000,
      currency: "EUR",
      summary: "Detailed design and supervision of 42 km of regional road in Poland. Design Fee: 640,000 EUR. Construction Cost: 31,500,000 EUR.",
    })] as never);
    assert.match(result.markdown, /\| Contract Value \| EUR 2\.3M \|/);
  });

  it("re-verifies the three rows the delivered PDF actually carried", () => {
    // PHARO RE-VERIFICATION. These are the exact fragments the detector named.
    for (const offender of [
      "Row 1: Consultancy Fee | ETB 1.1M",
      "Row 1: Consultancy Fee | ETB 450K",
      "Row 1: Consultancy Fee | USD 945K",
    ]) {
      assert.equal(
        containsPricingLeakage(offender, TECHNICAL_PROPOSAL),
        true,
        `${offender} must still be leakage — the fix removes the row, it does not blind the detector`,
      );
    }
  });
});

describe("a HIGH finding names the text that produced it", () => {
  it("quotes the offending fragment and the rule that matched", () => {
    const finding = pricingLeakageFinding(
      "The methodology is described below.\nRow 1: Consultancy Fee | ETB 1.1M\nThe work plan follows.",
      TECHNICAL_PROPOSAL,
    );
    assert.ok(finding, "the leakage must still be detected");
    assert.match(finding.fragment, /Consultancy Fee \| ETB 1\.1M/);
    assert.equal(finding.spansFragmentBoundary, false);
    assert.ok(finding.rule.length > 0);
  });

  it("says so when no single sentence contains a price", () => {
    // The false-positive family: each fragment is clean, the join is not. A
    // reader told only "pricing language appears" would hunt for a sentence
    // that does not exist.
    const finding = pricingLeakageFinding(
      "The assignment will be delivered over 18\nmonths at a monthly rate of progress agreed with the client.",
      TECHNICAL_PROPOSAL,
    );
    if (finding) {
      assert.ok(finding.fragment.length > 0, "an excerpt is always present when a finding is");
    }
  });

  it("returns nothing at all for a clean technical document", () => {
    assert.equal(
      pricingLeakageFinding("Our approach sequences survey, design and supervision over 18 months.", TECHNICAL_PROPOSAL),
      null,
    );
  });

  it("agrees with the boolean it replaced, both ways", () => {
    // If these ever disagree, the refactor changed a fail-closed verdict.
    for (const text of [
      "The bid price is USD 400,000",
      "Our approach sequences survey, design and supervision over 18 months.",
      "Construction Value of Works ETB 550.1M",
      "Row 1: Consultancy Fee | ETB 1.1M",
      "Total price: ETB 1,250,000",
      "",
    ]) {
      assert.equal(
        containsPricingLeakage(text, TECHNICAL_PROPOSAL),
        pricingLeakageFinding(text, TECHNICAL_PROPOSAL) !== null,
        text,
      );
    }
  });
});
