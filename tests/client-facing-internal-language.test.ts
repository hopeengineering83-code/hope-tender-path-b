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
import { readFileSync } from "node:fs";

import { stripInternalDiagnosticContent } from "../lib/engine/internal-review-stripper";
import { injectWinThemesTable } from "../lib/engine/win-themes-table";
import { buildCommercialUnderstandingBlock, buildEthicsDeclarationBlock } from "../lib/engine/tender-closers";
import { buildThreeStageReviewTable } from "../lib/engine/benchmark-tables";
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

describe("declarations state what the company authority can support", () => {
  it("does not claim each proposed person has already signed the Code of Ethics", () => {
    // The company authority records that an ethics framework exists. It holds
    // no per-person signature evidence, and codeOfEthicsRef is null on every
    // production call — so the old clause asserted a completed act by named
    // individuals against a document nothing in the vault identifies.
    const block = buildEthicsDeclarationBlock({
      companyName: "Hope Engineering",
      legalName: "Hope Engineering PLC",
      gmName: "A. Person",
      gmTitle: "General Manager",
      gmLicense: null,
      codeOfEthicsRef: null,
      countryLegalCitation: null,
    });

    assert.doesNotMatch(block, /have\s+signed\s+the\s+Bidder's\s+Code\s+of\s+Ethics/i);
    assert.doesNotMatch(block, /All\s+personnel\s+proposed[^.]*have\s+signed/i);
    // A policy plus a forward commitment is both true and defensible.
    assert.match(block, /Acceptance of that framework is a condition of assignment/i);
    // With no identified Code, no document reference is invented.
    assert.doesNotMatch(block, /the firm's internal Code of Ethics document/i);
  });

  it("cites the Code of Ethics only when the vault identifies one", () => {
    const block = buildEthicsDeclarationBlock({
      companyName: "Hope Engineering",
      legalName: null,
      gmName: "A. Person",
      gmTitle: null,
      gmLicense: null,
      codeOfEthicsRef: "HAEC/125/22",
      countryLegalCitation: null,
    });
    assert.match(block, /Code of Ethics \(HAEC\/125\/22\)/);
    assert.match(block, /condition of assignment/i);
    assert.doesNotMatch(block, /have\s+signed/i);
  });

  it("does not assert an existing whistleblowing channel the vault never recorded", () => {
    const block = buildEthicsDeclarationBlock({
      companyName: "Hope Engineering",
      legalName: null,
      gmName: "A. Person",
      gmTitle: null,
      gmLicense: null,
      codeOfEthicsRef: null,
      countryLegalCitation: null,
    });
    assert.doesNotMatch(block, /maintains an internal whistleblowing channel/i);
    // The forward commitment for this engagement is what the firm can make.
    assert.match(block, /may raise an integrity concern in confidence/i);
    assert.match(block, /protect the person who raises it from retaliation/i);
  });

  it("does not claim a documented QMS, an ISO alignment or certified projects", () => {
    const qa = buildThreeStageReviewTable("Hope Engineering", "Healthcare / Medical Facility Design");
    assert.doesNotMatch(qa, /Quality Management System/i);
    assert.doesNotMatch(qa, /ISO\s*9001/i);
    assert.doesNotMatch(qa, /certified projects/i);
    // The commitment this proposal actually makes survives.
    assert.match(qa, /three mandatory stages before issue/i);
    assert.match(qa, /written sign-off/i);
  });
});

// The brand-alignment row must name the client, or name nobody.
//
// This row shipped "Client identity (FILE) implies brand-alignment
// requirements" because FILE was the first all-caps run in the parsed tender.
// FILE was added to a non-brand blacklist, and hosted run 33994698504 then
// shipped "Client identity (CLIENT)" from the very same line. The heuristic —
// first run of three or more capitals — cannot succeed: CLIENT, CONSULTANT,
// EMPLOYER, CONTRACTOR and PROCURING ENTITY are the standard capitalised
// defined terms of a construction tender, so its most likely answer is always
// a defined term. The row now takes the extracted, source-grounded client name
// that every other section uses, and is built without an identity clause when
// there is none.
describe("the brand-alignment obstacle names the real client", () => {
  const tenderText = [
    "REQUEST FOR PROPOSAL — ARCHITECTURAL CONSULTANCY SERVICES",
    "The CLIENT shall provide access to the site. The CONSULTANT shall submit",
    "deliverables in DWG and PDF format. See www.example-client.org for details.",
    "FILE: tender.docx  PAGE: 1  STATUS: MANDATORY",
    "The EMPLOYER reserves the right to reject any bid.",
  ].join("\n").repeat(4);

  it("never prints a capitalised defined term or a source label as the client's identity", async () => {
    const { buildTenderObstaclesBlock } = await import("../lib/engine/tender-closers");
    for (const name of [null, undefined, "", "CLIENT", "Client", "PROCURING ENTITY", "FILE", "Consultant"]) {
      const block = buildTenderObstaclesBlock(tenderText, name as string | null);
      // Assert the whole class, not the two literals already seen shipping:
      // no identity clause may name anything at all when the grounded client
      // name is absent or is a bare role word.
      assert.doesNotMatch(
        block,
        /identity\s*\(/i,
        `clientName=${String(name)} must produce no identity clause — got: ${block.slice(0, 400)}`,
      );
      // And no token lifted out of the tender prose may appear in parentheses
      // anywhere in the row, whichever all-caps word happened to come first.
      for (const leaked of ["FILE", "PAGE", "STATUS", "MANDATORY", "CLIENT", "CONSULTANT", "EMPLOYER", "REQUEST", "ARCHITECTURAL"]) {
        assert.ok(
          !block.includes(`(${leaked})`),
          `clientName=${String(name)} leaked (${leaked}) into the client's copy — got: ${block.slice(0, 400)}`,
        );
      }
    }
  });

  it("names the client when the extracted identity is a real organisation", async () => {
    const { buildTenderObstaclesBlock } = await import("../lib/engine/tender-closers");
    const block = buildTenderObstaclesBlock(tenderText, "Pharo Ventures");
    assert.match(block, /Pharo Ventures/, "the grounded client name belongs in the brand-alignment row");
    assert.doesNotMatch(block, /\(CLIENT\)|\(FILE\)/);
  });

  it("falls back to the web-presence wording rather than inventing an identity", async () => {
    const { buildTenderObstaclesBlock } = await import("../lib/engine/tender-closers");
    const block = buildTenderObstaclesBlock(tenderText, null);
    assert.match(
      block,
      /references the client's own web presence/,
      "with no grounded client name the row states the fact it has, not a guess",
    );
  });

  it("does not read an identity out of the tender prose at all", () => {
    // The producer must not reach for the tender text for this. A future edit
    // that reintroduces a capitalisation scan silently restores the defect.
    const source = readFileSync("lib/engine/tender-closers.ts", "utf8");
    const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    assert.doesNotMatch(
      code,
      /firstBrandLikeToken/,
      "the all-caps brand guess must not come back",
    );
  });
});

// Vault punctuation must not reach the client as a dangling separator.
//
// Hosted run 33994698504's page 32 read "Consistent with the firm's delivery
// on G+6 General Hospital – Dr Abdul Seid (Gimba City, South Wollo Zone,
// Amhara Region,)." The country field is stored with its own trailing comma,
// and the evidence-marker detail joined the parts raw before wrapping them in
// parentheses.
describe("evidence markers do not ship dangling punctuation", () => {
  it("never emits a bracket that opens or closes on a separator", () => {
    const source = readFileSync("lib/engine/evidence-marker-injector.ts", "utf8");
    assert.match(
      source,
      /cleanedParts/,
      "the evidence-marker detail must join cleaned parts, not raw vault values",
    );
    assert.doesNotMatch(
      source,
      /\$\{detailParts\.join\(", "\)\}/,
      "raw detailParts must not be interpolated into the client-facing bracket",
    );
  });
});

// A proposal must not read as a file someone pasted in.
//
// Pages 7-8 of hosted run 33994698504's Technical Proposal.pdf printed, under
// "A.4.1 Principal Qualifications — Detailed Bios":
//
//   Profile. HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC
//   CURRICULUM VITAE ENG. AHMED KEBEDE TEKAW General Manager & Practicing
//   Professional Engineer … 1. PERSONNEL INFORMATION Proposed Position General
//   Manager & Practicing Professional Engineer Name of Firm Hope Urban Planning
//   Architectural and Engineering Consultan
//
// Two defects in one line: the CV document's own furniture reached the client,
// and the text stopped mid-word because the producer hard-sliced it. The word
// boundary cutter already existed for exactly this; this producer never used it.
const REAL_SHIPPED_PROFILE = "HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY PLC "
  + "CURRICULUM VITAE ENG. AHMED KEBEDE TEKAW General Manager & Practicing Professional Engineer "
  + "Structural Engineer · Geotechnical Engineer · Project Manager Major Projects | 5 International "
  + "| 11+ Years Experience 1. PERSONNEL INFORMATION Proposed Position General Manager & Practicing "
  + "Professional Engineer Name of Firm Hope Urban Planning Architectural and Engineering Consultancy PLC "
  + "and has led the structural design of multi-storey hospital buildings across the Amhara Region.";

describe("expert bios read as prose, not as a pasted CV file", () => {
  it("removes the CV document's own furniture", async () => {
    const { withoutCvDocumentFurniture } = await import("../lib/engine/proposal-intelligence");
    const cleaned = withoutCvDocumentFurniture(REAL_SHIPPED_PROFILE);

    for (const furniture of [/CURRICULUM\s+VITAE/i, /PERSONNEL\s+INFORMATION/i, /Name of Firm/i, /Proposed Position/i]) {
      assert.doesNotMatch(cleaned, furniture, `document furniture survived: ${cleaned.slice(0, 200)}`);
    }
    // The substantive narrative must survive untouched.
    assert.match(cleaned, /led the structural design of multi-storey hospital buildings/);
  });

  it("never leaves a bio stopping mid-word", async () => {
    const { buildPrincipalQualificationsSection } = await import("../lib/engine/principal-qualifications");
    const section = buildPrincipalQualificationsSection({
      experts: [{
        fullName: "Ahmed Kebede Tekaw",
        title: "General Manager & Practicing Professional Engineer",
        profile: REAL_SHIPPED_PROFILE,
        disciplines: ["Structural Engineering"],
        sectors: ["Healthcare"],
        certifications: [],
        yearsExperience: 11,
      } as never],
    });
    assert.ok(section, "the section should build");
    assert.ok(!section!.includes("Consultan "), "a bio must not stop mid-word");
    assert.ok(!/\bConsultan$/m.test(section!), "a bio must not end mid-word");
    // A cut bio is marked as shortened rather than simply stopping.
    const profileLine = section!.split("\n").find((line) => line.startsWith("**Profile.**")) ?? "";
    if (profileLine.length > 0 && !profileLine.includes("Amhara Region")) {
      assert.match(profileLine, /…$/, "a shortened bio ends with an ellipsis");
    }
  });

  it("does not tell the client what the bid desk should confirm", async () => {
    const source = readFileSync("lib/engine/personnel-deep.ts", "utf8");
    const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    assert.doesNotMatch(
      code,
      /"Bid-Team Action[^"]*"/,
      "an empty vault field must not render as an instruction to the bid desk",
    );
  });
});
