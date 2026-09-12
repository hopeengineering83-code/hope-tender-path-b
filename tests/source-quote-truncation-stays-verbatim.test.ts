// A stored source quote must remain a VERBATIM SUBSTRING of the tender text.
//
// PROVEN DEFECT (measured on this branch before the fix): both producers of
// `sourceExactQuote` appended a synthetic ellipsis once a paragraph exceeded
// the quote budget:
//
//     `${paragraph.slice(0, maxQuoteChars - 1).trim()}…`
//
// Grounding proves a quote by containment — evidence-grounding's
// isGroundedEvidenceInActiveFiles requires the normalised quote to appear in
// the file's normalised extracted text. The "…" appears nowhere in the tender,
// so containment failed. A 502-character clause matched at sourceConfidence 1.0
// and still grounded FALSE, which surfaces downstream as
// "N mandatory requirement(s) are missing active source evidence" and blocks
// Build Plan, generation and export.
//
// The fix is in the PRODUCER. Relaxing the containment check to tolerate a
// trailing ellipsis would let genuinely foreign or invented quotes pass, which
// is precisely the control that check exists to enforce.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractRequirementSources,
  truncateQuoteVerbatim,
} from "../lib/engine/requirement-source-extractor";
import { buildSourceGroundedRequirementMap } from "../lib/engine/source-grounded-requirement-map";
import { isGroundedEvidenceInActiveFiles } from "../lib/engine/evidence-grounding";

/** 502 characters — ordinary length for a real tender personnel clause. */
const LONG_CLAUSE =
  "The Consultant shall provide a fully qualified Team Leader who holds a recognised postgraduate degree in civil or water engineering and who shall demonstrate not less than fifteen years of continuous professional practice in the detailed design and construction supervision of rural water supply schemes, including at least five years in a comparable East African context, together with documented evidence of leading multidisciplinary teams on donor funded assignments of similar scale and complexity.";

const SOURCE_TEXT = `[Page 1] SECTION 4 KEY PERSONNEL\n\n${LONG_CLAUSE}\n\nEnd of section.`;
const ACTIVE_FILES = [{ id: "f1", extractedText: SOURCE_TEXT, totalPages: 1 }];

const REQUIREMENT = {
  id: "r1",
  title: "Team Leader",
  description:
    "The Team Leader shall demonstrate fifteen years experience in rural water supply schemes design and construction supervision",
};

test("a >420-character clause yields a groundable, ellipsis-free, verbatim quote", () => {
  assert.ok(LONG_CLAUSE.length > 420, "the fixture must actually exceed the extractor budget");

  const [source] = extractRequirementSources({
    tenderFileId: "f1",
    tenderFileText: SOURCE_TEXT,
    requirements: [REQUIREMENT],
  });
  const quote = source.sourceExactQuote!;

  assert.ok(quote.length > 0, "a confident match must still produce a quote");
  assert.ok(!quote.includes("…"), "no synthetic ellipsis may be stored");
  assert.ok(SOURCE_TEXT.includes(quote), "the quote must be a verbatim substring of the source");
  assert.equal(
    isGroundedEvidenceInActiveFiles(source.sourcePageNumber, quote, "f1", ACTIVE_FILES),
    true,
    "a correctly matched clause must ground",
  );
});

test("the separate ~380-character path obeys the same invariant", () => {
  const [mapped] = buildSourceGroundedRequirementMap({
    requirements: [REQUIREMENT.description],
    tenderSources: [{ id: "f1", name: "rfp.pdf", text: SOURCE_TEXT }],
  });

  const quote = mapped.sourceExactQuote!;
  assert.ok(quote.length > 0);
  assert.ok(!quote.includes("…"), "the lexical fallback must not stamp an ellipsis either");
  assert.ok(SOURCE_TEXT.includes(quote), "the fallback quote must be a verbatim substring");
  assert.ok(quote.length <= 380, "the fallback keeps its own shorter budget");
  assert.equal(
    isGroundedEvidenceInActiveFiles(mapped.sourcePageNumber, quote, "f1", ACTIVE_FILES),
    true,
  );
});

