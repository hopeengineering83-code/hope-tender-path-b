/**
 * A delivered list says what it holds, and a subject template names the bidder.
 *
 * 2026-10-05 hands-off acceptance (office-design EOI): the cover page read
 * "Subject: [RFQ#2026-024 Your Company Name]"; the Executive Summary read
 * "Five reasons grounded in reviewed evidence:" over items numbered 2, 4 and 5;
 * the cover letter read "Key differentiators that make us well-placed to serve
 * this assignment:" over nothing but its closing sentence. Later passes had
 * removed items after the lists were written; nothing renumbered or recounted
 * them. And the final DOCX re-rendered only when an AI refinement or addendum
 * ran, so every late repair was dropped on a run without one.
 *
 * Fixtures are generic (a water-supply consultancy, a road-works RFQ).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { repairListIntegrity } from "../lib/engine/client-text-hygiene";
import { withBidderName } from "../lib/engine/proposal-labels";

describe("withBidderName", () => {
  it("fills the bidder-name placeholder of a subject template", () => {
    assert.equal(
      withBidderName("[RFQ#2031-118 Your Company Name]", "Riverbend Water Consultants PLC"),
      "[RFQ#2031-118 Riverbend Water Consultants PLC]",
    );
    assert.equal(
      withBidderName("Bid for Road Works Lot 3 - <Name of Bidder>", "Atlas Civil Works"),
      "Bid for Road Works Lot 3 - Atlas Civil Works",
    );
    assert.equal(withBidderName("EOI 44/2031 — Consultant's Name", "Atlas Civil Works"), "EOI 44/2031 — Atlas Civil Works");
  });

  it("leaves a subject without a placeholder, or without a known name, unchanged", () => {
    assert.equal(withBidderName("RFQ 2031-118 Water Supply Design", "Atlas Civil Works"), "RFQ 2031-118 Water Supply Design");
    assert.equal(withBidderName("[RFQ#2031-118 Your Company Name]", "  "), "[RFQ#2031-118 Your Company Name]");
    assert.equal(withBidderName(null, "Atlas Civil Works"), null);
  });
});

describe("repairListIntegrity", () => {
  it("renumbers a list whose items were removed and restates its counted lead-in", () => {
    const input = [
      "## Why Riverbend for the Water Utility",
      "Five reasons grounded in reviewed evidence:",
      "",
      "2. **Delivery record.** Twelve completed schemes.",
      "4. **Team.** A named hydraulic engineer.",
      "5. **Quality discipline.** Three-stage review.",
    ].join("\n");
    const { text, renumberedLists } = repairListIntegrity(input);
    assert.equal(renumberedLists, 1);
    assert.match(text, /^Three reasons grounded in reviewed evidence:$/m);
    assert.match(text, /^1\. \*\*Delivery record/m);
    assert.match(text, /^2\. \*\*Team/m);
    assert.match(text, /^3\. \*\*Quality discipline/m);
  });

  it("keeps a list deliberately continued after a paragraph", () => {
    const input = ["## Method", "1. Survey.", "2. Design.", "", "Between design and tender the client reviews every drawing set.", "", "3. Tender.", "4. Supervise."].join("\n");
    const { text, renumberedLists } = repairListIntegrity(input);
    assert.equal(renumberedLists, 0);
    assert.equal(text, input);
  });

  it("continues numbering after a paragraph when a middle item was removed", () => {
    const input = ["## Method", "1. Survey.", "", "Field crews mobilise within a week of award.", "", "3. Tender."].join("\n");
    const { text } = repairListIntegrity(input);
    assert.match(text, /^2\. Tender\.$/m);
  });

  it("does not renumber nested lists into their parent", () => {
    const input = ["1. Inception", "   1. Kick-off meeting", "   2. Data request", "2. Design"].join("\n");
    assert.equal(repairListIntegrity(input).text, input);
  });

  it("restarts numbering under a new heading", () => {
    const input = ["## A", "1. One.", "2. Two.", "## B", "1. Alpha.", "2. Beta."].join("\n");
    assert.equal(repairListIntegrity(input).text, input);
  });

  it("drops a lead-in left over nothing but the closing sentence", () => {
    const input = [
      "We are pleased to submit our proposal.",
      "",
      "Key differentiators that make us well-placed to serve this assignment:",
      "We trust this proposal demonstrates our capacity, commitment, and technical depth.",
    ].join("\n");
    const { text, droppedLeadIns } = repairListIntegrity(input);
    assert.equal(droppedLeadIns, 1);
    assert.doesNotMatch(text, /Key differentiators/);
    assert.match(text, /We trust this proposal/);
  });

  it("drops a lead-in followed by a heading or the end of the document", () => {
    assert.equal(repairListIntegrity("Our approach rests on the following principles:\n\n## Section C").text, "\n## Section C");
    assert.equal(repairListIntegrity("Our approach rests on the following principles:").text, "");
  });

  it("keeps a lead-in that introduces a list, a table, bold-led points or form fields", () => {
    const kept = [
      "Our approach rests on the following principles:\n- Safety first.",
      "The proposed key experts are listed below:\n\n| Role | Name |\n|---|---|",
      "Our approach rests on the following three principles:\n**Principle one.** Design for maintenance.",
      "Name and title of the authorised representative:\nSignature:",
      "I, the undersigned, hereby declare the following:\n1. We are not debarred.",
    ];
    for (const input of kept) assert.equal(repairListIntegrity(input).text, input, input);
  });

  it("never touches content inside a fenced block", () => {
    const input = "```\n2. raw\n4. raw\nA lead-in sentence that ends here with a colon:\n```";
    assert.equal(repairListIntegrity(input).text, input);
  });
});

describe("the final DOCX is rendered from the repaired markdown", () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("runs list integrity before the last prose hygiene pass", () => {
    const integrity = source.indexOf("repairListIntegrity(workingMarkdown)");
    const hygiene = source.indexOf("repairClientTextHygiene(workingMarkdown)");
    assert.ok(integrity > 0 && hygiene > integrity);
  });

  it("re-renders whenever the markdown changed since the first render, not only after refinement", () => {
    assert.match(source, /const markdownChangedSinceFirstRender = workingMarkdown !== humanizedMarkdown;/);
    assert.match(source, /const rerender = refinementApplied \|\| repairAddendaApplied \|\| markdownChangedSinceFirstRender;/);
    assert.match(source, /const finalChildren = rerender \? markdownToDocx\(workingMarkdown\) : children;/);
    assert.match(source, /const finalDoc = rerender\s*\n?\s*\?/);
  });

  it("fills the bidder name into every subject line the writer and fallback use", () => {
    const subjectSites = source.match(/exactSubjectLine:\s*withBidderName\(/g) ?? [];
    assert.ok(subjectSites.length >= 2, `expected both writer subject sites wrapped, saw ${subjectSites.length}`);
    assert.doesNotMatch(source, /exactSubjectLine:\s*writerTender\.submissionEmailSubject \?\? intelligence\.exactSubjectLine,/);
  });
});
