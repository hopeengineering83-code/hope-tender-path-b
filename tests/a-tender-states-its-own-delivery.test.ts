// A tender's delivery facts — method, endpoint, deadline, submission e-mail —
// are read from the clauses that state them, and nothing the tender does not
// state is required.
//
// From a real feasibility-study ToR (2026-10-06). Its only delivery clause is
// a portal clause whose deadline the PDF text layer split and wrapped:
//
//   "Quotations must be uploaded online through the following web tendering
//    portal not later than the 2 3rd\nof September 2026, 3:00 PM …"
//
// and its only e-mail address sits in a supplier-screening privacy notice. The
// app read no deadline, stored the privacy contact as the submission e-mail,
// left the portal method ungrounded, and then blocked the Build Plan because a
// portal tender had no e-mail or postal address — neither of which it states.
// The wording below is generic; no organisation or tender is named.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  findStatedDeadline,
  findSubmissionMethodClause,
  submissionEmailsFromText,
  submissionEmailStanding,
} from "../lib/engine/submission-source-clauses";
import { buildCanonicalAnalysisTenderUpdate } from "../lib/engine/canonical-analysis-update";
import { extractDeadline, extractSubmissionEmails } from "../lib/engine/tender-field-extractors";
import { inferTenderMetadata } from "../lib/engine/tender-metadata";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";
import { validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";

const PORTAL_PAGE =
  "19. Evaluation\nThe deadline for bid submission will be strictly observed.\n" +
  "20. Submission of quotations\n" +
  "Quotations must be uploaded online through the following web tendering portal not later than the 2 3rd\n" +
  "of September 2026, 3:00 PM that is accessible through the following link: https://tenders.example.org\n";
const PRIVACY_PAGE =
  "Supplier Declaration\nYour personal data are processed or stored for supplier screening. " +
  "If you have questions about data protection, please talk to your contact at the Contracting Organisation " +
  "or send an email to screening@example-ngo.org.\n";
const TOR_TEXT = `Terms of Reference — Consultancy Service for a Feasibility Study\n${PORTAL_PAGE}\f${PRIVACY_PAGE}`;

describe("the stated deadline is read across line breaks and split ordinals", () => {
  it("reads the portal clause's date and clock time", () => {
    const stated = findStatedDeadline(TOR_TEXT);
    assert.ok(stated, "the ToR states a deadline");
    assert.equal(stated!.date.toISOString(), "2026-09-23T15:00:00.000Z");
    assert.ok(TOR_TEXT.includes(stated!.quote), "the quote is verbatim from the source");
    assert.match(stated!.quote, /not later than the 2 3rd\nof September 2026, 3:00 PM/);
  });

  it("a label that holds no date does not stop the search", () => {
    // "The deadline for bid submission will be strictly observed." comes first.
    assert.equal(findStatedDeadline(PORTAL_PAGE)?.date.toISOString().slice(0, 10), "2026-09-23");
  });

  it("a clarification date is not the submission deadline", () => {
    const text = "Questions may be sent no later than 10 September 2026. Bids are due by September 30th, 2026 at 12 noon.";
    assert.equal(findStatedDeadline(text)?.date.toISOString(), "2026-09-30T12:00:00.000Z");
  });

  it("a clause number or a dotted date is not read as a clock time", () => {
    assert.equal(findStatedDeadline("See Section 4.12. Proposals must be received no later than 2026-10-01.")?.date.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(findStatedDeadline("Deadline: 23.09.2026 15.00 hrs")?.date.toISOString(), "2026-09-23T15:00:00.000Z");
  });

  it("text that states no deadline yields none", () => {
    assert.equal(findStatedDeadline("The deadline for bid submission will be announced."), null);
  });

  it("the deterministic readers find it too", () => {
    const files = [{ fileName: "ToR.pdf", extractedText: TOR_TEXT, totalPages: 2 }];
    const field = extractDeadline({ files } as never);
    assert.equal(field.found, true);
    assert.equal(field.found && (field.value as Date).toISOString().slice(0, 10), "2026-09-23");
    assert.equal(inferTenderMetadata(TOR_TEXT, "ToR.pdf").deadline?.toISOString().slice(0, 10), "2026-09-23");
  });
});

describe("a submission e-mail is an address the tender gives for submitting", () => {
  it("a privacy-notice contact is not a submission e-mail", () => {
    assert.deepEqual(submissionEmailsFromText(TOR_TEXT), []);
    assert.equal(submissionEmailStanding(TOR_TEXT, "screening@example-ngo.org"), "other");
    const field = extractSubmissionEmails({ files: [{ fileName: "ToR.pdf", extractedText: TOR_TEXT, totalPages: 2 }] } as never);
    assert.equal(field.found, false);
    assert.deepEqual(inferTenderMetadata(TOR_TEXT, "ToR.pdf").submissionEmails ?? [], []);
  });

  it("an address in a submission sentence is kept", () => {
    const text = "Bids shall be submitted by email to procurement@example.gov. Complaints may be sent to integrity@example.gov.";
    assert.deepEqual(submissionEmailsFromText(text), ["procurement@example.gov"]);
    assert.equal(submissionEmailStanding(text, "procurement@example.gov"), "submission");
    assert.equal(submissionEmailStanding(text, "integrity@example.gov"), "other");
    assert.equal(submissionEmailStanding(text, "nowhere@example.gov"), "absent");
  });
});

describe("the method is grounded in the clause that states it", () => {
  it("finds the portal clause verbatim", () => {
    const clause = findSubmissionMethodClause("Portal", TOR_TEXT);
    assert.ok(clause);
    assert.ok(TOR_TEXT.includes(clause!.quote));
    assert.match(clause!.quote, /uploaded online through the following web tendering portal/);
    assert.equal(findSubmissionMethodClause("Portal", PRIVACY_PAGE), null, "a privacy notice states no portal");
  });
});

describe("AI Analyze grounds delivery facts the model only paraphrased", () => {
  const sourceFiles = [{ id: "file-tor", fileName: "ToR.pdf", extractedText: TOR_TEXT, totalPages: 2 }];
  const ai = {
    summary: "Feasibility study",
    submissionMethod: "Portal",
    submissionMethodSourcePage: null,
    submissionMethodSourceQuote: "Portal",
    submissionEmails: "screening@example-ngo.org",
    submissionEmailSourcePage: 2,
    submissionEmailSourceQuote: "send an email to screening@example-ngo.org",
    deadline: null,
  } as never;

  it("grounds the method and the deadline in their clauses and drops the privacy contact", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(ai, {
      sourceFiles,
      submissionMethodSourceFileId: null,
      submissionEmailSourceFileId: "file-tor",
      deadlineSourceFileId: null,
    });
    assert.equal(data.submissionMethodSourceFileId, "file-tor");
    assert.equal(data.submissionMethodSourcePage, 1);
    assert.match(String(data.submissionMethodSourceQuote), /uploaded online through the following web tendering portal/);

    assert.equal((data.deadline as Date).toISOString(), "2026-09-23T15:00:00.000Z");
    assert.equal(data.deadlineSourceFileId, "file-tor");
    assert.equal(data.deadlineSourcePage, 1);
    assert.ok(TOR_TEXT.includes(String(data.deadlineSourceQuote)));

    assert.equal(data.submissionEmails, null);
    assert.equal(data.submissionEmailSourceFileId, null);
    assert.equal(data.submissionEmailSourceQuote, null);
  });

  it("keeps a model deadline and a grounded method as the model gave them", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      { ...(ai as object), deadline: "2026-09-25", submissionMethodSourcePage: 1, submissionMethodSourceQuote: "uploaded online through the following web tendering portal" } as never,
      { sourceFiles, submissionMethodSourceFileId: "file-tor", deadlineSourceFileId: null },
    );
    assert.equal((data.deadline as Date).toISOString().slice(0, 10), "2026-09-25");
    assert.equal(data.submissionMethodSourceQuote, "uploaded online through the following web tendering portal");
  });

  it("an e-mail the files never mention is left for the evidence gates to judge", () => {
    const { data } = buildCanonicalAnalysisTenderUpdate(
      { ...(ai as object), submissionEmails: "bids@example.org" } as never,
      { sourceFiles },
    );
    assert.equal(data.submissionEmails, "bids@example.org");
  });
});

