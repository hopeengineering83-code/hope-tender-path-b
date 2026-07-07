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
  it("flags contaminated clientName as PORTAL_CONTAMINATION and blocks FINAL export (draft proceeds)", () => {
    // Authority model: contamination blocks FINAL export (the value is corrupted).
    // Draft work still proceeds — the user can manually correct the value.
    const r = resolve(cleanTender({ metadataContaminated: true }));
    const f = field(r, "clientName");
    assert.equal(f.status, "PORTAL_CONTAMINATION");
    assert.notEqual(f.blockerReason, null);
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
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
  it("blocks FINAL export if critical fields are ungrounded (draft proceeds under authority model)", () => {
    // Authority model: ungrounded critical fields block FINAL export only.
    // Draft work proceeds so the user can analyze, extract, match, and draft.
    const r = resolve(cleanTender({
        titleSourcePage: null,
        titleSourceQuote: null,
        titleSourceFileId: null,
        deadlineSourcePage: null,
        deadlineSourceQuote: null,
        deadlineSourceFileId: null,
    }));
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
    assert.notEqual(field(r, "title").blockerReason, null);
    assert.notEqual(field(r, "deadline").blockerReason, null);
  });

  it("blocks FINAL export when a critical field (clientName) is missing with no override — draft proceeds", () => {
    // Authority model: missing critical field blocks FINAL export only.
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null, clientNameSourcePage: null, clientNameSourceQuote: null, clientNameSourceFileId: null }));
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
    assert.notEqual(field(r, "clientName").blockerReason, null);
  });

  it("blocks FINAL export when a critical field contains a placeholder — draft proceeds", () => {
    // Authority model: placeholder critical field blocks FINAL export only.
    const r = resolve(cleanTender({ clientName: "Bid-Team to confirm" }));
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
    assert.ok(field(r, "clientName").blockerReason !== null);
  });

  it("blocks FINAL export when deadline is marked NOT_APPLICABLE (never-N/A field) — draft proceeds", () => {
    // Authority model: NOT_APPLICABLE on a never-N/A field blocks FINAL export only.
    // Draft work proceeds (the tender can still be analyzed, requirements extracted, etc.).
    const r = resolve(cleanTender(), {
      overrides: [{ field: "deadline", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.ok(field(r, "deadline").blockerReason !== null);
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("blocks FINAL export when an always-critical field is marked NOT_APPLICABLE — draft proceeds", () => {
    // Authority model: NOT_APPLICABLE on a critical field blocks FINAL export only.
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "NOT_APPLICABLE", overrideValue: null, reason: "x", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
  });

  it("USER_EDITED on a critical field is a candidate — does NOT block draft, blocks final export only", () => {
    // Authority model: a manual value on a critical field is HUMAN_CONFIRMED_OPERATIONAL.
    // It NEVER blocks draft work (analysis, extraction, matching, BuildPlan, draft proposal).
    // It blocks FINAL export only when the audit (reason + confirmationBasis) is insufficient.
    const r = resolve(cleanTender({ clientName: null, procuringEntityName: null }), {
      overrides: [{ field: "clientName", fieldState: "USER_EDITED", overrideValue: "Nairobi City County", reason: "entered", overriddenBy: "u", createdAt: new Date() }],
    });
    assert.equal(r.hasGenerationBlocker, false); // Draft is NOT blocked
    assert.equal(r.hasExportBlocker, true); // Final IS blocked (audit insufficient)
  });

  it("blocks requiredDocuments when there are no extracted requirements", () => {
    const r = resolve(cleanTender(), { hasExtractedRequirements: false });
    assert.ok(field(r, "requiredDocuments").blockerReason !== null);
    assert.equal(r.hasGenerationBlocker, false);
  });

  it("blocks FINAL export when clientName is empty even if procuringEntityName is set if ungrounded (draft proceeds)", () => {
    // Authority model: a missing critical field blocks FINAL export only.
    // Draft work (analysis, extraction, matching, BuildPlan, draft proposal) proceeds.
    const r = resolve(cleanTender({ clientName: null, clientNameSourcePage: null, clientNameSourceQuote: null, clientNameSourceFileId: null }));
    assert.equal(r.hasGenerationBlocker, false); // Draft is NOT blocked
    assert.equal(r.hasExportBlocker, true); // Final IS blocked
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
