// The client's copy must not contain the bid desk's own reasoning.
//
// Every case below was found by reading the actual bytes of a submitted
// Technical Proposal.pdf, not by reasoning about the code. Pages 34-35 of that
// artifact carried, under ordinary client-facing headings:
//
//   "Energy / power tender detected but no energy-specific reviewed project
//    is selected. Use the closest electromechanical or infrastructure project
//    and flag the sector gap as a senior bid-review action."
//   "Tender hot-button: ..."
//   "Additional discriminators:"
//   "Client identity (FILE) implies brand-alignment requirements."
//   "Deliverable Format | docx"  (the confirmed Build Plan required PDF)
//   "...built into the technical and financial submission"  (no financial
//    proposal is required by this tender)
//   "Section F: Evaluation Criteria Response Mirror"
//   "Section G: Win Themes and Discriminators"
//
// These are four distinct failures — an internal channel wired to a
// client-facing table, an unvalidated regex treated as an identity, a
// regex-guessed fact overriding the Build Plan, and bid-desk section names —
// so they are pinned separately rather than as one string blacklist.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { stripInternalDiagnosticContent } from "../lib/engine/internal-review-stripper";
import { injectWinThemesTable } from "../lib/engine/win-themes-table";
import { buildCommercialUnderstandingBlock } from "../lib/engine/tender-closers";
import {
  CLIENT_FACING_SECTION_F_HEADING,
  CLIENT_FACING_SECTION_G_HEADING,
  SECTION_F_HEADING_RX,
  SECTION_G_HEADING_RX,
} from "../lib/engine/client-facing-section-titles";

// The exact strings detectGaps() produces. If that function grows a new gap,
// it produces the same shape and the shape test below still holds.
const REAL_ENGINE_GAPS = [
  "Energy / power tender detected but no energy-specific reviewed project is selected. Use the closest electromechanical or infrastructure project and flag the sector gap as a senior bid-review action.",
  "Healthcare tender detected but no clearly healthcare-specific reviewed project is selected. Use the closest renovation/MEP/hospital-adjacent project and explicitly flag the evidence gap as a senior bid-review action.",
  "Tender may require minimum 3 experts; only 1 reviewed expert(s) are selected. Add or review additional experts before final submission.",
];

