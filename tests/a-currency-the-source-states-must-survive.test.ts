import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURRENCY_TOKEN_ALTERNATION, resolveCurrencyToken } from "../lib/engine/currency-reference";

/**
 * THE DEFECT.
 * -----------
 * Two independent paths produce a vault project's currency, and each carried
 * its own hand-written shortlist — which did not even agree with the other:
 *
 *   lib/ai.ts (AI extraction schema)          "USD|ETB|EUR|GBP|AED|SAR or null"
 *   company-knowledge-safety-import.ts        (ETB|USD|EUR|GBP|CHF|KES|AED)
 *
 * So a project stated in NGN, TZS, INR or ZAR was read as having NO currency,
 * and a fact the source printed in plain sight was discarded. That matters more
 * since unknown currency stopped defaulting to ETB: the value is now rendered
 * with no denomination at all, which is honest but strictly less than the
 * source said.
 *
 * currency-reference.ts exists for exactly this and names the failure: "a
 * hand-written regional list standing in for general knowledge, and a system
 * that is meant to work for any tender in any country quietly working for one
 * region." project-fact-extractor.ts had already been migrated onto it. These
 * two paths had not.
 *
 * THE TRAP the reference warns about, pinned below: the alternation is
 * CASE-SENSITIVE on purpose, because several ISO codes are also ordinary
 * lower-case English words. A pattern built from it must not carry the `i`
 * flag, or "1,000 all of which was spent" becomes a thousand Albanian lek.
 */

/** Rebuilt exactly as company-knowledge-safety-import.ts builds it. */
const CONTRACT_VALUE_PATTERN = new RegExp(
  `(?:[Cc]ontract\\s+[Vv]alue|[Pp]roject\\s+[Vv]alue|[Bb]udget|[Aa]mount)`
  + `\\s*[:\\-]?\\s*(${CURRENCY_TOKEN_ALTERNATION})?\\s*([\\d,.]+)\\s*(${CURRENCY_TOKEN_ALTERNATION})?`,
);

function parse(text: string): { value: string | null; currency: string | null } {
  const m = text.match(CONTRACT_VALUE_PATTERN);
  if (!m) return { value: null, currency: null };
  return { value: m[2] ?? null, currency: resolveCurrencyToken((m[1] || m[3] || "").trim()) };
}

describe("a currency the source states must survive", () => {
  it("reads currencies outside the old regional shortlist", () => {
    for (const [text, code] of [
      ["Contract Value: KES 45,000,000", "KES"],
      ["Project Value: NGN 1,200,000", "NGN"],
      ["Budget: 7,500,000 TZS", "TZS"],
      ["Contract Value: INR 98,000,000", "INR"],
      ["Amount: 3,400,000 ZAR", "ZAR"],
    ] as const) {
      assert.equal(parse(text).currency, code, `${text} must yield ${code}`);
    }
  });

  it("still reads the currencies the old shortlist knew", () => {
    for (const [text, code] of [
      ["Contract Value: ETB 312,000,000", "ETB"],
      ["Contract Value: USD 4,500,000", "USD"],
      ["Project Value: GBP 220,000", "GBP"],
    ] as const) {
      assert.equal(parse(text).currency, code);
    }
  });

  it("normalises an unambiguous alias to its code", () => {
    assert.equal(parse("Amount: 2,300,000 Birr").currency, "ETB");
  });

  it("states no currency when the source states none", () => {
    const r = parse("contract value: 1,000,000");
    assert.equal(r.value, "1,000,000", "the magnitude is still read");
    assert.equal(r.currency, null, "and no denomination is invented");
  });

  it("does not read an ordinary lower-case word as a currency", () => {
    // The reference requires no `i` flag for exactly this reason.
    assert.equal(parse("Budget: 1,000 all of which was spent").currency, null);
    assert.equal(parse("Amount: 500 top of the range").currency, null);
  });

  it("neither producer keeps a hand-written currency shortlist", () => {
    const shortlist = /\((?:ETB|USD|EUR|GBP|CHF|KES|AED|SAR)(?:\|[A-Z]{3})+\)/;
    for (const file of [
      "lib/company-knowledge-safety-import.ts",
      "lib/ai.ts",
    ]) {
      const src = readFileSync(file, "utf8");
      const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      assert.doesNotMatch(code, shortlist, `${file} must use the canonical currency reference`);
    }
  });

  it("the AI schema asks for a real code and the answer is checked, not trusted", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.match(src, /ISO 4217 alphabetic code exactly as the document states it/, "schema must not enumerate a region");
    assert.match(
      src,
      /currency: resolveCurrencyToken\(/,
      "a widened instruction must be validated, or the model can answer anything",
    );
    // An unrecognised answer must become null rather than a fabricated code.
    assert.equal(resolveCurrencyToken("DOLLARS"), null);
    assert.equal(resolveCurrencyToken("XYZ"), null);
    assert.equal(resolveCurrencyToken("KES"), "KES");
  });
});

