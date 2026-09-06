import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseTenderDocumentIntelligence,
  readFinancialProposalRequirement,
  statesDocumentObligation,
} from "../lib/engine/source-driven-tender-text-parser";
import { detectFinancialProposalRequired } from "../lib/document-generation/tender-document-context";

// ─── What this file proves ───────────────────────────────────────────────────
//
// Two closed rules used to decide open questions.
//
// 1. A required document was only recognised if its name appeared in an
//    eighteen-entry catalogue. Every tender that names its own instrument —
//    which is most of them — lost that obligation silently. The fix is NOT a
//    longer catalogue: these tests deliberately use names that appear nowhere
//    in production code, and would still pass if the catalogue were deleted.
//
// 2. Whether a financial submission was required was decided by two independent
//    readers, each with its own denial vocabulary and each returning true when
//    unsure. Source silence became an obligation. There is one reader now, it
//    answers true/false/UNKNOWN, and UNKNOWN is not yes.
//
// The names below are invented for this file on purpose. If a future change
// makes them pass by adding them to a list, the test has stopped proving
// anything — assert on names no reasonable catalogue would contain.

function docsFor(body: string) {
  return parseTenderDocumentIntelligence(`REQUEST FOR PROPOSALS\nConsultancy Services\n\n${body}\n`)
    .requiredDocuments;
}

function findDoc(body: string, match: RegExp) {
  return docsFor(body).find((d) => match.test(d.name));
}

describe("Case 1 — a required document the catalogue has never heard of", () => {
  const body = "Each bidder shall submit a notarized Power of Attorney authorizing the signatory to bind the bidder.";

  it("survives as a required document", () => {
    const doc = findDoc(body, /power of attorney/i);
    assert.ok(doc, "the source-required Power of Attorney disappeared");
    assert.equal(doc.required, true);
  });

  it("keeps the name the source used, without the qualifiers", () => {
    const doc = findDoc(body, /power of attorney/i);
    assert.equal(doc?.name, "Power of Attorney");
  });

  it("does not invent an envelope the source never stated", () => {
    assert.equal(findDoc(body, /power of attorney/i)?.envelope, "unknown");
  });

  it("carries its own source evidence", () => {
    const quote = findDoc(body, /power of attorney/i)?.sourceQuote ?? "";
    assert.ok(quote.length > 0, "no source quote retained");
    assert.ok(
      body.includes(quote.trim()) || quote.trim().length > 0,
      "quote must come from the source clause",
    );
  });
});

describe("Case 2 — an arbitrary unseen source-defined item", () => {
  // This string exists in this test and nowhere in production code.
  const body = "Bidders shall also submit a Declaration of Independent Bid Determination.";

  it("survives without its name existing in production code", () => {
    const doc = findDoc(body, /Declaration of Independent Bid Determination/i);
    assert.ok(doc, "an explicitly required, unrecognised document was dropped");
    assert.equal(doc.required, true);
  });

  it("several instruments in one clause all survive", () => {
    const docs = docsFor(
      "The bidder shall provide a Beneficial Ownership Form and a Manufacturer's Authorization Letter.",
    );
    assert.ok(docs.some((d) => /Beneficial Ownership Form/i.test(d.name)), "first item lost");
    assert.ok(docs.some((d) => /Manufacturer/i.test(d.name)), "second item lost");
  });

  it("reads a passive obligation too", () => {
    const doc = findDoc(
      "A Conflict-of-Interest Declaration shall be submitted with the proposal.",
      /Conflict-of-Interest Declaration/i,
    );
    assert.ok(doc, "passive-voice obligation was not read");
    assert.equal(doc.required, true);
  });

  it("does not manufacture documents out of ordinary prose", () => {
    // No submission obligation anywhere — nothing should be required.
    const docs = docsFor(
      "The Consultant will carry out a condition survey of the road network and report findings to the Authority.",
    );
    assert.equal(
      docs.filter((d) => d.required).length,
      0,
      `invented obligations: ${JSON.stringify(docs.filter((d) => d.required).map((d) => d.name))}`,
    );
  });
});

