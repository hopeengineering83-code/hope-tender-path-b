// One verdict for a submission rule, across every surface that reports it.
//
// The Requirements and Evidence panel was taught to say "Enforced by the
// package" for a submission rule. Final Package Readiness, the release
// snapshot, the lifecycle orchestrator and Bid Strategy still said
// "No selected or linked evidence is traced to this requirement" and told the
// owner to "Add trusted traced evidence for mandatory requirement: Financial
// Proposal Omission" — the same wrong ask, one surface over.
//
// Bid Strategy carried its own private copy of "which requirements are
// covered" as well: it read supportLevel straight off the compliance rows,
// ignored source trace entirely, and counted only priority === "MANDATORY"
// while every other surface counts MANDATORY OR CRITICAL. So it could report a
// requirement as covered that Export Readiness reported as untrusted, and drop
// a CRITICAL requirement from its denominator.
//
// These tests hold the surfaces on the one resolver.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

const FILE_ID = "file-1";
const QUOTE = "No financial proposal shall be included with the technical submission.";
const ACTIVE_FILES = [{ id: FILE_ID, extractedText: `Section 5. ${QUOTE}`, totalPages: 10 }];

function ruleRequirement() {
  return {
    id: "req-fin",
    title: "Financial Proposal Omission",
    priority: "MANDATORY",
    requirementType: "SUBMISSION",
    sourceTenderFileId: FILE_ID,
    sourcePageNumber: 5,
    sourceExactQuote: QUOTE,
    complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
  };
}

function evidenceRequirement() {
  return {
    id: "req-cv",
    title: "CV of the Team Leader",
    priority: "MANDATORY",
    requirementType: "EXPERT",
    sourceTenderFileId: FILE_ID,
    sourcePageNumber: 5,
    sourceExactQuote: QUOTE,
    complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
  };
}

const TECHNICAL_PDF = {
  id: "doc-1",
  name: "Technical Proposal.pdf",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "APPROVED",
};

const FINANCIAL_PDF = { ...TECHNICAL_PDF, id: "doc-2", name: "Financial Proposal.pdf", exactFileName: "Financial Proposal.pdf", documentType: "FINANCIAL" };

describe("the canonical resolver reports a submission rule as a rule", () => {
  it("marks a rule the package obeys as fully met, with no evidence link needed", () => {
    // This test's NAME always described the intended behaviour; its assertions
    // pinned the opposite. It required a SATISFIED rule to keep carrying a
    // blockerReason, which it only ever did because displayStatus was computed
    // from vault evidence and ignored the package verdict entirely — so an
    // obeyed rule could never actually be "fully met". That is the defect
    // reproduced live on tender 08e250af as
    // MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE 3/6, and the assertions are
    // updated here to match the name rather than the bug.
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.ok(status.packageRule, "a submission rule must be identified as one");
    assert.equal(status.packageRule!.status, "SATISFIED");
    assert.equal(status.displayStatus, "FULLY_MET", "an obeyed rule is met — that is what the name says");
    assert.equal(status.blockerReason, null, "a met requirement has nothing blocking it");
    // The original intent survives: the reason is still available and still
    // never asks the owner for evidence that cannot exist for a package rule.
    assert.doesNotMatch(status.packageRule!.reason, /No selected or linked evidence/);
    assert.equal(status.selectedEvidenceCount, 0, "and it needed no evidence link to get there");
  });

  it("keeps a rule the package breaks blocked, naming the package defect", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF, FINANCIAL_PDF],
    });
    assert.equal(status.packageRule!.status, "VIOLATED");
    assert.notEqual(status.displayStatus, "FULLY_MET", "fail-closed: a broken rule still blocks");
    assert.match(status.blockerReason ?? "", /Financial Proposal\.pdf/);
    assert.doesNotMatch(status.blockerReason ?? "", /evidence/i);
  });

  it("never claims a rule is met just because the package is empty", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES, {
      documents: [],
    });
    assert.equal(status.packageRule!.status, "PENDING_PACKAGE");
    assert.notEqual(status.displayStatus, "FULLY_MET");
  });

  it("leaves an ordinary evidence requirement on the evidence wording", () => {
    const [status] = mapRequirementsToEvidence([evidenceRequirement()], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.equal(status.packageRule, null);
    assert.match(status.blockerReason ?? "", /No selected or linked evidence is traced/);
  });

  it("omitting the package facts preserves the previous wording exactly", () => {
    const [status] = mapRequirementsToEvidence([ruleRequirement()], [], [], ACTIVE_FILES);
    assert.equal(status.packageRule, null);
    assert.match(status.blockerReason ?? "", /No selected or linked evidence is traced/);
  });
});

