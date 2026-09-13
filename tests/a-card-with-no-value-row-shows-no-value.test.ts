import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { repairPortfolioCards } from "../lib/engine/portfolio-card-repair";

/**
 * THE DEFECT, measured in a delivered proposal.
 * ---------------------------------------------
 * The vault holds a contract value on 113 of 114 projects, and the delivered
 * PDF cited ZERO monetary figures. Section B's cards read:
 *
 *   Client            City Administration of Abuja
 *   Location & Scale  Nigeria - 7,500 m2
 *   Duration          2024-2026
 *   Services Provided ...
 *
 * No value row at all. The repair pass could FILL an empty cell or DROP a row
 * the record cannot support, but it had no way to ADD one — so a project's
 * value, the most checkable fact on its card, reached the page only when the
 * writer happened to ask for it. No gate can see this: an absent number breaks
 * no rule, so readiness passes and the hashes match over a portfolio section
 * that makes no claim about scale of contract at all.
 *
 * WHAT IS PINNED
 * --------------
 * That a row the record supports is added when the card lacks it; that the
 * amount's ROLE is preserved, so a construction cost is never printed as this
 * firm's contract value; that a monthly supervision rate is still never
 * printed; and that nothing is invented for a record that states no amount.
 */

const project = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "G+6 General Hospital",
  clientName: "Dr Abdul Seid",
  country: "Ethiopia",
  sector: "Healthcare",
  serviceAreas: "[]",
  summary: "Design and supervision of a G+6 general hospital in Gimba City, Ethiopia (7,000 m²). Construction Cost: 550,074,678.02 ETB. 2015-2018.",
  contractValue: null,
  currency: null,
  ...over,
});

/** A card exactly as the writer produced it in the delivered proposal. */
const cardWithoutValueRow = [
  "### G+6 General Hospital",
  "",
  "| Field | Detail |",
  "|---|---|",
  "| Client | Dr Abdul Seid |",
  "| Location & Scale | Ethiopia — 7,000 m² |",
  "| Duration | 2015–2018 |",
  "| Services Provided | Architectural design, Construction supervision |",
  "",
].join("\n");