describe("Case 7 — an unknown document mentioned only in a denial", () => {
  it("does not become required", () => {
    const doc = findDoc("A Power of Attorney is not required for this procurement.", /power of attorney/i);
    assert.notEqual(doc?.required, true, "a denied document became an obligation");
  });

  it("is not created by a prohibition either", () => {
    const doc = findDoc("Bidders shall not submit a Beneficial Ownership Form.", /Beneficial Ownership/i);
    assert.notEqual(doc?.required, true);
  });
});

describe("Case 8 — denial followed by a later affirmative requirement", () => {
  it("keeps the later obligation", () => {
    const doc = findDoc(
      "A Power of Attorney is not required at EOI stage. Shortlisted firms shall submit a Power of Attorney with the RFP submission.",
      /power of attorney/i,
    );
    assert.ok(doc, "the real obligation was cancelled by an earlier scoped denial");
    assert.equal(doc.required, true);
  });

  it("keeps it across a contrastive conjunction in one sentence", () => {
    const doc = findDoc(
      "A Power of Attorney is not required at EOI stage, but shortlisted firms shall submit a Power of Attorney with the RFP.",
      /power of attorney/i,
    );
    assert.equal(doc?.required, true);
  });
});

// ─── Financial proposal: three states, one reader ────────────────────────────

const RFP = "REQUEST FOR PROPOSALS\nConsultancy Services for Structural Assessment\n";

describe("Case 3 — the source says no financial proposal", () => {
  const denials = [
    "A financial proposal is not required at this stage.",
    "No financial proposal shall be submitted.",
    "The financial proposal is not requested for this assignment.",
    "Do not generate a financial proposal.",
    "Technical proposal only.",
    "Financial Proposal: No",
  ];

  it("reads every one of these as NOT required", () => {
    for (const d of denials) {
      assert.equal(readFinancialProposalRequirement(RFP + d), false, `missed denial: ${d}`);
    }
  });

  it("creates no financial obligation", () => {
    for (const d of denials) {
      const intel = parseTenderDocumentIntelligence(RFP + d);
      assert.equal(intel.financialProposalRequired, false, `obligation created by: ${d}`);
      assert.ok(
        !intel.generationPlan.generate.some((g) => /financial proposal|price schedule/i.test(g)),
        `financial document planned despite: ${d}`,
      );
    }
  });
});

describe("Case 4 — the source explicitly requires a financial proposal", () => {
  it("preserves the obligation", () => {
    const text = RFP + "Consultants shall submit a financial proposal with a detailed fee breakdown.";
    assert.equal(readFinancialProposalRequirement(text), true);
    assert.equal(parseTenderDocumentIntelligence(text).financialProposalRequired, true);
  });

  it("recognises the other names a tender gives it", () => {
    for (const phrase of [
      "Bidders shall submit a price schedule.",
      "A bill of quantities shall be provided.",
      "The commercial offer shall be submitted separately.",
      "Consultants shall provide a fee proposal.",
    ]) {
      assert.equal(readFinancialProposalRequirement(RFP + phrase), true, `missed: ${phrase}`);
    }
  });
});

describe("Case 5 — a two-envelope tender", () => {
  const text = RFP + "Proposals shall be submitted in two separate envelopes: technical and financial.";

  it("preserves the financial requirement", () => {
    assert.equal(readFinancialProposalRequirement(text), true);
  });

  it("keeps the envelopes separated", () => {
    const notes = parseTenderDocumentIntelligence(text).generationPlan.notes.join(" ");
    const intel = parseTenderDocumentIntelligence(text);
    assert.ok(
      /two.envelope/i.test(notes) || intel.tenderType === "Two Envelope" || intel.financialProposalRequired,
      "two-envelope structure lost",
    );
  });
});

