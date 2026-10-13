// A glyph the PDF face cannot draw fails silently, in the client's copy.
//
// Reproduced defect (live Preview, run 34698133772). The delivered 35-page
// PDF opened Section A with the firm's headline capability tiles, and the
// extracted text of one of them began with a NUL byte:
//
//     <U+0000> Donor / international institution delivery track record on file
//
// A NUL in the text layer is what .notdef looks like after extraction. The
// source was a hard-coded U+2713 CHECK MARK in buildPortfolioMetricsBlock.
//
// WHY IT WAS SILENT. pdf-unicode-fonts deliberately switches to an embedded
// Unicode face whenever text is not WinAnsi-encodable - that exists so a real
// Ethiopic character in a real Ethiopian tender renders instead of ending the
// export. An UNENCODABLE character throws, and is therefore caught in
// development. A character the embedded face simply has no glyph for does
// not: it draws .notdef and ships.
//
// THE RULE THIS PINS. Script and accented characters in client-facing content
// come from DATA - a person's name, a place, a quoted requirement - and must
// keep rendering through the embedded faces. Decoration hard-coded in a
// TEMPLATE has no such claim, so it stays inside WinAnsi, where the standard
// faces are guaranteed to draw it. The check is behavioural: it renders the
// block and inspects the characters, rather than grepping for one symbol.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildPortfolioMetricsBlock, type PortfolioMetrics } from "../lib/engine/portfolio-metrics";
import { isWinAnsiEncodable, sanitizePdfText } from "../lib/engine/pdf-unicode-fonts";

// Every tile switched on at once, so no branch escapes the check.
const ALL_TILES: PortfolioMetrics = {
  reviewedProjectCount: 4,
  reviewedExpertCount: 3,
  totalContractValue: 675_000_000,
  currency: "ETB",
  countriesCovered: ["Ethiopia", "Kenya"],
  topSectors: ["Healthcare", "Water", "Roads"],
  certificationsCount: 6,
  uniqueDisciplines: ["Architecture", "Structural Engineering", "MEP"],
  hasDonorEvidence: true,
};

describe("client-facing proposal content stays renderable", () => {
  it("the portfolio block contains no character the standard faces cannot draw", () => {
    // Exactly the pipeline order: the renderer sanitises first (newlines and
    // tabs become spaces, other control characters are dropped) and only then
    // asks which face can encode what is left. Checking the raw markdown
    // would flag its own line breaks.
    const block = sanitizePdfText(buildPortfolioMetricsBlock(ALL_TILES, "Test Consultancy PLC"));
    const offenders = [...block]
      .filter((character) => !isWinAnsiEncodable(character))
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
    assert.deepEqual(
      offenders,
      [],
      "template decoration must stay inside WinAnsi; an embedded face may have no glyph for it and will draw .notdef silently",
    );
    assert.equal(isWinAnsiEncodable(block), true);
  });

  it("the donor tile still says what it said, minus the dingbat", () => {
    const block = buildPortfolioMetricsBlock(ALL_TILES, "Test Consultancy PLC");
    assert.match(block, /Donor \/ international institution delivery track record on file/);
    assert.equal(block.includes("\u2713"), false);
  });

  it("data-borne script characters are still carried through", () => {
    // The counterpart guard. A country or company name in a non-Latin script
    // must NOT be stripped or rejected - the embedded faces exist precisely
    // for it. The renderer, not this layer, decides which face draws it.
    const ethiopic = { ...ALL_TILES, countriesCovered: ["\u12A2\u1275\u12EE\u1335\u12EB"] };
    const block = buildPortfolioMetricsBlock(ethiopic, "\u12E8\u1206\u1355 Consultancy");
    assert.equal(block.includes("\u12A2\u1275\u12EE\u1335\u12EB"), true);
    assert.equal(block.includes("\u12E8\u1206\u1355"), true);
  });
});
