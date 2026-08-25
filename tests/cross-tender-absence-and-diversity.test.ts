import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { parseTenderDocumentIntelligence } from "../lib/engine/source-driven-tender-text-parser";
import { extractRequirementSources } from "../lib/engine/requirement-source-extractor";

// ─── What this file proves ───────────────────────────────────────────────────
//
// Presence and absence must both be SOURCE-DRIVEN. A tender that does not ask
// for forms must not acquire forms; one that does not ask for bid security must
// not acquire a bid-security obligation; separate lots must not bleed into each
// other; and a real obligation must not go unrecognised merely because the
// drafter wrote "is required to" instead of "shall".
//
// Every fixture here is deliberately unlike the benchmark tender — a rural road
// condition survey, a water-supply supervision assignment, a two-lot building
// package. None of them encodes the benchmark's vocabulary, sections, forms,
// counts, filenames or dates. That is the point: these assert product
// invariants, not one document's shape.

// ─── CASE A — a tender that asks for no forms or annexes ─────────────────────

const NO_FORMS_TENDER = `
REQUEST FOR PROPOSALS
Condition Survey of Rural Access Roads

1. BACKGROUND
The Authority maintains a network of rural access roads and wishes to establish
their present condition.

2. SCOPE OF SERVICES
The Consultant will carry out a visual condition survey of the road network and
report findings.

3. SUBMISSION
Proposals are to be sent by email to the address given below before the closing
date. There is no prescribed format. Applicants may present their proposal in
whatever structure they consider appropriate.
`;

describe("Case A — a tender with no forms does not acquire any", () => {
  const intel = parseTenderDocumentIntelligence(NO_FORMS_TENDER);

  it("invents no required document the source never asked for", () => {
    // The source names no form, annex, schedule or template. Anything appearing
    // in requiredDocuments would be fabricated obligation.
    const fabricated = intel.requiredDocuments.filter((doc) =>
      /form|annex|schedule|template|appendix/i.test(doc.name),
    );
    assert.deepEqual(
      fabricated.map((d) => d.name),
      [],
      "a tender that prescribes no format must not gain forms",
    );
  });

  it("does not mark any document mandatory on a source that prescribes none", () => {
    for (const doc of intel.requiredDocuments) {
      assert.equal(
        doc.required && /form|annex|schedule|template/i.test(doc.name),
        false,
        `"${doc.name}" was made mandatory without the source requiring it`,
      );
    }
  });

  it("still reads the submission instruction that IS present", () => {
    // Absence handling must not be achieved by ignoring the section entirely.
    assert.ok(intel.submissionInstructions);
    assert.notEqual(intel.tenderType, undefined);
  });
});

// ─── CASE B — bid security absent, and present ───────────────────────────────

const NO_BID_SECURITY_TENDER = `
INVITATION FOR EXPRESSIONS OF INTEREST
Construction Supervision — District Water Supply Scheme

Interested firms are invited to submit an expression of interest.
No bid security is required at this stage.
Submissions are to be delivered by email before the deadline.
`;

const WITH_BID_SECURITY_TENDER = `
INVITATION TO TENDER
Construction Supervision — District Water Supply Scheme

Bid Security: 2% of the tender sum, valid for 120 days, in the form of an
unconditional bank guarantee.
Submissions are to be delivered by email before the deadline.
`;

describe("Case B — bid security is read from the source, never assumed", () => {
  it("does not fabricate a bid-security obligation when the source has none", () => {
    const intel = parseTenderDocumentIntelligence(NO_BID_SECURITY_TENDER);
    // The fixture says "No bid security is required" — the one thing the parser
    // must never do is turn that into an obligation.
    if (intel.bidBond !== null) {
      assert.match(
        intel.bidBond,
        /^no\b|not required/i,
        `absence was turned into a bid-security obligation: "${intel.bidBond}"`,
      );
    }
    // The invariant is that it must not be OBLIGATORY — not that it must be
    // absent from the list. Recording a denied document with required:false and
    // a note is useful and matches how "Financial Proposal — not required at
    // this stage" is already handled. Inventing an obligation is the defect.
    const obligated = intel.requiredDocuments.filter(
      (doc) => /bid\s*(bond|security)/i.test(doc.name) && doc.required,
    );
    assert.deepEqual(obligated.map((d) => d.name), [], "bid security must not be a REQUIRED document here");
  });

  it("still detects bid security when the source genuinely requires it", () => {
    // The absence case must not be satisfied by making detection inert.
    const intel = parseTenderDocumentIntelligence(WITH_BID_SECURITY_TENDER);
    assert.ok(intel.bidBond, "an explicit bid-security clause must still be read");
    assert.match(intel.bidBond, /2%|bank guarantee|120/i);
  });
});