describe("every surface passes the package facts to the one resolver", () => {
  const SURFACES = [
    "lib/engine/final-package-readiness-model.ts",
    "lib/engine/tender-release-snapshot.ts",
    "lib/engine/tender-lifecycle-orchestrator.ts",
    "app/api/tenders/[id]/bid-strategy/route.ts",
  ];

  it("hands documents to mapRequirementsToEvidence everywhere it is called", () => {
    for (const path of SURFACES) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /mapRequirementsToEvidence/, `${path} must use the canonical resolver`);
      assert.match(source, /documents:/, `${path} must supply the package facts`);
    }
  });

  it("Bid Strategy no longer keeps a private coverage rule", () => {
    const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");
    // The private copy read supportLevel off the rows and counted MANDATORY
    // alone. Neither may return.
    assert.doesNotMatch(
      source,
      /const mandatory = requirements\.filter\(\(r\) => String\(r\.priority \?\? ""\)\.toUpperCase\(\) === "MANDATORY"\)/,
      "the MANDATORY-only denominator must not come back",
    );
    assert.match(source, /mapRequirementsToEvidence\(requirements, \[\], \[\], activeFiles, packageFacts\)/);
    assert.match(source, /status\.displayStatus === "FULLY_MET"/);
  });

  it("blocks a broken submission rule under a rule code, not an evidence code", () => {
    const source = readFileSync("lib/engine/final-package-readiness-model.ts", "utf8");
    assert.match(source, /SUBMISSION_RULE_BROKEN_BY_PACKAGE/);
    assert.match(source, /SUBMISSION_RULE_AWAITING_PACKAGE/);
    // The blocker is still produced — fail-closed is unchanged for everything
    // the machine can decide. `machineDecidable` was added to the same filter
    // so that a rule no automatic check can settle either way (page limits,
    // fonts, hard-copy counts, binding, envelope marking) stops making the
    // tender unwinnable; it is reported as a human-judgement review item
    // instead. VIOLATED and PENDING_PACKAGE still block exactly as before.
    assert.match(source, /\.filter\(\(status\) => status\.mandatory && status\.machineDecidable && status\.displayStatus !== "FULLY_MET"\)/);
    assert.match(source, /buildHumanJudgementReviewItems/);
  });
});

describe("classification reads the same requirement text on every surface", () => {
  it("classifies from the description when the title alone does not state the rule", () => {
    // A tender that states the envelope rule in the body and gives the row a
    // bland title must classify identically wherever it is read. Passing only
    // the title on one surface and title + description on another is how the
    // same row lands in two different buckets.
    const requirement = {
      id: "req-env",
      title: "Submission arrangements",
      description: "Bidders shall submit two separate sealed envelopes; no financial proposal may accompany the technical offer.",
      priority: "CRITICAL",
      requirementType: "SUBMISSION",
      sourceTenderFileId: FILE_ID,
      sourcePageNumber: 5,
      sourceExactQuote: QUOTE,
      complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
    };
    const [status] = mapRequirementsToEvidence([requirement], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.ok(status.packageRule, "the rule stated in the description must still be recognised");
    assert.equal(status.packageRule!.family, "FINANCIAL_SEPARATION");
    // CRITICAL counts as mandatory, unlike the private copy Bid Strategy used.
    assert.equal(status.mandatory, true);
  });

  it("every surface selects the requirement text the classifier reads", () => {
    for (const path of [
      "lib/engine/tender-release-snapshot.ts",
      "lib/engine/tender-lifecycle-orchestrator.ts",
      "app/api/tenders/[id]/bid-strategy/route.ts",
      "app/api/tenders/[id]/requirement-coverage/route.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(source, /description: true/, `${path} must select the requirement description`);
      // restrictions is the half this test used to miss. classifyPackageRule
      // reads title + description + restrictions + requirementType +
      // sourceExactQuote; the readiness model reached it only because it uses
      // `include` and gets every column, while all four surfaces here name
      // their columns explicitly and named all of them but this one.
      //
      // Reproduced live on tender 50940b8b, run 34696242297. The readiness
      // model classified "Technical Proposal Email Submission" as a package
      // rule and correctly set it aside (machineDecidableMandatory 2 of 3,
      // requirement blockers []), while the release snapshot — reading the
      // same requirement without its restrictions text — classified it as an
      // ordinary requirement, so evidence.notMachineDecidable was 0 and the
      // canonical gate still refused at "2/3 automatically decidable".
      assert.match(source, /restrictions: true/, `${path} must select the requirement restrictions`);
    }
  });

  it("a rule stated only in restrictions classifies the same as one in the description", () => {
    // The data shape the select bug produced: the classifier's phrase lives in
    // a field the caller did not fetch, so the same row is a package rule on
    // one surface and an evidence requirement on another.
    const stated = {
      id: "req-pages",
      title: "Proposal Presentation",
      description: "Bidders shall present their offer clearly.",
      restrictions: "The technical proposal must not exceed a 40 page limit.",
      priority: "MANDATORY",
      requirementType: "SUBMISSION_RULE",
      sourceTenderFileId: FILE_ID,
      sourcePageNumber: 5,
      sourceExactQuote: QUOTE,
      complianceMatrixRows: [] as Array<{ supportLevel?: string | null }>,
    };
    const [withRestrictions] = mapRequirementsToEvidence([stated], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.ok(withRestrictions.packageRule, "a rule stated in restrictions is still a package rule");
    assert.equal(withRestrictions.machineDecidable, false);

    // And the shape that caused the disagreement: drop the field the caller
    // failed to select, and the same row reads as an ordinary requirement.
    const { restrictions: _dropped, ...withoutRestrictions } = stated;
    const [blind] = mapRequirementsToEvidence([withoutRestrictions], [], [], ACTIVE_FILES, {
      documents: [TECHNICAL_PDF],
    });
    assert.equal(blind.packageRule, null, "this is the misclassification the select bug produced");
  });
});
