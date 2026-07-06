import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveCanonicalFieldState, type CanonicalResolverInput } from "../lib/engine/canonical-field-state";

function makeBaseTender(overrides: Partial<CanonicalResolverInput["tender"]> = {}): CanonicalResolverInput["tender"] {
  return {
    id: "t1",
    title: "Test Tender",
    reference: "REF-001",
    clientName: "Pharo Ventures",
    procuringEntityName: null,
    deadline: new Date("2026-12-11"),
    currency: "USD",
    country: "Ethiopia",
    submissionMethod: "Email submission",
    submissionAddress: "test@example.com",
    submissionEmails: "test@example.com",
    submissionEmailSubject: null,
    clientContactName: null,
    clientContactEmail: null,
    metadataContaminated: false,
    // GROUND ALL CRITICAL FIELDS
    clientNameSourcePage: 1,
    clientNameSourceQuote: "Pharo Ventures is the procuring entity",
    clientNameSourceFileId: "file1",
    submissionMethodSourcePage: 2,
    submissionMethodSourceQuote: "Submit by email",
    submissionMethodSourceFileId: "file1",
    titleSourcePage: 1,
    titleSourceQuote: "Test Tender",
    titleSourceFileId: "file1",
    deadlineSourcePage: 1,
    deadlineSourceQuote: "Deadline: 2026",
    deadlineSourceFileId: "file1",
    // GROUND the reference field — it's value-driven evidence-mandatory
    // (when reference has a value, full source evidence is required, mirroring
    // the BuildPlan validator).
    referenceSourcePage: 1,
    referenceSourceQuote: "The reference number is REF-001",
    referenceSourceFileId: "file1",
    // submissionEmails is critical on an email-method tender (the BuildPlan
    // validator hard-requires a grounded email endpoint), so the baseline
    // fixture must ground it for blocker-isolation tests to work.
    submissionEmailSourcePage: 2,
    submissionEmailSourceQuote: "Submit by email to test@example.com",
    submissionEmailSourceFileId: "file1",
    contactDetailsSourceJson: null,
    ...overrides,
  };
}

function makeBaseInput(overrides: Partial<CanonicalResolverInput> = {}): CanonicalResolverInput {
  return {
    tender: makeBaseTender(),
    overrides: [],
    hasExtractedRequirements: true,
    activeTenderFileIds: new Set(["file1"]),
    ...overrides,
  };
}

function findField(result: ReturnType<typeof resolveCanonicalFieldState>, fieldKey: string) {
  const f = result.fields.find((f) => f.fieldKey === fieldKey);
  assert.ok(f, `Field ${fieldKey} not found`);
  return f;
}

describe("USER_CONFIRMED grounding — exact match required", () => {
  it("USER_CONFIRMED with value matching grounded evidence → EXTRACTED_AND_GROUNDED", () => {
    const input = makeBaseInput({
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "clientName");
    assert.equal(field.status, "EXTRACTED_AND_GROUNDED");
    assert.equal(result.hasGenerationBlocker, false);
  });

  it("USER_CONFIRMED with non-matching value → MANUAL_CONFIRMED (blocks FINAL export only, draft proceeds)", () => {
    // Authority model: USER_CONFIRMED with non-matching grounding is HUMAN_CONFIRMED_OPERATIONAL.
    // It blocks FINAL export only. Draft proceeds.
    const input = makeBaseInput({
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Different Company",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "clientName");
    assert.equal(field.status, "MANUAL_CONFIRMED");
    assert.equal(result.hasExportBlocker, true); // Final IS blocked
  });

  it("USER_CONFIRMED without source evidence → NOT_FOUND_CONFIRMED (blocks FINAL export only, draft proceeds)", () => {
    // Authority model: USER_CONFIRMED without grounding is HUMAN_CONFIRMED_OPERATIONAL.
    // It blocks FINAL export only (when audit insufficient). Draft proceeds.
    const input = makeBaseInput({
      tender: makeBaseTender({ clientNameSourcePage: null, clientNameSourceQuote: null, clientNameSourceFileId: null }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "clientName");
    assert.equal(field.status, "NOT_FOUND_CONFIRMED");
    assert.equal(result.hasExportBlocker, true); // Final IS blocked
  });
});

describe("USER_EDITED grounding — exact match required", () => {
  it("USER_EDITED with value matching grounded evidence → EXTRACTED_AND_GROUNDED", () => {
    const input = makeBaseInput({
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Pharo Ventures",
        reason: "Edited",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "clientName");
    assert.equal(field.status, "EXTRACTED_AND_GROUNDED");
  });

  it("USER_EDITED with non-matching value → MANUAL_OVERRIDE_CONFIRMATION_REQUIRED (blocks FINAL export only, draft proceeds)", () => {
    // Authority model: USER_EDITED without matching grounding is HUMAN_CONFIRMED_OPERATIONAL.
    // It blocks FINAL export only (when audit insufficient). Draft proceeds.
    const input = makeBaseInput({
      overrides: [{
        field: "clientName",
        fieldState: "USER_EDITED",
        overrideValue: "Different Company",
        reason: "Edited",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "clientName");
    assert.equal(field.status, "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED");
    assert.equal(result.hasExportBlocker, true); // Final IS blocked
  });
});

describe("Date normalization — different formats compare equal", () => {
  it("USER_CONFIRMED deadline with matching ISO date → EXTRACTED_AND_GROUNDED", () => {
    const input = makeBaseInput({
      tender: makeBaseTender({
        deadline: new Date("2026-12-11"),
        deadlineSourcePage: 1,
        deadlineSourceQuote: "2026-12-11",
        deadlineSourceFileId: "file1",
      }),
      overrides: [{
        field: "deadline",
        fieldState: "USER_CONFIRMED",
        overrideValue: "2026-12-11",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    const field = findField(result, "deadline");
    assert.equal(field.status, "EXTRACTED_AND_GROUNDED");
  });
});

describe("Stale/inactive/missing evidence does not qualify", () => {
  it("USER_CONFIRMED with missing page → NOT_FOUND_CONFIRMED", () => {
    const input = makeBaseInput({
      tender: makeBaseTender({ clientNameSourcePage: null }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    assert.equal(findField(result, "clientName").status, "NOT_FOUND_CONFIRMED");
  });

  it("USER_CONFIRMED with missing quote → NOT_FOUND_CONFIRMED", () => {
    const input = makeBaseInput({
      tender: makeBaseTender({ clientNameSourceQuote: null }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    assert.equal(findField(result, "clientName").status, "NOT_FOUND_CONFIRMED");
  });

  it("USER_CONFIRMED with short quote (<= 5 chars) → NOT_FOUND_CONFIRMED", () => {
    const input = makeBaseInput({
      tender: makeBaseTender({ clientNameSourceQuote: "abcde" }),
      overrides: [{
        field: "clientName",
        fieldState: "USER_CONFIRMED",
        overrideValue: "Pharo Ventures",
        reason: "Confirmed",
        overriddenBy: "user1",
        createdAt: new Date(),
      }],
    });
    const result = resolveCanonicalFieldState(input);
    assert.equal(findField(result, "clientName").status, "NOT_FOUND_CONFIRMED");
  });
});
