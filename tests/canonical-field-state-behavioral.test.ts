import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, canonicalToClientChip } from "../lib/engine/canonical-field-state";

// Helper to resolve with standard defaults
function resolve(tender: any, overrides: any = {}) {
  return resolveCanonicalFieldState({
    tender,
    overrides: overrides.overrides || [],
    hasExtractedRequirements: overrides.hasExtractedRequirements !== false,
    activeTenderFileIds: overrides.activeTenderFileIds || new Set(["file1"]),
  });
}

function field(result: any, key: string) {
  return result.fields.find((f: any) => f.fieldKey === key);
}

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
    // Sourced fields
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

describe("canonical resolver — contamination", () => {
  it("flags contaminated clientName as PORTAL_CONTAMINATION and blocks", () => {
    const r = resolve(cleanTender({ metadataContaminated: true }));
    const f = field(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasGenerationBlocker, true);
    assert.equal(canonicalToClientChip(f), "CONTAMINATED");
    assert.equal(f.isValid, false);
    assert.equal(f.isGrounded, false);
  });

  it("flags contamination even with override unless override matches grounded source", () => {
    const r = resolve(cleanTender({ metadataContaminated: true }), {
      overrides: [{ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Ministry of Health", reason: "corrected", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(field(r, "clientName").status, "PORTAL_CONTAMINATION");
  });
});

describe("canonical resolver — behavioral gate decisions", () => {
  it("blocks a clean tender if critical fields are ungrounded (new policy)", () => {
    const r = resolve(cleanTender({
        titleSourcePage: null,
        titleSourceQuote: null,
        titleSourceFileId: null,
        deadlineSourcePage: null,
        deadlineSourceQuote: null,
        deadlineSourceFileId: null,
    }));
    assert.equal(r.hasGenerationBlocker, true);
    assert.notEqual(field(r, "title").blockerReason, null);
    assert.notEqual(field(r, "deadline").blockerReason, null);
    assert.equal(field(r, "title").generationEligible, false);
  });

  it("blocks when a critical field (clientName) is missing with no override", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null, clientNameSourcePage: null, clientNameSourceQuote: null, clientNameSourceFileId: null }));
    assert.equal(r.hasGenerationBlocker, true);
    assert.notEqual(field(r, "clientName").blockerReason, null);
  });

  it("blocks when a critical field contains a placeholder", () => {
    const r = resolve(cleanTender({ clientName: "Bid-Team to confirm" }));
    assert.equal(r.hasGenerationBlocker, true);
    assert.ok(field(r, "clientName").blockerReason !== null);
  });

  it("blocks the deadline when marked NOT_APPLICABLE (never-N/A field)", () => {
    const r = resolve(cleanTender(), {
      overrides: [{ field: "deadline", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.ok(field(r, "deadline").blockerReason !== null);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("blocks an always-critical field marked NOT_APPLICABLE", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("USER_EDITED on a critical field is a candidate — blocks generation", () => {
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City County", reason: "entered", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(field(r, "clientName").status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("blocks requiredDocuments when there are no extracted requirements", () => {
    const r = resolve(cleanTender(), { hasExtractedRequirements: false });
    assert.ok(field(r, "requiredDocuments").blockerReason !== null);
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("blocks when clientName is empty even if procuringEntityName is set if ungrounded", () => {
    const r = resolve(cleanTender({ clientName: null, clientNameSourcePage: null, clientNameSourceQuote: null, clientNameSourceFileId: null }));
    assert.equal(field(r, "clientName").status, "EXTRACTED_UNVERIFIED");
    assert.equal(r.hasGenerationBlocker, true);
  });

  it("does NOT block on a missing NON-critical field (reference)", () => {
    const r = resolve(cleanTender({ reference: null, referenceSourcePage: null, referenceSourceQuote: null, referenceSourceFileId: null }));
    assert.equal(r.hasGenerationBlocker, false);
    assert.equal(field(r, "reference").criticality, "non-critical");
  });

  it("marks a grounded critical field as EXTRACTED_AND_GROUNDED", () => {
    const r = resolve(cleanTender());
    assert.equal(field(r, "clientName").status, "EXTRACTED_AND_GROUNDED");
    assert.ok(r.groundedFields >= 1);
  });
});

describe("canonical resolver — extended panel fields + chip mapping", () => {
  it("evaluates the extended non-critical panel fields without adding gate blockers", () => {
    const r = resolve(cleanTender({
      legalClientName: "Republic of Kenya — Ministry of Health",
      donorAgency: "World Bank",
      implementingAgency: "County Health Department",
      clientCity: "Nairobi",
      clientWebsite: "https://health.go.ke",
      legalClientNameSourcePage: 1,
      legalClientNameSourceQuote: "Legal name: Republic of Kenya",
      legalClientNameSourceFileId: "file1",
    }));
    assert.equal(r.hasGenerationBlocker, false);
  });

  it("reads page+quote evidence from contactDetailsSourceJson for extended fields", () => {
    const r = resolve(cleanTender({
      legalClientName: "Republic of Kenya — Ministry of Health",
      contactDetailsSourceJson: JSON.stringify({
        legalClientName: { page: 2, quote: "The legal entity is the Republic of Kenya — Ministry of Health.", fileId: "file1" },
      }),
    }));
    const f = field(r, "legalClientName");
    assert.equal(f.sourcePage, 2);
  });

  it("maps canonical statuses to the panel chip vocabulary", () => {
    const clean = resolve(cleanTender());
    assert.equal(canonicalToClientChip(field(clean, "clientName")), "EXTRACTED_GROUNDED");

    const ungrounded = resolve(cleanTender({ titleSourcePage: null, titleSourceQuote: null, titleSourceFileId: null }));
    assert.equal(canonicalToClientChip(field(ungrounded, "title")), "EXTRACTED_NO_EVIDENCE");

    const placeholder = resolve(cleanTender({ clientName: "Bid-Team to confirm" }));
    assert.equal(canonicalToClientChip(field(placeholder, "clientName")), "INVALID_VALUE");

    const naCritical = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "NOT_APPLICABLE" as any, overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(canonicalToClientChip(field(naCritical, "clientName")), "BLOCKED");

    const confirmed = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "USER_CONFIRMED" as any, overrideValue: "Nairobi County", reason: "ok", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(canonicalToClientChip(field(confirmed, "clientName")), "MANUALLY_CONFIRMED");
  });
});
