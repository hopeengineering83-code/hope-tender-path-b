import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cleanTenderTitle, cleanClientName } from "../lib/engine/proposal-labels";

/**
 * THE DEFECT.
 * -----------
 * 2026-09-20, upload-readiness run 35514245343, verbatim:
 *
 *   title=| Architectural Consultancy Services for Pharo Health Ethiopia
 *         Specialty Medical Center
 *
 * The tender arrived as a .docx whose title sits in a table cell. Extraction
 * carried the cell delimiter into the value, and both label cleaners let it
 * through: normalizeLabel() strips control characters, page markers and
 * placeholder phrases but not delimiters, and cleanTenderTitle()'s punctuation
 * strip is anchored to the END of the string:
 *
 *   .replace(/[.,;:\-–—\s]+$/g, "")
 *
 * so a leading one is untouched. cleanTenderTitle() feeds cleanedTenderTitle,
 * which is the client-facing title on every cover page, every document header
 * and the cover-letter subject; cleanClientName() feeds the "To:" line. A
 * stray pipe was therefore going to be printed to the client on page 1.
 *
 * GENERIC, NOT COSMETIC-TO-ONE-TENDER. Any tender whose title or procuring
 * entity sits in a table cell, a bulleted list or a dashed list carries the
 * same artifact, which is why the fixtures below are mostly not the Pharo
 * benchmark: a municipal water utility, a rail programme, a flood-defence
 * study.
 *
 * WHAT MUST NOT BE STRIPPED is the point of the second half of these tests. A
 * title may legitimately begin with a digit, a parenthesis or a quote, and an
 * en dash inside a name is not a list marker.
 */
describe("a table delimiter is not part of the name", () => {
  describe("tender titles", () => {
    it("drops a leading pipe from a table-cell title", () => {
      assert.equal(
        cleanTenderTitle("| Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center", { clientName: "Pharo Health Ethiopia" }),
        "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
      );
    });

    it("drops a leading pipe with no space after it", () => {
      assert.equal(
        cleanTenderTitle("|Design and Supervision of Lagos Rail Resignalling", { clientName: "LAMATA" }),
        "Design and Supervision of Lagos Rail Resignalling",
      );
    });

    it("drops a leading bullet", () => {
      assert.equal(
        cleanTenderTitle("• Non-Revenue Water Reduction Programme, Phase II", { clientName: "Nairobi City Water" }),
        "Non-Revenue Water Reduction Programme, Phase II",
      );
    });

    it("drops a leading hyphen list marker", () => {
      assert.equal(
        cleanTenderTitle("- Feasibility Study for Coastal Flood Defence", { clientName: "Coastal Authority" }),
        "Feasibility Study for Coastal Flood Defence",
      );
    });

    it("drops a run of stacked delimiters", () => {
      assert.equal(
        cleanTenderTitle("|| — Supervision of Rural Road Rehabilitation", { clientName: "Roads Agency" }),
        "Supervision of Rural Road Rehabilitation",
      );
    });

    it("leaves a clean title byte-identical", () => {
      const clean = "Consultancy Services for Solid Waste Master Plan";
      assert.equal(cleanTenderTitle(clean, { clientName: "City Council" }), clean);
    });

    it("keeps a title that legitimately starts with a digit", () => {
      const t = "2026 Framework Agreement for Structural Design Services";
      assert.equal(cleanTenderTitle(t, { clientName: "Public Works" }), t);
    });

    it("keeps a title that legitimately starts with a parenthesis", () => {
      const t = "(Re-tender) Supervision of Water Supply Extension";
      assert.equal(cleanTenderTitle(t, { clientName: "Water Board" }), t);
    });

    it("keeps an en dash that is inside the title, not in front of it", () => {
      const t = "Design Review — Phase III Expansion Works";
      assert.equal(cleanTenderTitle(t, { clientName: "Authority" }), t);
    });
  });

  describe("client names", () => {
    it("drops a leading pipe from a table-cell client name", () => {
      assert.equal(cleanClientName("| Nairobi City Water and Sewerage Company"), "Nairobi City Water and Sewerage Company");
    });

    it("drops a leading bullet from a client name", () => {
      assert.equal(cleanClientName("• Lagos Metropolitan Area Transport Authority"), "Lagos Metropolitan Area Transport Authority");
    });

    it("leaves a clean client name byte-identical", () => {
      assert.equal(cleanClientName("Ministry of Urban Development and Construction"), "Ministry of Urban Development and Construction");
    });

    it("does not turn a delimiter-only value into a real-looking name", () => {
      // "|" alone carries no entity. It must fall through to whatever the
      // cleaner's own unknown-value handling is, never become a printable
      // client the cover letter would address.
      const out = cleanClientName("|");
      assert.equal(/^[|•·\-–—\s]+$/.test(out), false, `a delimiter-only value produced ${JSON.stringify(out)}`);
    });
  });
});