describe("a value the record states must reach the card", () => {
  it("adds the row the writer never wrote", () => {
    // A stored contract value that is genuinely the firm's contract, distinct
    // from the construction cost the record also states. Using the
    // construction amount here would assert the very misstatement the suite
    // below exists to prevent.
    const result = repairPortfolioCards(cardWithoutValueRow, [project({ contractValue: 12_000_000, currency: "ETB" })] as never);
    assert.match(result.markdown, /\| Contract Value \| ETB 12\.0M \|/);
    // The rows the writer did write are untouched and still in order.
    const lines = result.markdown.split("\n").filter((l) => l.startsWith("|"));
    assert.ok(lines.some((l) => l.includes("Dr Abdul Seid")));
    assert.ok(lines.some((l) => l.includes("Services Provided")));
    assert.ok(
      lines.indexOf(lines.find((l) => l.includes("Contract Value"))!) > lines.indexOf(lines.find((l) => l.includes("Client"))!),
      "the added row goes inside the card's table, not before it",
    );
  });

  it("never prints a construction cost as this firm's contract value", () => {
    // The record states a construction cost and no consultancy contract. The
    // firm's contract was not 550 million; the asset it worked on was.
    const result = repairPortfolioCards(cardWithoutValueRow, [project()] as never);
    assert.doesNotMatch(result.markdown, /\| Contract Value \| ETB 550/);
    assert.match(result.markdown, /\| Construction Value of Works \| ETB 550\.1M \|/);
  });

  it("prints no fee at all, and still prints the construction value beside it", () => {
    // THIS TEST ASSERTED THE OPPOSITE UNTIL A DELIVERED PDF DISPROVED IT.
    // It required "Consultancy Fee" on the card. The application's own reader
    // and detector, run over the delivered bytes, named three such rows as the
    // PRICING_LEAKAGE [HIGH] that scored the proposal 75/QUALITY_FAILED:
    //
    //   > Row 1: Consultancy Fee | ETB 1.1M
    //
    // A past fee is still this firm's pricing, and a technical envelope is
    // where it must not appear. The construction cost is different in kind --
    // it describes the asset, not anyone's price -- so it is not withheld.
    const withFee = project({
      summary: "Detailed design of a district hospital in Kenya. Design Fee: 1,100,000 KES. Construction Cost: 89,000,000 KES.",
    });
    const result = repairPortfolioCards(cardWithoutValueRow, [withFee] as never);
    assert.doesNotMatch(result.markdown, /Consultancy Fee/);
    assert.doesNotMatch(result.markdown, /1,100,000|KES 1\.1M/);
    assert.match(result.markdown, /\| Construction Value of Works \| KES 89\.0M \|/);
  });

  it("refuses the stored column too when it holds the fee", () => {
    // Withholding the fee row while printing the identical amount under
    // "Contract Value" would change the label and not the disclosure.
    const feeInTheColumn = project({
      contractValue: 1_100_000,
      currency: "KES",
      summary: "Detailed design of a district hospital in Kenya. Design Fee: 1,100,000 KES. Construction Cost: 89,000,000 KES.",
    });
    const result = repairPortfolioCards(cardWithoutValueRow, [feeInTheColumn] as never);
    assert.doesNotMatch(result.markdown, /Contract Value/);
    assert.doesNotMatch(result.markdown, /1\.1M/);
    assert.match(result.markdown, /\| Construction Value of Works \| KES 89\.0M \|/);
  });

  it("adds nothing to a card whose record states no amount", () => {
    const noAmount = project({ summary: "Structural assessment and renovation design for a city administration building." });
    const result = repairPortfolioCards(cardWithoutValueRow, [noAmount] as never);
    assert.doesNotMatch(result.markdown, /Contract Value/);
    assert.doesNotMatch(result.markdown, /Construction Value/);
    assert.doesNotMatch(result.markdown, /Consultancy Fee/);
  });

  it("does not duplicate a value row the writer already wrote", () => {
    const cardWithValue = cardWithoutValueRow.replace(
      "| Duration | 2015–2018 |",
      "| Duration | 2015–2018 |\n| Contract Value | ETB 12.0M |",
    );
    const result = repairPortfolioCards(cardWithValue, [project({ contractValue: 12_000_000, currency: "ETB" })] as never);
    const occurrences = result.markdown.split("Contract Value").length - 1;
    assert.equal(occurrences, 1, "the row is added only when it is missing");
  });

  it("still never prints a monthly supervision rate", () => {
    const rateOnly = project({
      summary: "Construction supervision of a hospital. Contract Administration & Construction Supervision Cost: 110,000 ETB/month.",
    });
    const result = repairPortfolioCards(cardWithoutValueRow, [rateOnly] as never);
    assert.doesNotMatch(result.markdown, /110,000/);
    assert.doesNotMatch(result.markdown, /month/i);
  });

  it("keeps each card's value with its own card", () => {
    const two = [
      cardWithoutValueRow,
      [
        "### Dessie Specialized Hospital",
        "",
        "| Field | Detail |",
        "|---|---|",
        "| Client | Dessie City Admin |",
        "| Location & Scale | Ethiopia — 2,800 m² |",
        "",
      ].join("\n"),
    ].join("\n");

    const result = repairPortfolioCards(two, [
      project({ contractValue: 550074678.02, currency: "ETB" }),
      project({ id: "p2", name: "Dessie Specialized Hospital", clientName: "Dessie City Admin", contractValue: 125000000, currency: "ETB", summary: "Renovation of Dessie Specialized Hospital, Ethiopia (2,800 m²)." }),
    ] as never);

    const first = result.markdown.indexOf("G+6 General Hospital");
    const second = result.markdown.indexOf("Dessie Specialized Hospital");
    const v1 = result.markdown.indexOf("ETB 550.1M");
    const v2 = result.markdown.indexOf("ETB 125.0M");
    assert.ok(v1 > first && v1 < second, "the first card's value stays in the first card");
    assert.ok(v2 > second, "the second card's value stays in the second card");
  });
});

describe("the same amount is never printed under two different roles", () => {
  /**
   * MEASURED IN A DELIVERED PDF. The first run that carried value rows put the
   * same figure on every card twice:
   *
   *   Contract Value               ETB 550.1M
   *   Construction Value of Works  ETB 550.1M
   *
   * The stored contractValue is an index filled from the record's own text, and
   * that text states a CONSTRUCTION cost — the cost of the asset, not what this
   * firm was paid. One of those two lines was false, in front of an evaluator
   * who can check it against the client's own records.
   */
  it("labels a stored construction cost as construction, not as contract value", () => {
    const record = project({ contractValue: 550074678.02, currency: "ETB" });
    const result = repairPortfolioCards(cardWithoutValueRow, [record] as never);

    assert.match(result.markdown, /\| Construction Value of Works \| ETB 550\.1M \|/);
    assert.doesNotMatch(result.markdown, /\| Contract Value \|/);

    // The figure is not hidden — it appears exactly once, labelled truthfully.
    const occurrences = result.markdown.split("ETB 550.1M").length - 1;
    assert.equal(occurrences, 1);
  });

  it("still prints a contract value that is genuinely a different amount", () => {
    // A record whose stored contract value is NOT the construction cost: both
    // facts are real and both belong on the card.
    const record = project({
      contractValue: 12_000_000,
      currency: "ETB",
      summary: "Design and supervision of a hospital in Ethiopia. Construction Cost: 550,074,678.02 ETB. 2015-2018.",
    });
    const result = repairPortfolioCards(cardWithoutValueRow, [record] as never);

    assert.match(result.markdown, /\| Contract Value \| ETB 12\.0M \|/);
    assert.match(result.markdown, /\| Construction Value of Works \| ETB 550\.1M \|/);
  });
});