/**
 * The same narrow list also sat inside the PRICING-LEAKAGE guard, where an
 * unrecognised currency did not make the guard stricter — it made it looser.
 * Only a fragment that is nothing but an amount is barred from appealing to
 * surrounding context, so "KES 45,000,000" failing that test let a non-ETB
 * amount argue its way past the veto. And the bare-year scrub spares a year
 * only when a currency token sits beside it, so "KES 2026" lost that
 * protection and had the amount scrubbed.
 */
describe("the pricing-leakage guard recognises money in any currency", () => {
  const VALUE_ONLY = new RegExp(
    `^[^A-Za-z0-9]*(?:(?:${CURRENCY_TOKEN_ALTERNATION})\\s*)?[$€£]?\\s*[0-9][0-9,]*(?:\\.\\d+)?`
    + `\\s*(?:[KkMmBb](?:[Ii][Ll][Ll][Ii][Oo][Nn])?)?\\s*(?:${CURRENCY_TOKEN_ALTERNATION})?[^A-Za-z0-9]*$`,
  );

  it("treats an amount in any currency as a value-only fragment", () => {
    for (const fragment of [
      "ETB 312,000,000", "KES 45,000,000", "NGN 1.2M",
      "USD 4.5 Million", "45,000,000 TZS", "2,300,000 Birr", "$1,200,000",
    ]) {
      assert.ok(VALUE_ONLY.test(fragment.trim()), `${fragment} is an amount and nothing else`);
    }
  });

  it("keeps the magnitude suffix working without an i flag", () => {
    // The alternation forbids `i`, so [KkMmBb] and ILLION spell their own cases.
    for (const fragment of ["12 Million", "12 million", "12M", "3 Billion"]) {
      assert.ok(VALUE_ONLY.test(fragment.trim()), fragment);
    }
  });

  it("still treats prose as prose", () => {
    for (const sentence of [
      "The team delivered the works in 2023.",
      "Our fee proposal is submitted separately as required.",
      "all of which was spent",
    ]) {
      assert.equal(VALUE_ONLY.test(sentence.trim()), false, sentence);
    }
  });

  it("the guard no longer carries its own currency shortlist", () => {
    const src = readFileSync("lib/engine/pricing-hygiene.ts", "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /EUR\|USD\|ETB\|GBP\|Birr/, "must use the canonical reference");
    assert.match(code, /CURRENCY_TOKEN_ALTERNATION/);
  });
});

describe("the shared money detector is strictly better than the three it replaced", () => {
  const MONEY = `(?:${CURRENCY_TOKEN_ALTERNATION}|[Dd]ollars?|[Ee]uros?|[Pp]ounds?)`;
  const MAG = "(?:[KkMmBb](?:[Ii][Ll][Ll][Ii][Oo][Nn])?)?";
  const NUM = "[0-9][0-9,]*(?:\\.\\d+)?";
  const DETECT = new RegExp(
    `(?:\\b${MONEY}\\s*${NUM}${MAG}\\b|\\b${NUM}${MAG}\\s*${MONEY}\\b|[$€£]\\s*${NUM}${MAG})`,
  );

  it("sees amounts the old pattern missed", () => {
    for (const sentence of [
      "Contract value was KES 45,000,000 in 2023.",   // currency outside the old list
      "Budget of 4,500,000 euros was approved.",       // the old pattern had no plural
      "We delivered NGN 1.2M of works.",
    ]) {
      assert.ok(DETECT.test(sentence), `a leakage guard must see money in: ${sentence}`);
    }
  });

  it("still sees the amounts the old pattern saw", () => {
    for (const sentence of [
      "Contract value was ETB 312,000,000 in 2023.",
      "The fee was USD 4,500,000.",
      "A $1,200,000 contract.",
    ]) {
      assert.ok(DETECT.test(sentence), sentence);
    }
  });

  it("does not see money in ordinary prose", () => {
    for (const sentence of [
      "The project ran from 2021 to 2023 with no cost overrun.",
      "Our methodology has five phases.",
    ]) {
      assert.equal(DETECT.test(sentence), false, sentence);
    }
  });

  it("KNOWN REMAINING GAP: a magnitude spelled as a separate word", () => {
    // "1.2 million dollars" puts a word between the number and the currency, so
    // neither this pattern nor the three it replaced match it. Recorded rather
    // than quietly fixed: widening a leakage guard further is safe in direction
    // but this shape has not been observed in real generated output, and the
    // guard is a protected subsystem. Fix it when there is evidence it occurs.
    assert.equal(DETECT.test("The fee is 1.2 million dollars."), false);
  });
});
