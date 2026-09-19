import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pickBestTenderTitle } from "../lib/engine/tender-title-extractor";

/**
 * THE DEFECT, read off a real Preview upload (2026-09-14).
 * ---------------------------------------------------------
 * The upload-readiness report printed the stored tender title as:
 *
 *   title=| Architectural Consultancy Services for Pharo Health Ethiopia
 *         Specialty Medical Center
 *
 * A tender title is very often read out of a one-row table -- "Project Title |
 * <the title>" -- and the cell separator travelled with the text.
 * pickBestTenderTitle treats any stored title of 30+ characters as substantive
 * and returns it verbatim, so the leading pipe reached the cover page, the
 * document header and the required email subject line: the three things an
 * evaluator reads first, and the one field a procurement officer matches
 * against their own records.
 *
 * Worse, the pipe and its padding COUNT toward the 30-character test that
 * decides whether a stored title is substantive at all, so furniture could
 * promote a title that would otherwise have been replaced by the extractor.
 *
 * Stripping is deliberately narrow: only leading glyphs where no title can
 * legitimately begin (pipe, bullet, list dash) and trailing pipes/space. A
 * title starting with a digit or a bracket is untouched, and isJunkTitle
 * still rejects enumerator captures.
 */

describe("a table cell separator is not part of the tender title", () => {
  it("strips the leading pipe the real upload carried", () => {
    const { title } = pickBestTenderTitle(
      "| Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center",
      null,
    );
    assert.equal(title, "Architectural Consultancy Services for Pharo Health Ethiopia Specialty Medical Center");
  });

  it("strips furniture across sectors, not one benchmark string", () => {
    for (const [stored, expected] of [
      ["| Detailed Design and Construction Supervision of Kombolcha Water Supply Scheme",
       "Detailed Design and Construction Supervision of Kombolcha Water Supply Scheme"],
      ["• Consultancy Services for Feasibility Study of the Modjo-Hawassa Road Corridor",
       "Consultancy Services for Feasibility Study of the Modjo-Hawassa Road Corridor"],
      ["- Supply and Installation of a Utility Billing and Revenue Management System",
       "Supply and Installation of a Utility Billing and Revenue Management System"],
      ["|  Geotechnical Investigation for the Afar Solar Mini-Grid Programme  |",
       "Geotechnical Investigation for the Afar Solar Mini-Grid Programme"],
    ] as const) {
      assert.equal(pickBestTenderTitle(stored, null).title, expected, stored);
    }
  });

  it("does not strip characters a real title may begin with", () => {
    for (const stored of [
      "2026 Framework Agreement for Cold-Chain Logistics Design Services",
      "(Re-advertised) Consultancy Services for the Regional Referral Hospital",
      "A2 Highway Section Upgrading Design Review and Supervision Services",
    ]) {
      assert.equal(pickBestTenderTitle(stored, null).title, stored, stored);
    }
  });

  it("judges substantiveness on the cleaned title, not on the furniture's length", () => {
    // "| | | Water Tender" is 18 characters of title padded to 30+. Before the
    // fix the padding alone could make a generic title look substantive.
    const extracted = {
      title: "Consultancy Services for the Design of the Regional Water Supply Scheme",
      confidence: 0.88,
      source: "RFP_FOR_SCOPE",
    } as Parameters<typeof pickBestTenderTitle>[1];
    const { title, source } = pickBestTenderTitle("|  •  |   Water Tender   |", extracted);
    assert.equal(source, "EXTRACTED");
    assert.equal(title, "Consultancy Services for the Design of the Regional Water Supply Scheme");
  });

  it("still keeps a substantive stored title over a weaker extraction", () => {
    // The negative that matters: this must not become "always prefer extracted".
    const extracted = {
      title: "Services for Something Else Entirely",
      confidence: 0.5,
      source: "SERVICE_FOR_ENTITY",
    } as Parameters<typeof pickBestTenderTitle>[1];
    const stored = "Consultancy Services for Detailed Design of the Bahir Dar Bus Terminal";
    assert.equal(pickBestTenderTitle(stored, extracted).title, stored);
  });

  it("still falls back rather than returning an empty title", () => {
    assert.equal(pickBestTenderTitle("|||", null).title, "Tender Submission");
    assert.equal(pickBestTenderTitle(null, null).title, "Tender Submission");
  });
});
