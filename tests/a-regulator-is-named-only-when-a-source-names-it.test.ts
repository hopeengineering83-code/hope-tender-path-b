import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT.
 * -----------
 * The sector guidance injected into the proposal writer's prompt asserted
 * Ethiopian instruments for EVERY tender, whatever its country:
 *
 *   - Regulatory: Ethiopian Health Authority licensing, EBCS compliance ...
 *   - ... effluent treatment design to Ethiopian EPA/WHO standards.
 *   - ... incorporating Ethiopian seismic zone (EBCS-8/ES EN 1998) ...
 *   - Regulatory: structural calculation submission to AA City/regional authority ...
 *
 * So a Kenyan hospital or a Nigerian factory was instructed to answer to a
 * regulator that does not govern it. In a bid that is a fabricated compliance
 * claim, and it is exactly the permanent country-specific rule this codebase is
 * not allowed to carry.
 *
 * THE FIX IS NOT DELETION. For an Ethiopian tender EBCS really is the governing
 * code, and removing it would cost real technical depth on the one tender this
 * is measured against. The INSTRUMENT is source-driven instead: named when the
 * tender, the analysis, or the company's own evidence names it; otherwise the
 * guidance asks for the applicable national instrument without inventing which
 * one that is. Same mechanism the sector triggers already use — read the
 * source, do not assume the country.
 *
 * Note what is NOT in scope here: the `triggers` and `proofTerms` regexes, and
 * tender-facts-extractor's place names, mention Ethiopian terms in order to
 * DETECT them. Detection asserts nothing and is correct.
 */

const aiRaw = readFileSync("lib/ai.ts", "utf8");
/**
 * Comments are where this file EXPLAINS the defect, quoting the old strings
 * verbatim. Searching the raw text finds the explanation instead of the code —
 * so every structural assertion below reads executable lines only.
 */
const ai = aiRaw
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join("\n");

/** The helper exactly as lib/ai.ts defines it. */
function instrumentFor(source: string) {
  return (pattern: RegExp, specific: string, generic: string) =>
    pattern.test(source) ? specific : generic;
}

const ETHIOPIAN_TENDER =
  "Architectural Consultancy Services for a Specialty Medical Center. "
  + "Design shall comply with EBCS-8 and Ethiopian Health Authority licensing requirements.";
const KENYAN_TENDER =
  "Consultancy Services for the Coastal Referral Hospital, Mombasa County, Kenya. "
  + "Design shall comply with the National Construction Authority requirements.";

describe("a regulator is named only when a source names it", () => {
  it("keeps the specific instrument when the source names it", () => {
    const instrument = instrumentFor(ETHIOPIAN_TENDER);
    assert.equal(
      instrument(/EBCS|Ethiopian Health Authority|\bEHA\b/i, "Ethiopian Health Authority licensing and EBCS compliance", "GENERIC"),
      "Ethiopian Health Authority licensing and EBCS compliance",
      "the benchmark tender names EBCS, so the guidance must keep naming it — no depth is traded away",
    );
    assert.equal(
      instrument(/EBCS|ES EN 199|Ethiopian seismic/i, "the Ethiopian seismic zone (EBCS-8/ES EN 1998)", "GENERIC"),
      "the Ethiopian seismic zone (EBCS-8/ES EN 1998)",
    );
  });

  it("falls back to the applicable national instrument when no source names one", () => {
    const instrument = instrumentFor(KENYAN_TENDER);
    for (const [pattern, specific] of [
      [/EBCS|Ethiopian Health Authority|\bEHA\b/i, "Ethiopian Health Authority licensing and EBCS compliance"],
      [/EBCS|ES EN 199|Ethiopian seismic/i, "the Ethiopian seismic zone (EBCS-8/ES EN 1998)"],
      [/Ethiopian EPA|\bEPA\b|WHO standard/i, "Ethiopian EPA/WHO standards"],
      [/AA City|Addis Ababa|Ethiopian/i, "the AA City/regional authority"],
    ] as const) {
      assert.notEqual(
        instrument(pattern, specific, "GENERIC"),
        specific,
        `a Kenyan tender must not be told to answer to: ${specific}`,
      );
    }
  });

  it("no writer-prompt site asserts an Ethiopian instrument unconditionally", () => {
    // Each of the four now sits inside an instrument(...) call, so the literal
    // can only reach the prompt when the pattern matched a real source.
    for (const literal of [
      "Ethiopian Health Authority licensing and EBCS compliance",
      "Ethiopian EPA/WHO standards",
      "the Ethiopian seismic zone (EBCS-8/ES EN 1998)",
      "the AA City/regional authority",
    ]) {
      const at = ai.indexOf(literal);
      assert.ok(at > 0, `${literal} should still exist as the SPECIFIC branch`);
      const before = ai.slice(Math.max(0, at - 240), at);
      assert.match(
        before,
        /instrument\(/,
        `${literal} must be the specific branch of an instrument(...) call, not an unconditional assertion`,
      );
    }
  });

  it("the guidance never invents a regulator when the source is silent", () => {
    // The generic branches must ask for "the applicable ..." rather than name
    // a substitute authority, which would be the same defect wearing a
    // different flag.
    for (const forbidden of [
      /generic[^"]*Kenya[a-z ]*Authority/i,
      /"the Kenyan/i,
      /"the Nigerian/i,
    ]) {
      assert.doesNotMatch(ai, forbidden, "a fallback must not name a different country's regulator");
    }
  });

  it("detection of Ethiopian terms is untouched — detecting is not asserting", () => {
    // triggers/proofTerms legitimately look for EBCS so an Ethiopian tender is
    // recognised. Removing those would break the very case that works.
    assert.match(ai, /EBCS/, "EBCS must still be detectable");
  });
});
