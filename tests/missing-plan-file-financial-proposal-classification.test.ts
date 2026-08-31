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
 *
 * THREE more independent classifiers had the identical bug and actually
 * overwrote the fix above at runtime, in this order of discovery:
 *
 * 1. lib/engine/export-gap-repair.ts's safeTypeFor() — used by the
 *    auto-finalize background worker's repair pass.
 * 2. app/api/tenders/[id]/repair-export-gaps/route.ts's OWN safeTypeFor() —
 *    a separate, undetected copy-paste of #1 that the real HTTP
 *    "repair-export-gaps" endpoint actually runs (it does not import from
 *    lib/engine/export-gap-repair.ts at all). Fixing #1 alone did not
 *    resolve the live block: driving the real pipeline end-to-end, with
 *    temporary logging at every write site, showed the correctly-classified
 *    FINANCIAL_PROPOSAL row silently reset back to FINANCIAL_EVIDENCE by
 *    this route on every explicit repair call, with no log line at all from
 *    the (already-fixed) lib copy — proving the route was running its own
 *    unfixed code.
 * 3. lib/engine/reconcile-generated-docs.ts's semanticCategory() — a
 *    first-match-wins bucket scan with FINANCIAL_EVIDENCE checked before
 *    FINANCIAL_PROPOSAL.
 *
 * Each had the same shape: a bare /financial/ pattern matching regardless of
 * the row's already-correct `fallback` type. All four are fixed the same
 * way — the specific proposal pattern checked first.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { __testing__ } from "../lib/engine/missing-plan-file-generation";
import { __testing__ as exportGapRepairTesting } from "../lib/engine/export-gap-repair";
import { semanticCategory } from "../lib/engine/reconcile-generated-docs";

const { documentTypeFor, needsOriginalReplacement, isNarrativeDraft } = __testing__;
const { safeTypeFor } = exportGapRepairTesting;

// The repair-export-gaps HTTP route (app/api/tenders/[id]/repair-export-gaps/
// route.ts) does not import lib/engine/export-gap-repair.ts — it carries its
// own independent copy-paste of safeTypeFor(), which is the ACTUAL code the
// real HTTP endpoint runs (the lib copy is only used by the auto-finalize
// background worker). Next.js route modules may only export known handler
// names (GET/POST/etc.), so an __testing__ export fails typed-route
// validation — this pins the fix at the source-text level instead, the same
// way tests/proposal-section-provider-order.test.ts pins lib/ai.ts's
// provider-order fix.
const repairRouteSrc = readFileSync(
  path.join(process.cwd(), "app/api/tenders/[id]/repair-export-gaps/route.ts"),
  "utf8",
);

const FINANCIAL_PROPOSAL_NAMES = [
  "02-Financial-Proposal.docx",
  "Financial Proposal.docx",
  "Commercial Proposal.docx",
  "Price Schedule.docx",
  "Rate Card.docx",
  "Bill of Quantities.docx",
  "BOQ.docx",
];

const THIRD_PARTY_EVIDENCE_NAMES = [
  "Audited Financial Statement.docx",
  "Bank Statement.docx",
  "Bank Guarantee.docx",
  "Financial Capacity Statement.docx",
  "Turnover Evidence.docx",
];

describe("documentTypeFor distinguishes the firm's own financial proposal from third-party financial evidence", () => {
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

  for (const name of THIRD_PARTY_EVIDENCE_NAMES) {
    it(`still classifies "${name}" as FINANCIAL_EVIDENCE (must remain an official original)`, () => {
      assert.equal(documentTypeFor(name, ""), "FINANCIAL_EVIDENCE");
    });

    it(`still requires the tender-issued original for "${name}"`, () => {
      assert.equal(needsOriginalReplacement(name, "FINANCIAL_EVIDENCE"), true);
    });
  }
});