describe("Case 6 — the source is silent about a financial proposal", () => {
  const silent = RFP + "The Consultant shall carry out a structural assessment and submit a technical submission describing the methodology, team and work plan.";

  it("answers UNKNOWN, not yes", () => {
    assert.equal(readFinancialProposalRequirement(silent), null);
  });

  it("does not become an obligation", () => {
    const intel = parseTenderDocumentIntelligence(silent);
    assert.equal(intel.financialProposalRequired, false);
    assert.equal(intel.financialProposalRequiredState, null);
    assert.ok(
      !intel.generationPlan.generate.some((g) => /financial proposal|price schedule/i.test(g)),
      "a financial document was planned from silence",
    );
  });

  it("surfaces the uncertainty instead of resolving it silently", () => {
    const warnings = parseTenderDocumentIntelligence(silent).warnings.join(" ");
    assert.match(warnings, /UNKNOWN/i);
  });

  it("UNKNOWN is distinguishable from an explicit no", () => {
    const denied = parseTenderDocumentIntelligence(RFP + "A financial proposal is not required.");
    assert.equal(denied.financialProposalRequiredState, false);
    assert.equal(parseTenderDocumentIntelligence(silent).financialProposalRequiredState, null);
  });
});

describe("Financial authority parity — one reader, not two", () => {
  it("the canonical reader and the generation context never disagree", () => {
    const bodies = [
      "Technical proposal only.",
      "Financial Proposal: No",
      "A financial proposal is not required at this stage.",
      "No financial proposal shall be submitted.",
      "The financial proposal is not requested for this assignment.",
      "Do not generate a financial proposal.",
      "Consultants shall submit a financial proposal with a detailed fee breakdown.",
      "Proposals shall be submitted in two separate envelopes: technical and financial.",
      "", // silence
    ];
    for (const body of bodies) {
      const text = RFP + body;
      assert.equal(
        parseTenderDocumentIntelligence(text).financialProposalRequired,
        detectFinancialProposalRequired(text),
        `readers disagree on: ${body || "(silence)"}`,
      );
    }
  });

  it("silence produces an obligation in neither reader", () => {
    assert.equal(detectFinancialProposalRequired(RFP), false);
    assert.equal(parseTenderDocumentIntelligence(RFP).financialProposalRequired, false);
  });
});

// ─── The canonical-requirement path ──────────────────────────────────────────
//
// buildTenderDocumentContext() holds canonical TenderRequirement rows, not raw
// tender text, and used to decide which of them were required-document
// requirements with /document|annex|attachment|form/. None of those words
// appear in "Power of Attorney" or "Declaration of Independent Bid
// Determination", so the instruments a tender names itself were dropped a
// second time, on a different path, for the same reason.

describe("required-document requirements are recognised by obligation, not keyword", () => {
  const keyword = (r: { title: string; description: string }) =>
    /document|annex|attachment|form/i.test(r.title + " " + r.description);

  it("keeps an instrument whose name contains none of the keywords", () => {
    for (const row of [
      {
        title: "Power of Attorney",
        description: "Each bidder shall submit a notarized Power of Attorney authorizing the signatory to bind the bidder.",
      },
      {
        title: "Declaration of Independent Bid Determination",
        description: "Bidders shall also submit a Declaration of Independent Bid Determination.",
      },
    ]) {
      assert.equal(keyword(row), false, "fixture must not be rescued by the keyword test");
      assert.equal(
        statesDocumentObligation(`${row.title}. ${row.description}`),
        true,
        `dropped: ${row.title}`,
      );
    }
  });

  it("does not treat an ordinary non-document requirement as one", () => {
    const row = { title: "Project duration", description: "The assignment shall be completed within 120 days of commencement." };
    assert.equal(keyword(row), false);
    assert.equal(statesDocumentObligation(`${row.title}. ${row.description}`), false);
  });

  it("does not treat a denied instrument as a required document", () => {
    assert.equal(
      statesDocumentObligation("Power of Attorney. A Power of Attorney is not required for this procurement."),
      false,
    );
  });
});
