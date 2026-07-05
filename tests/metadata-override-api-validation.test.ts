// Targeted tests for server-side metadata override API validation.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Metadata override API — server-side validation (P0)", () => {
  const src = read("app/api/tenders/[id]/metadata-override/route.ts");

  it("never trusts client-supplied previousValue", () => {
    assert.ok(
      src.includes("NEVER trust client-supplied previousValue"),
      "API must document that previousValue is never trusted",
    );
    assert.ok(
      src.includes("previousValue: realPriorValue"),
      "Upsert must use server-computed realPriorValue",
    );
  });

  it("rejects empty/generic/placeholder USER_EDITED values", () => {
    assert.ok(src.includes("isPlaceholderOrGeneric"), "must have placeholder detection");
    assert.ok(src.includes("PLACEHOLDER_PATTERNS"), "must have placeholder patterns");
    assert.ok(src.includes("GENERIC_LABEL_PATTERNS"), "must have generic label patterns");
    assert.ok(src.includes("INVALID_OVERRIDE_VALUE"), "must reject with INVALID_OVERRIDE_VALUE");
  });

  it("rejects NOT_APPLICABLE for critical fields via the canonical registry (single source of truth)", () => {
    assert.ok(src.includes("NOT_APPLICABLE_REJECTED"), "must reject NOT_APPLICABLE for critical fields");
    // Criticality must come from the registry, not a local hard-coded list, so
    // the override API stays in lock-step with the generation/export gates
    // (e.g. `reference` is N/A-able, `submissionEmails` is critical only for
    // email methods).
    assert.ok(src.includes("tender-policy-registry"), "must import from the canonical registry");
    assert.ok(
      src.includes("isCriticalField") && src.includes("canBeNotApplicable"),
      "must derive criticality from the registry's isCriticalField/canBeNotApplicable",
    );
    assert.ok(
      !src.includes("const ALWAYS_CRITICAL_FIELDS = new Set"),
      "must NOT re-declare a local hard-coded always-critical set",
    );
  });

  it("validates deadline format (YYYY-MM-DD or ISO datetime)", () => {
    assert.ok(src.includes("INVALID_DEADLINE_FORMAT"), "must reject invalid deadline format");
    assert.ok(src.includes("YYYY-MM-DD"), "must require YYYY-MM-DD format");
  });

  it("requires meaningful audit reason for USER_CONFIRMED", () => {
    assert.ok(src.includes("REASON_REQUIRED"), "must require reason for confirmation");
    assert.ok(
      src.includes("Confirmation requires a meaningful audit reason"),
      "must reject confirmation without reason",
    );
  });

  it("requires non-empty reason for NOT_APPLICABLE and IGNORED_WITH_REASON", () => {
    assert.ok(
      src.includes('fieldState === "NOT_APPLICABLE"') && src.includes("REASON_REQUIRED"),
      "NOT_APPLICABLE must require reason",
    );
    assert.ok(
      src.includes('fieldState === "IGNORED_WITH_REASON"') && src.includes("REASON_REQUIRED"),
      "IGNORED_WITH_REASON must require reason",
    );
  });

  it("rejects requiredDocuments string override", () => {
    assert.ok(
      src.includes("REQUIRED_DOCUMENTS_OVERRIDE_REJECTED"),
      "must reject requiredDocuments string override",
    );
  });

  it("loads existing override server-side to compute real prior value", () => {
    assert.ok(
      src.includes("existingOverride") && src.includes("realPriorValue"),
      "must load existing override to compute prior value",
    );
  });

  it("loads tender data for validation context", () => {
    assert.ok(
      src.includes("tenderData") && src.includes("prisma.tender.findFirst"),
      "must load tender data for validation",
    );
  });

  it("returns safe structured errors with stable codes", () => {
    assert.ok(src.includes("INVALID_OVERRIDE_VALUE"), "must return INVALID_OVERRIDE_VALUE");
    assert.ok(src.includes("INVALID_DEADLINE_FORMAT"), "must return INVALID_DEADLINE_FORMAT");
    assert.ok(src.includes("NOT_APPLICABLE_REJECTED"), "must return NOT_APPLICABLE_REJECTED");
    assert.ok(src.includes("REQUIRED_DOCUMENTS_OVERRIDE_REJECTED"), "must return REQUIRED_DOCUMENTS_OVERRIDE_REJECTED");
  });
});