describe("the engine's internal gap channel never reaches the client's copy", () => {
  it("does not put gap diagnostics in the Section G table", () => {
    // gapsToAddressInNarrative is no longer part of this builder's input at
    // all, so there is no way to pass it in. Building with the tender's own
    // themes must produce a table with none of the gap text in it.
    const { markdown, injected } = injectWinThemesTable("# Proposal\n\n# Section E: Compliance Matrix\n", {
      primarySector: "Healthcare / Medical Facility Design",
      projects: [],
      themes: ["Infection prevention and control zoning", "Medical gas reticulation"],
      evaluationCriteria: ["Relevant healthcare experience"],
      companyName: "Hope Engineering",
    });

    assert.ok(injected, "the Section G table should be injected");
    for (const gap of REAL_ENGINE_GAPS) {
      assert.ok(!markdown.includes(gap), `gap diagnostic leaked into client output: ${gap.slice(0, 60)}`);
    }
    assert.doesNotMatch(markdown, /tender\s+hot[-\s]?button/i);
    assert.doesNotMatch(markdown, /bid[-\s]?team\s+action/i);
    assert.doesNotMatch(markdown, /additional\s+discriminators/i);
    // The tender's own themes are legitimate client content and must survive.
    assert.match(markdown, /Infection prevention and control zoning/);
  });

  it("strips internal-diagnostic shapes that survive inside a client section", () => {
    const md = [
      "## Section G: Why We Are Well Suited",
      "",
      "| # | Requirement | Capability | What This Means | Evidence |",
      "|---|---|---|---|---|",
      `| 1 | ${REAL_ENGINE_GAPS[0]} | a | b | c |`,
      "| 2 | Tender hot-button: clinical workflow | a | Bid-Team Action: confirm quantified discriminator | c |",
      "| 3 | Infection prevention zoning | In-house healthcare MEP team | Adjacency settled from experience | Dr. Abdul Seid Hospital |",
      "",
      "**Additional discriminators:**",
      "- A real capability statement that must survive",
      "",
      "An ordinary client sentence that must survive.",
    ].join("\n");

    const { markdown, removedLines } = stripInternalDiagnosticContent(md);

    assert.equal(removedLines.length, 3);
    for (const shape of [/hot[-\s]?button/i, /tender detected but no/i, /use the closest/i, /additional discriminators/i, /bid[-\s]?team action/i]) {
      assert.doesNotMatch(markdown, shape);
    }
    // Structure and legitimate content both survive.
    assert.match(markdown, /\| # \| Requirement \| Capability \|/);
    assert.match(markdown, /\|---\|---\|---\|---\|---\|/);
    assert.match(markdown, /Infection prevention zoning/);
    assert.match(markdown, /A real capability statement that must survive/);
    assert.match(markdown, /An ordinary client sentence that must survive\./);
  });

  it("never removes a heading or a table header row", () => {
    // A blunt line filter could break a table or delete a section title. The
    // sweep must only ever drop body rows and standalone lines.
    const md = [
      "## Bid-Team Action Plan",
      "",
      "| Bid-Team Action | Owner |",
      "|---|---|",
      "| Bid-Team Action: confirm evidence anchor | Someone |",
      "| A legitimate client row | Someone |",
    ].join("\n");
    const { markdown } = stripInternalDiagnosticContent(md);
    assert.match(markdown, /^## Bid-Team Action Plan$/m, "headings are the section stripper's job, not this pass's");
    assert.match(markdown, /^\| Bid-Team Action \| Owner \|$/m, "a table header row is never removed");
    assert.doesNotMatch(markdown, /confirm evidence anchor/i, "an internal body row is removed");
    assert.match(markdown, /A legitimate client row/, "a legitimate body row survives");
  });
});

describe("client-facing section titles carry no bid-desk vocabulary", () => {
  it("names Sections F and G for the reader they are handed to", () => {
    assert.doesNotMatch(CLIENT_FACING_SECTION_F_HEADING, /mirror/i);
    assert.doesNotMatch(CLIENT_FACING_SECTION_G_HEADING, /win\s+theme|discriminator/i);
    assert.match(CLIENT_FACING_SECTION_F_HEADING, /Response to Evaluation Criteria/i);
    assert.match(CLIENT_FACING_SECTION_G_HEADING, /Why We Are Well Suited/i);
  });

  it("still recognises the older internal names, so no section is duplicated", () => {
    // A proposal generated before the rename, or model output still using the
    // old vocabulary, must match — otherwise a second copy gets injected.
    assert.ok(SECTION_F_HEADING_RX.test("## Section F: Evaluation Criteria Response Mirror"));
    assert.ok(SECTION_F_HEADING_RX.test(`## ${CLIENT_FACING_SECTION_F_HEADING}`));
    assert.ok(SECTION_G_HEADING_RX.test("## Section G: Win Themes and Discriminators"));
    assert.ok(SECTION_G_HEADING_RX.test("## SECTION G: WIN THEMES & DISCRIMINATORS"));
    assert.ok(SECTION_G_HEADING_RX.test(`## ${CLIENT_FACING_SECTION_G_HEADING}`));
  });
});

describe("the Commercial Understanding table states facts the submission owns", () => {
  // The tender text below is realistic: it mentions DOCX only because the
  // source document's own file name was carried into the extracted text.
  const TENDER_TEXT = [
    "Consultancy services for the specialty medical centre.",
    "Source: pharo tender document.docx",
    "The contract price shall remain valid for 90 days.",
    "Payment within 30 days of approved invoice.",
    "Proposals shall be submitted by email.",
  ].join(" ").repeat(3);

  it("uses the confirmed Build Plan format, not a format guessed from tender text", () => {
    const block = buildCommercialUnderstandingBlock(TENDER_TEXT, {
      authoritativeDeliverableFormat: "Technical Proposal.pdf",
      financialProposalRequired: false,
    });

    assert.match(block, /Deliverable Format/i, "the row should still be produced");
    const formatRow = block.split("\n").find((l) => /Deliverable Format/i.test(l)) ?? "";
    assert.match(formatRow, /\bPDF\b/, "the row must state the format actually delivered");
    assert.doesNotMatch(formatRow, /\bdocx\b/i, "a format guessed from tender prose must not override the Build Plan");
    assert.doesNotMatch(block, /issued in DOCX format/i);
  });

  it("falls back to the tender text only when no authoritative format is known", () => {
    const block = buildCommercialUnderstandingBlock(TENDER_TEXT, { authoritativeDeliverableFormat: null });
    const formatRow = block.split("\n").find((l) => /Deliverable Format/i.test(l)) ?? "";
    assert.match(formatRow, /docx/i, "with no Build Plan authority the detected format is still reported");
  });

  it("does not imply a financial submission when the tender requires none", () => {
    const block = buildCommercialUnderstandingBlock(TENDER_TEXT, {
      authoritativeDeliverableFormat: "Technical Proposal.pdf",
      financialProposalRequired: false,
    });
    assert.doesNotMatch(block, /technical\s+and\s+financial\s+submission/i);
    assert.match(block, /built into this technical submission/i);
  });

  it("keeps the two-envelope wording for tenders that do require a financial proposal", () => {
    const block = buildCommercialUnderstandingBlock(TENDER_TEXT, {
      authoritativeDeliverableFormat: "Technical Proposal.pdf",
      financialProposalRequired: true,
    });
    assert.match(block, /technical\s+and\s+financial\s+submission/i);
  });
});