describe("export-gap-repair's safeTypeFor does not reset a correct FINANCIAL_PROPOSAL type back to FINANCIAL_EVIDENCE", () => {
  for (const name of FINANCIAL_PROPOSAL_NAMES) {
    it(`classifies "${name}" as FINANCIAL_PROPOSAL even with no prior type`, () => {
      assert.equal(safeTypeFor(name, ""), "FINANCIAL_PROPOSAL");
    });

    it(`preserves the already-correct FINANCIAL_PROPOSAL type for "${name}" on repair`, () => {
      // This is the exact reproduction: the row already carries the correct
      // type from generate-missing-plan-files; a later repair pass must not
      // reclassify it back to FINANCIAL_EVIDENCE just because the filename
      // contains the word "financial".
      assert.equal(safeTypeFor(name, "FINANCIAL_PROPOSAL"), "FINANCIAL_PROPOSAL");
    });
  }

  for (const name of THIRD_PARTY_EVIDENCE_NAMES) {
    it(`still classifies "${name}" as FINANCIAL_EVIDENCE`, () => {
      assert.equal(safeTypeFor(name, ""), "FINANCIAL_EVIDENCE");
    });
  }
});

describe("the repair-export-gaps HTTP route's own safeTypeFor (duplicated from the lib copy) checks the proposal pattern first", () => {
  it("the route defines its own safeTypeFor (confirms this is genuinely a separate copy, not a re-export)", () => {
    assert.match(repairRouteSrc, /function safeTypeFor\(name: string, fallback\?: string \| null\): string \{/);
    assert.ok(
      !repairRouteSrc.includes('from "../../../../../lib/engine/export-gap-repair"')
        && !repairRouteSrc.includes("from \"@/lib/engine/export-gap-repair\""),
      "if this route ever imports the lib copy instead, this duplicate-classifier risk is gone and this test (and the duplicated fix) can be deleted",
    );
  });

  it("checks the financial/commercial-proposal pattern before the broader financial-evidence pattern", () => {
    const proposalIdx = repairRouteSrc.indexOf('return "FINANCIAL_PROPOSAL"');
    const evidenceIdx = repairRouteSrc.indexOf('return "FINANCIAL_EVIDENCE"');
    assert.ok(proposalIdx >= 0, "route must classify FINANCIAL_PROPOSAL");
    assert.ok(evidenceIdx >= 0, "route must still classify FINANCIAL_EVIDENCE");
    assert.ok(proposalIdx < evidenceIdx, "FINANCIAL_PROPOSAL must be checked before the broader FINANCIAL_EVIDENCE pattern");
  });

  it("the proposal pattern accepts hyphen/underscore separators, matching real plan file names", () => {
    const line = repairRouteSrc.split("\n").find((l) => l.includes('return "FINANCIAL_PROPOSAL"'));
    assert.ok(line);
    assert.match(line!, /\[\\s\._-\]\+proposal/, "must accept \"02-Financial-Proposal.docx\"-style hyphenated names, not just a literal space");
  });
});

describe("reconcile-generated-docs's semanticCategory does not bucket a financial proposal as third-party evidence", () => {
  // Only the names whose text literally contains the word "financial" can
  // collide with FINANCIAL_EVIDENCE's bare pattern here — this classifier's
  // FINANCIAL_PROPOSAL bucket is narrower than the other two (it does not
  // recognize "price schedule" / "rate card" / "BoQ" as proposal names, which
  // is this classifier's own separate TENDER_FORMS bucket and out of scope
  // for this fix).
  for (const name of ["02-Financial-Proposal.docx", "Financial Proposal.docx"]) {
    it(`buckets "${name}" as FINANCIAL_PROPOSAL, not FINANCIAL_EVIDENCE`, () => {
      assert.equal(semanticCategory(name), "FINANCIAL_PROPOSAL");
    });
  }

  // This classifier's FINANCIAL_EVIDENCE bucket does not key on "bank" at
  // all (pre-existing, unrelated to this fix), so only the subset it
  // actually recognizes is asserted here.
  for (const name of ["Audited Financial Statement.docx", "Financial Capacity Statement.docx", "Turnover Evidence.docx"]) {
    it(`still buckets "${name}" as FINANCIAL_EVIDENCE`, () => {
      assert.equal(semanticCategory(name), "FINANCIAL_EVIDENCE");
    });
  }
});