// ─── CASE C — separate lots must not bleed into each other ───────────────────

const MULTI_LOT_TENDER = `
TENDER FOR DESIGN SERVICES — TWO PACKAGES

PACKAGE ONE: LABORATORY BUILDING
The consultant is required to provide a laboratory ventilation design prepared
by a mechanical engineer with fume-cupboard experience.

PACKAGE TWO: STAFF HOUSING
The consultant is required to provide a residential drainage design prepared by
a public health engineer.
`;

describe("Case C — requirements stay with the package the source put them in", () => {
  const sources = extractRequirementSources({
    tenderFileId: "file-multi-lot",
    tenderFileText: MULTI_LOT_TENDER,
    requirements: [
      { id: "req-lab", title: "Laboratory ventilation design", description: "Ventilation design with fume-cupboard experience." },
      { id: "req-housing", title: "Residential drainage design", description: "Drainage design by a public health engineer." },
    ],
  });

  function quoteFor(requirementId: string): string {
    const found = sources.find((s) => s.requirementId === requirementId);
    assert.ok(found?.sourceExactQuote, `${requirementId} must be grounded in the source`);
    return found.sourceExactQuote;
  }

  it("grounds each requirement in its own package's text", () => {
    assert.match(quoteFor("req-lab"), /ventilation|fume/i);
    assert.match(quoteFor("req-housing"), /drainage|public health/i);
  });

  it("does not ground one package's requirement in the other package's clause", () => {
    // The failure this guards is silent cross-application: a requirement that
    // belongs to one package acquiring evidence from another.
    assert.doesNotMatch(quoteFor("req-lab"), /drainage|public health/i);
    assert.doesNotMatch(quoteFor("req-housing"), /ventilation|fume/i);
  });

  it("keeps both packages — neither is flattened away", () => {
    const grounded = sources.filter((s) => Boolean(s.sourceExactQuote));
    assert.equal(grounded.length, 2, "a multi-package tender must not collapse into one obligation set");
  });
});

// ─── CASE D — obligations without the magic keywords ─────────────────────────

const IMPLICIT_OBLIGATION_TENDER = `
TERMS OF REFERENCE — TOPOGRAPHIC SURVEY

2. BACKGROUND
The district has grown considerably over the last decade and existing mapping is
now regarded as unreliable by planners.

3. WHAT THE CONSULTANT WILL DELIVER
The consultant is required to prepare a topographic survey report.
Proposals are to include a programme of works showing survey durations.
Applicants are expected to provide evidence of prior survey assignments.
`;

describe("Case D — a real obligation is recognised without MUST or SHALL", () => {
  const sources = extractRequirementSources({
    tenderFileId: "file-implicit",
    tenderFileText: IMPLICIT_OBLIGATION_TENDER,
    requirements: [
      { id: "req-report", title: "Topographic survey report", description: "Prepare a topographic survey report." },
      { id: "req-programme", title: "Programme of works", description: "A programme of works showing survey durations." },
      { id: "req-evidence", title: "Evidence of prior assignments", description: "Evidence of prior survey assignments." },
    ],
  });

  it("grounds obligations phrased as 'is required to', 'are to include', 'are expected to'", () => {
    // Not one of these three clauses uses MUST or SHALL. Requiring a magic
    // keyword would silently drop real obligations from ordinary drafting.
    for (const id of ["req-report", "req-programme", "req-evidence"]) {
      const found = sources.find((s) => s.requirementId === id);
      assert.ok(found?.sourceExactQuote, `"${id}" was not grounded in the source`);
    }
  });

  it("grounds each obligation in its own clause, not the narrative background", () => {
    // Grounding must not be loosened into "anything that sounds important":
    // section 2 is background prose and must not become anyone's evidence.
    for (const source of sources) {
      if (!source.sourceExactQuote) continue;
      assert.doesNotMatch(
        source.sourceExactQuote,
        /grown considerably|regarded as unreliable/i,
        "narrative background was used as requirement evidence",
      );
    }
  });

  it("keeps every quote a verbatim substring of the source", () => {
    // The absence of a keyword gate must not come at the cost of grounding.
    const normalised = IMPLICIT_OBLIGATION_TENDER.replace(/\s+/g, " ").toLowerCase();
    for (const source of sources) {
      if (!source.sourceExactQuote) continue;
      const quote = source.sourceExactQuote.replace(/\s+/g, " ").toLowerCase();
      assert.ok(normalised.includes(quote), `quote is not verbatim in the source: "${source.sourceExactQuote}"`);
    }
  });
});

