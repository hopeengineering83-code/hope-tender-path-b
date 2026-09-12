// Regression test for CLAUDE.md priority item: "Add CONDITIONAL_OR_UNSCHEDULED
// status to canonical resolver + wire through STATUS_BADGE maps."
//
// TenderFactsLedger's AUTHORITY_STATE enum (lib/engine/tender-facts-ledger-service.ts)
// and the shared TenderFactAuthorityState type (lib/engine/effective-tender-context.ts)
// have long included CONDITIONAL_OR_UNSCHEDULED for facts the source states
// conditionally or without a firm schedule (e.g. "site visit by arrangement",
// "pre-bid meeting to be scheduled") — but lib/engine/canonical-field-state.ts's
// resolver never had a branch for it, and components/canonical-field-status-badge.ts
// had no entry for it. Nothing in the codebase writes this authority state yet
// (no extraction classifier produces it), so this closes the resolver+badge
// half of the gap defensively: if the ledger ever supplies this state, it is
// now handled correctly instead of silently mishandled (e.g. read as if it
// were a firm grounded value, or crashing on an unhandled Record key).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, canonicalToClientChip } from "../lib/engine/canonical-field-state";
import { CANONICAL_FIELD_STATUS_BADGE } from "../components/canonical-field-status-badge";

function resolve(tender: any, opts: any = {}) {
  return resolveCanonicalFieldState({
    tender,
    overrides: opts.overrides || [],
    ledgerFacts: opts.ledgerFacts || [],
    hasExtractedRequirements: opts.hasExtractedRequirements !== false,
    activeTenderFileIds: opts.activeTenderFileIds || new Set(["file1"]),
  });
}

function field(result: any, key: string) {
  return result.fields.find((f: any) => f.fieldKey === key);
}

// Every other submission-critical field is fully source-grounded so a test's
// own hasExportBlocker assertion reflects only the field under test, not
// unrelated ungrounded critical fields.
function cleanTender(overrides: any = {}): any {
  return {
    id: "t1",
    title: "Health Systems Strengthening Project",
    reference: "MOH/RFP/2026/001",
    clientName: "Ministry of Health, Republic of Kenya",
    procuringEntityName: "Ministry of Health, Republic of Kenya",
    deadline: new Date("2026-12-11T12:00:00Z"),
    currency: "USD",
    country: "Kenya",
    submissionMethod: "Email submission",
    submissionAddress: null,
    submissionEmails: "procurement@health.go.ke",
    submissionEmailSubject: null,
    clientContactName: "Dr. Jane Smith",
    clientContactEmail: "jane@health.go.ke",
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Health, Republic of Kenya invites sealed bids",
    clientNameSourceFileId: "file1",
    submissionMethodSourcePage: 4,
    submissionMethodSourceQuote: "Bids shall be submitted by email",
    submissionMethodSourceFileId: "file1",
    submissionEmailSourcePage: 4,
    submissionEmailSourceQuote: "Submit to procurement@health.go.ke",
    submissionEmailSourceFileId: "file1",
    titleSourcePage: 1,
    titleSourceQuote: "Health Systems Strengthening Project",
    titleSourceFileId: "file1",
    deadlineSourcePage: 2,
    deadlineSourceQuote: "Deadline: 11 Dec 2026",
    deadlineSourceFileId: "file1",
    referenceSourcePage: 1,
    referenceSourceQuote: "Reference: MOH/RFP/2026/001",
    referenceSourceFileId: "file1",
    ...overrides,
  };
}

