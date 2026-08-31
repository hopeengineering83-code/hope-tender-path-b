/**
 * A financial/commercial proposal is company-authored content, not a
 * third-party original.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Driving the real owner workflow end-to-end, a generated
 * "02-Financial-Proposal.docx" — the firm's own price envelope, auto-created
 * by generate-missing-plan-files because the confirmed plan named it — was
 * permanently stuck at a 60/100 NEEDS_REWRITE verdict with no stated reason,
 * blocking export of an otherwise clean document.
 *
 * The cause was in documentTypeFor() (this file): its FINANCIAL_EVIDENCE
 * pattern is a bare /financial/, which matches "Financial-Proposal.docx"
 * before any more specific pattern gets a chance to run. FINANCIAL_EVIDENCE
 * means "a third-party original — bank statement, audited financial
 * statement — that must be attached, not generated" (see
 * needsOriginalReplacement / requiresOfficialOriginal in
 * document-type-normalizer.ts). Stamping that type onto the firm's own
 * priced financial proposal forces it through
 * document-quality-gate.ts's FINANCIAL_OFFICIAL branch, which is
 * unconditionally capped at score 60 / NEEDS_REWRITE whenever the document
 * carries no AI-trace or placeholder issue — with an empty issues list, so
 * validate.ts's message ends with ": " and no owner-actionable reason.
 *
 * lib/engine/document-type-normalizer.ts already orders this correctly (its
 * own FINANCIAL_PROPOSAL_PATTERNS are checked ahead of the broader evidence
 * match for a fresh classification). This mirrors that ordering here, so the
 * two classifiers cannot disagree about which financial-named file is the
 * firm's own deliverable versus a document the tender issuer must supply.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";

const { documentTypeFor, needsOriginalReplacement, isNarrativeDraft } = __testing__;

describe("documentTypeFor distinguishes the firm's own financial proposal from third-party financial evidence", () => {
  const FINANCIAL_PROPOSAL_NAMES = [
    "02-Financial-Proposal.docx",
    "Financial Proposal.docx",
    "Commercial Proposal.docx",
    "Price Schedule.docx",
    "Rate Card.docx",
    "Bill of Quantities.docx",
    "BOQ.docx",
  ];

  for (const name of FINANCIAL_PROPOSAL_NAMES) {
    it(`classifies "${name}" as FINANCIAL_PROPOSAL, not FINANCIAL_EVIDENCE`, () => {
      assert.equal(documentTypeFor(name, ""), "FINANCIAL_PROPOSAL");
    });

    it(`does not require the tender-issued original for "${name}"`, () => {
      assert.equal(needsOriginalReplacement(name, "FINANCIAL_PROPOSAL"), false);
    });

    it(`is generated as a narrative draft for "${name}"`, () => {
      assert.equal(isNarrativeDraft(name, "FINANCIAL_PROPOSAL"), true);
    });
  }

  const THIRD_PARTY_EVIDENCE_NAMES = [
    "Audited Financial Statement.docx",
    "Bank Statement.docx",
    "Bank Guarantee.docx",
    "Financial Capacity Statement.docx",
    "Turnover Evidence.docx",
  ];

  for (const name of THIRD_PARTY_EVIDENCE_NAMES) {
    it(`still classifies "${name}" as FINANCIAL_EVIDENCE (must remain an official original)`, () => {
      assert.equal(documentTypeFor(name, ""), "FINANCIAL_EVIDENCE");
    });

    it(`still requires the tender-issued original for "${name}"`, () => {
      assert.equal(needsOriginalReplacement(name, "FINANCIAL_EVIDENCE"), true);
    });
  }
});