test("a quote already inside the budget is returned byte-identical", () => {
  const short = "The bidder shall submit one signed original and two copies.";
  assert.equal(truncateQuoteVerbatim(short, 420), short);
  assert.equal(truncateQuoteVerbatim(short, short.length), short, "exactly at the budget is unchanged");

  const shortSource = `[Page 1] SUBMISSION\n\n${short}\n\nEnd.`;
  const [source] = extractRequirementSources({
    tenderFileId: "f1",
    tenderFileText: shortSource,
    requirements: [{ id: "r1", title: "Copies", description: "The bidder shall submit one signed original and two copies" }],
  });
  assert.equal(source.sourceExactQuote, short, "a short paragraph is stored exactly as written");
});

test("a long unbroken token is hard-cut and still a verbatim substring", () => {
  // A URL, reference code or space-free table row: honouring a word boundary
  // here would throw away nearly all the evidence, so it takes a hard cut.
  const blob = "A".repeat(700);
  const cut = truncateQuoteVerbatim(blob, 420);
  assert.equal(cut.length, 420, "a hard cut uses the full budget");
  assert.ok(blob.includes(cut));
  assert.ok(!cut.includes("…"));

  // A late word boundary is honoured; a very early one is not.
  const lateBreak = `${"B".repeat(300)} tail-word-here${"C".repeat(300)}`;
  assert.ok(lateBreak.includes(truncateQuoteVerbatim(lateBreak, 420)));
  const earlyBreak = `x ${"D".repeat(700)}`;
  const earlyCut = truncateQuoteVerbatim(earlyBreak, 420);
  assert.ok(earlyCut.length > 420 * 0.6, "an early boundary must not discard the evidence");
  assert.ok(earlyBreak.includes(earlyCut));
});

test("the result is always a PREFIX of the paragraph, so containment cannot drift", () => {
  const cases = [
    LONG_CLAUSE,
    `${"word ".repeat(200)}end`,
    "A".repeat(500),
    "short",
    "",
    " leading space then a very long run of text ".repeat(30),
  ];
  for (const text of cases) {
    for (const budget of [1, 17, 380, 420, 10_000]) {
      const cut = truncateQuoteVerbatim(text, budget);
      assert.ok(text.startsWith(cut) || text.trimEnd().startsWith(cut), `must be a prefix: ${budget}`);
      assert.ok(!cut.includes("…"));
      assert.ok(cut.length <= Math.max(budget, text.length));
    }
  }
});

test("neither producer can reintroduce a synthetic ellipsis", () => {
  for (const path of [
    "lib/engine/requirement-source-extractor.ts",
    "lib/engine/source-grounded-requirement-map.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    assert.ok(
      !/sourceExactQuote[^\n]*…|`\$\{[^`]*\}…`/.test(code),
      `${path} must not append an ellipsis to a stored quote`,
    );
  }
});

test("both paths share ONE truncation implementation, not private copies", () => {
  const map = readFileSync("lib/engine/source-grounded-requirement-map.ts", "utf8");
  assert.match(map, /import \{[^}]*truncateQuoteVerbatim[^}]*\} from "\.\/requirement-source-extractor"/);
  assert.match(map, /truncateQuoteVerbatim\(best\.paragraph, LEXICAL_FALLBACK_MAX_QUOTE_CHARS\)/);

  const extractor = readFileSync("lib/engine/requirement-source-extractor.ts", "utf8");
  assert.match(extractor, /export function truncateQuoteVerbatim\(/);
  assert.match(extractor, /truncateQuoteVerbatim\(best\.paragraph, options\.maxQuoteChars\)/);
  // Exactly one implementation across the two producers.
  assert.equal((extractor.match(/export function truncateQuoteVerbatim\(/g) ?? []).length, 1);
  assert.equal((map.match(/function truncateQuoteVerbatim\(/g) ?? []).length, 0);
});

test("grounding is NOT weakened: a foreign or invented quote still fails", () => {
  // The fix must not have made containment permissive.
  assert.equal(
    isGroundedEvidenceInActiveFiles(1, "This sentence appears nowhere in the tender.", "f1", ACTIVE_FILES),
    false,
  );
  assert.equal(
    isGroundedEvidenceInActiveFiles(1, `${LONG_CLAUSE.slice(0, 200)}…`, "f1", ACTIVE_FILES),
    false,
    "a quote carrying the old synthetic ellipsis must still be refused",
  );
});
