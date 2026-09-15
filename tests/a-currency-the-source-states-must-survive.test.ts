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