// ─── Denial scoping — a contrast must not cancel a real obligation ───────────
//
// Reading "mention != obligation" is only half the rule. The other half is that
// a denial is SCOPED: it rules out what its own clause rules out, and nothing
// further. Two failures live here, and both were real:
//
//   * a denial and an obligation inside ONE sentence, joined by "but", let the
//     denial cancel the obligation — a shortlisted firm would have submitted
//     with no bid security at all;
//   * the bid-security reader inspected only the first regex match in the
//     document while the required-documents extractor scanned every clause, so
//     the two disagreed on the same source.
//
// Both readers now share one clause set and one denial rule, so agreement is
// structural rather than coincidental.

function bidSecurityView(body: string) {
  const intel = parseTenderDocumentIntelligence(`TENDER\n${body}\nSubmit by email.`);
  const doc = intel.requiredDocuments.find((d) => /bid\s*(bond|security)/i.test(d.name));
  return { bidBond: intel.bidBond, documentRequired: doc?.required === true };
}

describe("a denial rules out only what its own clause rules out", () => {
  it("denial only — no obligation is created", () => {
    const view = bidSecurityView("No bid security is required.");
    assert.equal(view.bidBond, null);
    assert.equal(view.documentRequired, false);
  });

  it("affirmative only — the genuine obligation is read", () => {
    const view = bidSecurityView("Bid Security: 2% of the tender sum, valid for 120 days.");
    assert.ok(view.bidBond);
    assert.equal(view.documentRequired, true);
  });

  it("denial in one sentence, obligation in the next — the obligation survives", () => {
    const view = bidSecurityView(
      "Bid security is not required at this stage.\nShortlisted firms shall provide a bid security of 2% with their proposal.",
    );
    assert.ok(view.bidBond, "a later affirmative clause must still be read");
    assert.equal(view.documentRequired, true);
  });

  it("obligation first, scoped exemption later — the obligation stands", () => {
    const view = bidSecurityView(
      "Bid Security: 2% of the tender sum is required.\nBid security is not required for firms on the framework panel.",
    );
    assert.ok(view.bidBond);
    assert.equal(view.documentRequired, true);
  });

  it("denial and obligation in ONE sentence joined by 'but' — the obligation survives", () => {
    // The case that matters most: the tender says bid security is not needed
    // now AND that it will be needed later. Cancelling on the denial alone
    // would send a shortlisted firm to submission without it.
    const view = bidSecurityView(
      "Bid security is not required at EOI stage, but shortlisted firms shall provide bid security with the RFP submission.",
    );
    assert.ok(view.bidBond, "a contrast must not cancel the obligation it introduces");
    assert.equal(view.documentRequired, true);
  });

  it("the two readers never disagree about the same source", () => {
    // Structural, not incidental: both consume the same clause units and the
    // same denial rule, so one cannot say 'required' while the other says null.
    const bodies = [
      "No bid security is required.",
      "Bid Security: 2% of the tender sum, valid for 120 days.",
      "Bid security is not required at this stage.\nShortlisted firms shall provide a bid security of 2%.",
      "Bid Security: 2% is required.\nBid security is not required for framework firms.",
      "Bid security is not required at EOI stage, but shortlisted firms shall provide bid security later.",
      "Bid security: none",
      "The bid security shall be an unconditional bank guarantee of USD 50,000.",
    ];
    for (const body of bodies) {
      const view = bidSecurityView(body);
      assert.equal(
        view.bidBond !== null,
        view.documentRequired,
        `readers disagree on: ${body.replace(/\n/g, " / ")}`,
      );
    }
  });
});
