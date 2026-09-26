import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CURRENCY_TOKEN_ALTERNATION,
  isKnownCurrencyCode,
  resolveCurrencyToken,
} from "../lib/engine/currency-reference";
import { extractProjectAmounts, extractProjectFacts } from "../lib/engine/project-fact-extractor";

/**
 * THE DEFECT
 * ----------
 * The portfolio fact extractor recognised six currencies - ETB, GBP, USD, EUR,
 * KES and ZAR - and read any figure denominated in anything else as no figure
 * at all. A project in Nigeria, Rwanda, Vietnam, Peru or Jordan therefore lost
 * its contract value even though the amount sat verbatim in the record's own
 * reference text, and it lost it silently: an unparsed number and an absent
 * number are indistinguishable downstream.
 *
 * It is the same shape of defect as the hand-written country list: a regional
 * list standing in for general knowledge inside a system that is supposed to
 * work for any tender in any country. Both now read from one generic reference.
 */

describe("currency tokens resolve from a general reference, not a regional list", () => {
  it("resolves ISO codes from every region", () => {
    const cases: Array<[string, string]> = [
      ["ETB", "ETB"], ["KES", "KES"], ["NGN", "NGN"], ["RWF", "RWF"], ["GHS", "GHS"],
      ["TZS", "TZS"], ["UGX", "UGX"], ["ZAR", "ZAR"], ["EGP", "EGP"], ["XOF", "XOF"],
      ["USD", "USD"], ["EUR", "EUR"], ["GBP", "GBP"], ["JPY", "JPY"], ["CNY", "CNY"],
      ["INR", "INR"], ["VND", "VND"], ["PHP", "PHP"], ["BDT", "BDT"], ["NPR", "NPR"],
      ["JOD", "JOD"], ["AED", "AED"], ["SAR", "SAR"], ["IQD", "IQD"],
      ["PEN", "PEN"], ["BRL", "BRL"], ["MXN", "MXN"], ["COP", "COP"],
    ];
    for (const [token, code] of cases) {
      assert.equal(resolveCurrencyToken(token), code, token);
      assert.equal(isKnownCurrencyCode(code), true, code);
    }
  });

  it("resolves the symbols and unambiguous names that appear beside figures", () => {
    assert.equal(resolveCurrencyToken("$"), "USD");
    assert.equal(resolveCurrencyToken("£"), "GBP");
    assert.equal(resolveCurrencyToken("€"), "EUR");
    assert.equal(resolveCurrencyToken("₦"), "NGN");
    assert.equal(resolveCurrencyToken("Birr"), "ETB");
    assert.equal(resolveCurrencyToken("birr"), "ETB");
    assert.equal(resolveCurrencyToken("Naira"), "NGN");
    assert.equal(resolveCurrencyToken("Cedis"), "GHS");
  });

  it("names no currency where a name would be a guess", () => {
    // "Shilling" is KES, UGX or TZS; "peso" is one of eight; "kwacha" is two.
    // A fabricated currency on a real figure is worse than an absent one.
    for (const ambiguous of ["shilling", "shillings", "peso", "pesos", "kwacha", "dinar", "dirham", "franc", "rupee", "krona"]) {
      assert.equal(resolveCurrencyToken(ambiguous), null, ambiguous);
    }
  });

  it("rejects three-letter tokens that are not currencies, and lower-cased codes", () => {
    for (const notACurrency of ["VAT", "TOR", "EOI", "RFP", "BOQ", "QTY", "etb", "usd", "all", "top", "try"]) {
      assert.equal(resolveCurrencyToken(notACurrency), null, notACurrency);
    }
  });

  it("keeps the shared alternation case-sensitive for codes, so prose is not money", () => {
    // The alternation is used without the `i` flag by design. If that ever
    // changes, "1,000 all of which" becomes a thousand Albanian lek.
    const pattern = new RegExp(`^${CURRENCY_TOKEN_ALTERNATION}$`);
    assert.equal(pattern.test("ETB"), true);
    assert.equal(pattern.test("etb"), false);
    assert.equal(pattern.test("ALL"), true, "ALL is a real ISO code in upper case");
    assert.equal(pattern.test("all"), false, "but the English word is not money");
    assert.equal(pattern.test("Birr"), true, "names stay case-insensitive");
    assert.equal(pattern.test("BIRR"), true);
  });

  it("is the one place currency knowledge lives", () => {
    // The extractor must not carry a private list again.
    const source = readFileSync(path.join(__dirname, "..", "lib", "engine", "project-fact-extractor.ts"), "utf8");
    assert.equal(source.includes("CURRENCY_TOKENS"), false, "the private six-currency table must not come back");
    assert.ok(source.includes("CURRENCY_TOKEN_ALTERNATION"), "amount patterns must use the shared alternation");
    assert.ok(source.includes("resolveCurrencyToken"), "token lookup must use the shared resolver");
  });
});

describe("the extractor recovers the figure whatever currency it is stated in", () => {
  it("reads a contract value across sectors and currencies", () => {
    const cases: Array<[string, number, string]> = [
      ["Design and supervision of a referral hospital. Construction Cost: 550,074,678.02 ETB", 550074678.02, "ETB"],
      ["Contract administration for a federal secretariat. Construction Cost: 1,200,000,000.00 NGN", 1200000000, "NGN"],
      ["Water supply master plan for three towns. Construction Cost: 88,000,000.00 RWF", 88000000, "RWF"],
      ["Detailed design of a wastewater plant. Contract value: 3,400,000,000 VND", 3400000000, "VND"],
      ["Resident engineer services for a trunk road. Contract value 2,750,000 PEN", 2750000, "PEN"],
      ["Core banking implementation. Total sum 12,500,000 JOD", 12500000, "JOD"],
      ["Urban drainage supervision. Cost: 640,000,000 TZS", 640000000, "TZS"],
      ["Geotechnical investigation, port extension. Fee: USD 3.5M", 3500000, "USD"],
      ["Structural design of a cold store. Value: £390,717", 390717, "GBP"],
      ["Campus masterplan. Construction Cost: 45,000 Birr", 45000, "ETB"],
    ];
    for (const [summary, value, currency] of cases) {
      const facts = extractProjectFacts(summary);
      assert.equal(facts.contractValue, value, summary);
      assert.equal(facts.currency, currency, summary);
    }
  });

  it("reports no value rather than a wrong one when no currency is stated", () => {
    const facts = extractProjectFacts("Contract value 1,000 all of which was retained as a performance bond");
    assert.equal(facts.contractValue, undefined);
    assert.equal(facts.currency, undefined);
  });

  it("still distinguishes a monthly supervision rate from a construction cost", () => {
    // Regression: the amount-role semantics the writer depends on must survive
    // the currency change, in a non-ETB currency as well as in ETB.
    const amounts = extractProjectAmounts(
      "Construction Cost: 1,200,000,000.00 NGN. Contract Administration & Construction Supervision Cost: 4,500,000 NGN/month",
    );
    const construction = amounts.find((a) => a.role === "CONSTRUCTION");
    const rate = amounts.find((a) => a.role === "SUPERVISION_RATE");
    assert.equal(construction?.value, 1200000000);
    assert.equal(construction?.currency, "NGN");
    assert.equal(rate?.value, 4500000);
    assert.equal(rate?.currency, "NGN");
    assert.equal(rate?.perMonth, true);
  });
});
