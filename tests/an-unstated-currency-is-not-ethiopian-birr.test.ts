import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildClientReferencesTable, buildProjectPortfolioCards } from "../lib/engine/benchmark-tables";

/**
 * THE DEFECT.
 * -----------
 * Two money formatters defaulted an unknown currency to Ethiopian Birr:
 *
 *   benchmark-tables.ts     const cur   = currency || "ETB";
 *   proposal-intelligence.ts const label = currency || "ETB";
 *
 * `Project.currency` is nullable. So every vault project whose currency was
 * never recorded had its contract value printed to the client as ETB — a
 * denomination its source never stated. fmtMoney feeds the "Contract Value" and
 * "Construction Value of Works" table rows and the inline
 * "(CUR 350,000,000, Client)" parenthetical used across roughly ten engine
 * modules, so the invented denomination reached the DELIVERED PDF. A project in
 * Kenya, Nigeria or Jordan was silently re-denominated on its way to the page.
 *
 * currency-reference.ts had already settled this question for AMBIGUOUS
 * currency names, in these words:
 *
 *   "Naming no currency is correct where naming the wrong one is a fabricated
 *    figure in a bid."
 *
 * An ABSENT currency is the same case, so it gets the same answer. The
 * magnitude is source-grounded and is still printed — dropping it would throw
 * away real evidence in a document scored on evidence density. The
 * denomination is not known, so it is not asserted.
 */

const benchmarkTables = readFileSync("lib/engine/benchmark-tables.ts", "utf8");
const proposalIntelligence = readFileSync("lib/engine/proposal-intelligence.ts", "utf8");

function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

describe("an unstated currency is not Ethiopian Birr", () => {
  it("neither formatter defaults a missing currency to any currency at all", () => {
    for (const [name, source] of [
      ["benchmark-tables", benchmarkTables],
      ["proposal-intelligence", proposalIntelligence],
    ] as const) {
      assert.doesNotMatch(
        codeOnly(source),
        /currency\s*\|\|\s*["'][A-Z]{3}["']/,
        `${name} must not substitute a currency code for a missing one`,
      );
    }
  });

  it("no currency code is hard-coded as a fallback anywhere in these formatters", () => {
    // Guards against the defect returning under a different code — swapping
    // "ETB" for "USD" would be the same mistake wearing a different hat.
    for (const [name, source] of [
      ["benchmark-tables", benchmarkTables],
      ["proposal-intelligence", proposalIntelligence],
    ] as const) {
      const region = codeOnly(source).slice(0, codeOnly(source).indexOf("hasContractValue") + 200);
      assert.doesNotMatch(
        region,
        /\?\?\s*["'](ETB|USD|EUR|GBP|KES|NGN)["']/,
        `${name} must not fall back to a currency code`,
      );
    }
  });

  it("the magnitude survives when the denomination does not", () => {
    // The value is source-grounded even when the currency is not. Dropping the
    // figure entirely would cost real evidence in a document scored on it.
    assert.match(
      codeOnly(benchmarkTables),
      /return cur \? `\$\{cur\} \$\{formatted\}` : formatted;/,
      "fmtMoney must still print the number when no currency is stated",
    );
    assert.match(
      codeOnly(proposalIntelligence),
      /label \? `\$\{label\} \$\{amount\}` : amount/,
      "money() must still print the amount when no currency is stated",
    );
  });

  it("a stated currency is still printed, whatever it is", () => {
    for (const [name, source] of [
      ["benchmark-tables", benchmarkTables],
      ["proposal-intelligence", proposalIntelligence],
    ] as const) {
      assert.match(
        codeOnly(source),
        /\(currency \?\? ""\)\.trim\(\)/,
        `${name} must read the stated currency rather than a regional default`,
      );
    }
  });

  it("renders a real table without inventing a denomination", () => {
    // Behaviour, not source text: two Kenyan projects, one whose currency was
    // never recorded. Before the fix the first row read "ETB 350,000,000".
    const projects = [
      { id: "p1", name: "Riverside Water Scheme", clientName: "Riverside Council", contractValue: 350_000_000, currency: null, country: "Kenya", sector: "Water" },
      { id: "p2", name: "Coastal Hospital", clientName: "Coastal Health Board", contractValue: 675_000_000, currency: "KES", country: "Kenya", sector: "Healthcare" },
    ] as unknown as Parameters<typeof buildClientReferencesTable>[0];

    for (const rendered of [
      buildClientReferencesTable(projects),
      buildProjectPortfolioCards(projects, "Water Supply Design", "Water"),
    ]) {
      assert.doesNotMatch(rendered, /ETB/, "no ETB may appear for projects that never stated one");
      assert.match(rendered, /350,000,000/, "the unstated-currency magnitude is still reported");
      assert.match(rendered, /KES 675,000,000/, "a stated currency is preserved verbatim");
    }
  });

  it("the fix names no country and favours no region", () => {
    const fmt = benchmarkTables.slice(
      benchmarkTables.indexOf("function fmtMoney"),
      benchmarkTables.indexOf("function hasContractValue"),
    );
    // Ethiopia may be NAMED in the explanation of the defect — that is history,
    // not behaviour — but must not appear in the executable path.
    assert.doesNotMatch(codeOnly(fmt), /ETB|Ethiopia|Birr/i);
  });
});
