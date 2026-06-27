// BEHAVIORAL tests for the canonical field-state resolver.
//
// The companion file canonical-field-state-resolver.test.ts only string-matches
// the source (readFileSync + src.includes). Those checks cannot catch logic
// regressions. THIS file actually CALLS resolveCanonicalFieldState and asserts
// the returned gate decisions — including the regression where a clean,
// fully-populated tender was wrongly blocked because title/deadline (which have
// no source-evidence columns) can never be "grounded".

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

type TenderInput = CanonicalResolverInput["tender"];

function cleanTender(overrides: Partial<TenderInput> = {}): TenderInput {
  return {
    id: "t1",
    title: "Construction of Rural Health Centre, Lot 3",
    reference: "MOH/RFP/2026/014",
    clientName: "Ministry of Health, Republic of Kenya",
    procuringEntityName: "Ministry of Health, Republic of Kenya",
    deadline: new Date("2026-09-30T12:00:00Z"),
    currency: "KES",
    country: "Kenya",
    submissionMethod: "Email submission to procurement@health.go.ke",
    submissionAddress: null,
    submissionEmails: "procurement@health.go.ke",
    submissionEmailSubject: null,
    clientContactName: "Jane Mwangi",
    clientContactEmail: "jane.mwangi@health.go.ke",
    metadataContaminated: false,
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Ministry of Health, Republic of Kenya invites sealed bids",
    submissionMethodSourcePage: 5,
    submissionMethodSourceQuote: "Bids shall be submitted by email to procurement@health.go.ke",
    submissionAddressSourcePage: null,
    submissionAddressSourceQuote: null,
    submissionEmailSourcePage: 5,
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function resolve(tender: TenderInput, opts: Partial<Omit<CanonicalResolverInput, "tender">> = {}) {
  return resolveCanonicalFieldState({
    tender,
    overrides: opts.overrides ?? [],
    hasExtractedRequirements: opts.hasExtractedRequirements ?? true,
    submissionMethodContext: tender.submissionMethod ?? undefined,
  });
}

const field = (r: ReturnType<typeof resolve>, key: string) => r.fields.find((f) => f.fieldKey === key)!;

describe("canonical resolver — behavioral gate decisions", () => {
  // ─── REGRESSION: the bug this work fixed ───────────────────────────────────
  it("does NOT block a clean, fully-populated tender (title/deadline ungrounded is allowed)", () => {
    const r = resolve(cleanTender());
    assert.equal(r.hasGenerationBlocker, false, "clean tender must not have a generation blocker");
    assert.equal(r.hasExportBlocker, false, "clean tender must not have an export blocker");
    // title and deadline are valid but ungrounded — that is a warning, never a blocker
    assert.equal(field(r, "title").blockerReason, null);
    assert.equal(field(r, "deadline").blockerReason, null);
    assert.equal(field(r, "title").evidenceReviewNeeded, true, "ungrounded critical field flags evidence review");
    assert.equal(field(r, "title").generationEligible, true);
  });

  // ─── Genuine blockers must still fire ──────────────────────────────────────
  it("blocks when a critical field (clientName) is missing with no override", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }));
    assert.equal(r.hasGenerationBlocker, true);
    assert.notEqual(field(r, "clientName").blockerReason, null);
  });

  it("blocks when a critical field contains a placeholder", () => {
    const r = resolve(cleanTender({ clientName: "Bid-Team to confirm" }));
    assert.equal(r.hasGenerationBlocker, true);
    assert.equal(field(r, "clientName").blockerReason !== null, true);
  });

  it("blocks the deadline when marked NOT_APPLICABLE (never-N/A field)", () => {
    const r = resolve(cleanTender(), {
      overrides: [{ field: "deadline", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(field(r, "deadline").blockerReason !== null, true, "deadline N/A must be blocked");
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("blocks an always-critical field marked NOT_APPLICABLE", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(r.hasGenerationBlocker, true, "N/A cannot dismiss an always-critical field");
  });

  it("does NOT block when a missing critical field is resolved by a valid USER_EDITED override", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City County", reason: "entered", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(field(r, "clientName").blockerReason, null);
    assert.equal(r.hasGenerationBlocker, false);
  });

  it("blocks requiredDocuments when there are no extracted requirements", () => {
    const r = resolve(cleanTender(), { hasExtractedRequirements: false });
    assert.equal(field(r, "requiredDocuments").blockerReason !== null, true);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("does NOT block on a missing NON-critical field (reference)", () => {
    const r = resolve(cleanTender({ reference: null }));
    assert.equal(r.hasGenerationBlocker, false);
    assert.equal(field(r, "reference").criticality, "non-critical");
  });

  it("marks a grounded critical field as EXTRACTED_AND_GROUNDED and counts it", () => {
    const r = resolve(cleanTender());
    assert.equal(field(r, "clientName").isGrounded, true);
    assert.ok(r.groundedFields >= 1);
  });
});