describe("canonical resolver — CONDITIONAL_OR_UNSCHEDULED ledger authority state", () => {
  it("a non-critical field with a conditional ledger fact gets CONDITIONAL_OR_UNSCHEDULED status, keeps the conditional text visible", () => {
    const r = resolve(cleanTender({ submissionMethod: null }), {
      ledgerFacts: [{
        semanticKey: "submissionMethod",
        displayLabel: "Submission Method",
        normalizedValue: "By arrangement — contact procurement office to schedule",
        rawSourceValue: "By arrangement — contact procurement office to schedule",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    const f = field(r, "submissionMethod");
    assert.equal(f.status, "CONDITIONAL_OR_UNSCHEDULED");
    assert.equal(f.effectiveValue, "By arrangement — contact procurement office to schedule");
  });

  it("does not block export for a non-critical conditional field", () => {
    const r = resolve(cleanTender({ submissionAddress: null }), {
      ledgerFacts: [{
        semanticKey: "submissionAddress",
        displayLabel: "Submission Address",
        normalizedValue: "Venue to be confirmed closer to the deadline",
        rawSourceValue: "Venue to be confirmed closer to the deadline",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    assert.equal(field(r, "submissionAddress").status, "CONDITIONAL_OR_UNSCHEDULED");
    assert.equal(r.hasExportBlocker, false);
  });

  it("a CRITICAL field with a conditional ledger fact blocks FINAL export with an explanatory reason (draft proceeds)", () => {
    const r = resolve(cleanTender({ deadline: null }), {
      ledgerFacts: [{
        semanticKey: "deadline",
        displayLabel: "Submission Deadline",
        normalizedValue: "To be scheduled following the pre-bid meeting",
        rawSourceValue: "To be scheduled following the pre-bid meeting",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    const f = field(r, "deadline");
    assert.equal(f.status, "CONDITIONAL_OR_UNSCHEDULED");
    assert.notEqual(f.blockerReason, null);
    assert.match(f.blockerReason, /conditionally or without a firm schedule/);
    assert.equal(r.hasExportBlocker, true);
    // Per-field generationEligible is false for any blocked critical field
    // without a manual override -- same as every other blocking status
    // (e.g. MANUAL_OVERRIDE_CONFIRMATION_REQUIRED). The "draft is never
    // blocked by metadata" principle applies at the aggregate gate level
    // (hasGenerationBlocker), not this per-field flag.
    assert.equal(f.generationEligible, false);
  });

  it("a critical conditional field blocks export even if the tender's own scalar source-evidence columns are populated", () => {
    // Defends against the edge case where isGrounded (raw scalar evidence)
    // is true independent of the ledger's own conditional classification --
    // the explicit CONDITIONAL_OR_UNSCHEDULED + isCritical disjunct in
    // exportHardBlockReasons must catch this regardless.
    const r = resolve(cleanTender({
      deadline: null,
      deadlineSourcePage: 2,
      deadlineSourceQuote: "To be scheduled following the pre-bid meeting",
      deadlineSourceFileId: "file1",
    }), {
      ledgerFacts: [{
        semanticKey: "deadline",
        displayLabel: "Submission Deadline",
        normalizedValue: "To be scheduled following the pre-bid meeting",
        rawSourceValue: "To be scheduled following the pre-bid meeting",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: "file1",
        sourcePage: 2,
        sourceQuote: "To be scheduled following the pre-bid meeting",
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    assert.equal(r.hasExportBlocker, true);
  });

  it("effectiveValid and effectiveGrounded are both false for a conditional field (never counts as a complete/ready value)", () => {
    const r = resolve(cleanTender({ submissionMethod: null }), {
      ledgerFacts: [{
        semanticKey: "submissionMethod",
        displayLabel: "Submission Method",
        normalizedValue: "By arrangement",
        rawSourceValue: "By arrangement",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    assert.equal(r.validFields === r.totalFields, false, "at least one field must not count as valid");
    const f = field(r, "submissionMethod");
    assert.equal(f.isValid, false);
    assert.equal(f.isGrounded, false);
  });

  it("permits editing a conditional field with a firm value", () => {
    const r = resolve(cleanTender({ submissionMethod: null }), {
      ledgerFacts: [{
        semanticKey: "submissionMethod",
        displayLabel: "Submission Method",
        normalizedValue: "By arrangement",
        rawSourceValue: "By arrangement",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    assert.ok(field(r, "submissionMethod").permittedActions.includes("edit"));
  });

  it("canonicalToClientChip maps CONDITIONAL_OR_UNSCHEDULED to its own chip status (not the NOT_DETECTED fallback)", () => {
    const r = resolve(cleanTender({ submissionMethod: null }), {
      ledgerFacts: [{
        semanticKey: "submissionMethod",
        displayLabel: "Submission Method",
        normalizedValue: "By arrangement",
        rawSourceValue: "By arrangement",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
    });
    assert.equal(canonicalToClientChip(field(r, "submissionMethod")), "CONDITIONAL_OR_UNSCHEDULED");
  });

  it("a USER_EDITED override on the same field takes priority over an earlier ledger CONDITIONAL_OR_UNSCHEDULED classification", () => {
    const r = resolve(cleanTender({ submissionMethod: null }), {
      ledgerFacts: [{
        semanticKey: "submissionMethod",
        displayLabel: "Submission Method",
        normalizedValue: "By arrangement",
        rawSourceValue: "By arrangement",
        authorityState: "CONDITIONAL_OR_UNSCHEDULED",
        sourceFileId: null,
        sourcePage: null,
        sourceQuote: null,
        manuallyEntered: false,
        reason: null,
        confirmationBasis: null,
      }],
      overrides: [{ field: "submissionMethod", fieldState: "USER_EDITED", overrideValue: "Email submission only", reason: "confirmed by phone", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.notEqual(field(r, "submissionMethod").status, "CONDITIONAL_OR_UNSCHEDULED");
  });
});

describe("STATUS_BADGE — CONDITIONAL_OR_UNSCHEDULED has its own badge entry", () => {
  it("is present and distinct from the INVALID fallback", () => {
    const badge = CANONICAL_FIELD_STATUS_BADGE.CONDITIONAL_OR_UNSCHEDULED;
    assert.ok(badge, "CONDITIONAL_OR_UNSCHEDULED must have a badge entry");
    assert.notEqual(badge.label, CANONICAL_FIELD_STATUS_BADGE.INVALID.label);
    assert.notEqual(badge.classes, CANONICAL_FIELD_STATUS_BADGE.INVALID.classes);
  });
});