describe("a portal tender's grounded portal clause is its endpoint — panel and gate agree", () => {
  const FILE_ID = "file-tor";
  function tender(patch: Record<string, unknown> = {}) {
    return {
      id: "t1",
      title: "Consultancy Service for a Feasibility Study",
      reference: null,
      clientName: "Contracting Organisation",
      procuringEntityName: "Contracting Organisation",
      deadline: new Date("2026-09-23T15:00:00Z"),
      submissionMethod: "Portal",
      submissionAddress: null,
      submissionEmails: null,
      metadataContaminated: false,
      clientNameSourceFileId: FILE_ID,
      clientNameSourcePage: 2,
      clientNameSourceQuote: "your contact at the Contracting Organisation",
      titleSourceFileId: FILE_ID,
      titleSourcePage: 1,
      titleSourceQuote: "Consultancy Service for a Feasibility Study",
      deadlineSourceFileId: FILE_ID,
      deadlineSourcePage: 1,
      deadlineSourceQuote: "not later than the 2 3rd\nof September 2026, 3:00 PM",
      submissionMethodSourceFileId: FILE_ID,
      submissionMethodSourcePage: 1,
      submissionMethodSourceQuote: "Quotations must be uploaded online through the following web tendering portal",
      submissionEmailSourceFileId: null,
      submissionEmailSourcePage: null,
      submissionEmailSourceQuote: null,
      submissionAddressSourceFileId: null,
      submissionAddressSourcePage: null,
      submissionAddressSourceQuote: null,
      contactDetailsSourceJson: null,
      ...patch,
    };
  }
  const files = [{ id: FILE_ID, extractedText: TOR_TEXT, totalPages: 2 }];
  const ENDPOINT_FIELDS = ["submissionMethod", "submissionEmails", "submissionAddress"];

  function verdicts(t: ReturnType<typeof tender>) {
    const resolved = resolveCanonicalFieldState({
      tender: t as unknown as CanonicalResolverInput["tender"],
      overrides: [],
      hasExtractedRequirements: true,
      submissionMethodContext: t.submissionMethod,
      activeTenderFileIds: new Set([FILE_ID]),
      activeFiles: files,
    });
    const panelBlocked = resolved.fields.some((f) => ENDPOINT_FIELDS.includes(f.fieldKey) && f.blockerReason !== null);
    const gate = validateCriticalMetadataEvidenceForBuildPlan(t as never, files as never, []);
    return { panelBlocked, gateBlocked: !gate.ok, blockers: gate.blockers };
  }

  it("no e-mail or address is required when the portal clause is grounded", () => {
    const v = verdicts(tender());
    assert.equal(v.gateBlocked, false, JSON.stringify(v.blockers));
    assert.equal(v.panelBlocked, false);
  });

  it("an ungrounded portal method with no endpoint still blocks in both", () => {
    const v = verdicts(tender({ submissionMethodSourceFileId: null, submissionMethodSourcePage: null, submissionMethodSourceQuote: null }));
    assert.equal(v.gateBlocked, true);
    assert.equal(v.panelBlocked, true);
  });

  it("evidence that does not state a portal is not a portal endpoint", () => {
    const v = verdicts(tender({ submissionMethodSourceQuote: "The deadline for bid submission will be strictly observed" }));
    assert.equal(v.gateBlocked, true);
    assert.equal(v.panelBlocked, true);
  });
});
