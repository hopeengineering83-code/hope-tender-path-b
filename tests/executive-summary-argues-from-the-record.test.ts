import { test } from "node:test";
import assert from "node:assert/strict";

import { buildExecutiveSummaryOpener } from "../lib/engine/benchmark-tables";
import type { ProjectRecord } from "../lib/engine/benchmark-tables";

/**
 * The delivered Executive Summary opened:
 *
 *   "Hope ... brings relevant reviewed experience to this assignment.
 *    G+6 General Hospital – Dr Abdul Seid (Gimba City, South Wollo Zone,
 *    Amhara Region) provides a reference point for the proposed delivery
 *    approach for Pharo Ventures."
 *
 * Every word true, nothing argued. "Relevant experience" is what every bidder
 * claims and "provides a reference point for the proposed delivery approach"
 * says only that a later section exists. The first paragraph an evaluator reads
 * spent itself saying nothing.
 *
 * The overlap between what the client is buying and what the firm has built is
 * the argument, and the record already holds it.
 */

function project(over: Partial<ProjectRecord> & { name: string }): ProjectRecord {
  return {
    name: over.name,
    summary: over.summary ?? null,
    clientName: over.clientName ?? null,
    country: over.country ?? null,
    sector: over.sector ?? null,
    serviceAreas: over.serviceAreas ?? null,
    contractValue: over.contractValue ?? null,
    currency: over.currency ?? null,
  } as unknown as ProjectRecord;
}

const HOSPITAL = project({
  name: "G+6 General Hospital – Dr Abdul Seid",
  sector: "Healthcare",
  country: "Ethiopia",
  summary:
    "G+6 General Hospital – Dr Abdul Seid / Gimba City, South Wollo Zone, Amhara Region, Ethiopia (7,000 m²). " +
    "Feasibility study, Soil investigation, Laboratory testing, New Architectural design, New Structural design, " +
    "Complete MEP Design, Construction supervision. 2015-2018 E.C.",
});

const ROAD = project({
  name: "Woyraw to Elkibye Gravel Road",
  sector: "Roads",
  country: "Ethiopia",
  summary: "Woyraw to Elkibye High Standard Gravel Road, 5 km. Topographic survey, Pavement design, Drainage design, Construction supervision.",
});

test("the summary states what the firm built, not that a later section exists", () => {
  const opener = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "Pharo Ventures",
    projects: [HOSPITAL],
    reviewedExpertCount: 3,
  });

  // The concrete evidence, from the record's own words.
  assert.match(opener, /7,000 m²/, "the scale the record states is missing");
  assert.match(opener, /Ethiopia/);
  assert.match(opener, /Feasibility study/);
  assert.match(opener, /Architectural design/);

  // The empty formulations that used to fill this paragraph.
  assert.ok(!/provides a reference point/i.test(opener));
  assert.ok(!/relevant reviewed experience/i.test(opener));
  assert.ok(!/\breviewed\b/i.test(opener), "engine vocabulary reached the summary");
});

test("the lead claims comparability, never identity of scope", () => {
  // A healthcare record is the closest thing this firm has to a ROADS tender.
  // Saying it "has delivered the scope the client is procuring" would be false,
  // and this app must survive exactly that case.
  const crossSector = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "Ethiopian Roads Authority",
    projects: [HOSPITAL],
    reviewedExpertCount: 3,
  });
  assert.ok(!/has delivered the scope/i.test(crossSector));
  assert.match(crossSector, /closest comparable assignment/i);
});

test("a record that states less produces a shorter sentence, never a filled gap", () => {
  const bare = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "A Client",
    projects: [project({ name: "An Assignment" })],
    reviewedExpertCount: 0,
  });
  assert.match(bare, /An Assignment/);
  // No invented scale, location or service list.
  assert.ok(!/\bm²|\bkm\b|\bha\b/.test(bare));
  assert.ok(!/on which the firm performed/.test(bare));
  assert.ok(!/\bvarious\b|\bnumerous\b|\ba range of\b/i.test(bare), "a gap was filled with a generality");
});

test("the service list is capped so the paragraph stays a paragraph", () => {
  const opener = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "Pharo Ventures",
    projects: [HOSPITAL],
    reviewedExpertCount: 3,
  });
  const listed = (opener.match(/performed ([^.]+)\./) ?? ["", ""])[1];
  assert.ok(listed.split(",").length <= 6, `too many services in one sentence: ${listed}`);
});

test("a scale that wraps in the source does not wrap in the sentence", () => {
  // The road record's rawText breaks between the number and its unit; that
  // reached the sentence as a line break mid-phrase.
  const opener = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "Ethiopian Roads Authority",
    projects: [ROAD],
    reviewedExpertCount: 1,
  });
  assert.ok(!/\n/.test(opener.split("**")[1] ?? ""), "a newline survived inside the lead sentence");
  assert.match(opener, /5 km/);
});

test("two projects are two distinct pieces of evidence", () => {
  const opener = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "A Client",
    projects: [HOSPITAL, ROAD],
    reviewedExpertCount: 3,
  });
  assert.match(opener, /G\+6 General Hospital/);
  assert.match(opener, /Woyraw to Elkibye/);
  assert.match(opener, /The firm also delivered/);
  assert.match(opener, /Pavement design/, "the second project's own services are missing");
});

test("no project at all still avoids naming this app's evidence store", () => {
  const opener = buildExecutiveSummaryOpener({
    companyName: "Hope PLC",
    clientName: "A Client",
    projects: [],
    reviewedExpertCount: 3,
    topExpertName: "Ahmed Kebede Tekaw",
    topExpertTitle: "General Manager",
  });
  assert.ok(!/knowledge vault|firm's vault/i.test(opener));
  assert.match(opener, /Ahmed Kebede Tekaw/);
});

test("no bold run closes immediately before punctuation", () => {
  // Closing a bold run mid-sentence put the run boundary right before a comma,
  // and the delivered PDF read "a 7,000 m² project in Ethiopia , on which the
  // firm performed ...".
  for (const projects of [[HOSPITAL], [HOSPITAL, ROAD], []]) {
    const opener = buildExecutiveSummaryOpener({
      companyName: "Hope PLC",
      clientName: "A Client",
      projects,
      reviewedExpertCount: 2,
      topExpertName: "Ahmed Kebede Tekaw",
    });
    assert.ok(!/\*\*\s*[,.;:]/.test(opener), `a bold run closes before punctuation:\n  ${opener}`);
    assert.ok(!/\s+[,.;:]/.test(opener), `a space precedes punctuation:\n  ${opener}`);
  }
});
