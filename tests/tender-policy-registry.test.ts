// Tests for the canonical tender-policy registry and the Manual Override &
// Evidence Policy enforcement it backs.
//
// Covers:
//   1.  One registry: critical-field classification is single-sourced.
//   2.  `reference` and `evaluationCriteria` are non-critical (reconciles the
//       previously-conflicting hard-coded lists — Policy point 7).
//   3.  Conditionally-critical fields depend on submission method (Policy 6).
//   4.  Deadline can never be marked Not Applicable.
//   5.  Override-state classification: manual override vs. audited absence.
//   6.  metadata-override.ts critical set is the same object as the registry.
//   7.  User-facing labels never expose raw DB column names.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  ALWAYS_CRITICAL_FIELDS,
  NON_CRITICAL_FIELDS,
  NEVER_NOT_APPLICABLE,
  MANUAL_OVERRIDE_STATES,
  ABSENCE_OVERRIDE_STATES,
  RESOLVING_OVERRIDE_STATES,
  isCriticalField,
  isConditionallyCriticalField,
  canBeNotApplicable,
  fieldDisplayLabel,
  gateConsequenceForField,
} from "../lib/engine/tender-policy-registry";
import { CRITICAL_METADATA_FIELDS } from "../lib/engine/metadata-override";

// ─── 1. Always-critical fields ───────────────────────────────────────────────

describe("registry — always-critical fields", () => {
  it("treats clientName, title, submissionMethod, submissionEndpoint, deadline, requiredDocuments as critical", () => {
    for (const f of ["clientName", "title", "submissionMethod", "submissionEndpoint", "deadline", "requiredDocuments"]) {
      assert.equal(isCriticalField(f), true, `${f} should be critical`);
    }
  });
});

// ─── 2. Reconciled non-critical fields (Policy 7) ─────────────────────────────

describe("registry — reconciles previously-conflicting lists", () => {
  it("classifies `reference` as non-critical (was critical only in the truth panel)", () => {
    assert.equal(isCriticalField("reference"), false);
    assert.equal(NON_CRITICAL_FIELDS.has("reference"), true);
    assert.equal(ALWAYS_CRITICAL_FIELDS.has("reference"), false);
  });

  it("classifies `evaluationCriteria` as non-critical (was critical only in metadata-override)", () => {
    assert.equal(isCriticalField("evaluationCriteria"), false);
    assert.equal(NON_CRITICAL_FIELDS.has("evaluationCriteria"), true);
  });
});

// ─── 3. Conditionally-critical fields depend on submission method ─────────────

describe("registry — conditionally-critical fields", () => {
  it("makes submissionAddress critical only for physical/sealed methods", () => {
    assert.equal(isConditionallyCriticalField("submissionAddress", { submissionMethod: "Sealed envelope, hand delivery" }), true);
    assert.equal(isConditionallyCriticalField("submissionAddress", { submissionMethod: "Email submission" }), false);
    assert.equal(isCriticalField("submissionAddress", { submissionMethod: "courier delivery" }), true);
    assert.equal(isCriticalField("submissionAddress", { submissionMethod: "online portal" }), false);
  });

  it("makes submissionEmailSubject critical only for email methods", () => {
    assert.equal(isConditionallyCriticalField("submissionEmailSubject", { submissionMethod: "Email to procurement@x.org" }), true);
    assert.equal(isConditionallyCriticalField("submissionEmailSubject", { submissionMethod: "Sealed envelope" }), false);
  });

  it("returns false for a non-conditional field regardless of method", () => {
    assert.equal(isConditionallyCriticalField("country", { submissionMethod: "Sealed envelope" }), false);
  });
});

// ─── 4. Deadline can never be marked Not Applicable ───────────────────────────

describe("registry — NEVER_NOT_APPLICABLE", () => {
  it("forbids marking the deadline Not Applicable", () => {
    assert.equal(NEVER_NOT_APPLICABLE.has("deadline"), true);
    assert.equal(canBeNotApplicable("deadline"), false);
  });

  it("allows non-critical fields to be marked Not Applicable", () => {
    assert.equal(canBeNotApplicable("reference"), true);
    assert.equal(canBeNotApplicable("country"), true);
  });
});

// ─── 5. Override-state classification ─────────────────────────────────────────

describe("registry — override-state classification", () => {
  it("treats USER_CONFIRMED and USER_EDITED as manual override states (valid but ungrounded)", () => {
    assert.equal(MANUAL_OVERRIDE_STATES.has("USER_CONFIRMED"), true);
    assert.equal(MANUAL_OVERRIDE_STATES.has("USER_EDITED"), true);
  });

  it("treats NOT_APPLICABLE and IGNORED_WITH_REASON as audited absence states (Policy 5)", () => {
    assert.equal(ABSENCE_OVERRIDE_STATES.has("NOT_APPLICABLE"), true);
    assert.equal(ABSENCE_OVERRIDE_STATES.has("IGNORED_WITH_REASON"), true);
    // Absence states must NOT be counted as manual overrides with a real value.
    assert.equal(MANUAL_OVERRIDE_STATES.has("NOT_APPLICABLE"), false);
  });

  it("counts all four resolving states as unblocking", () => {
    for (const s of ["USER_CONFIRMED", "USER_EDITED", "NOT_APPLICABLE", "IGNORED_WITH_REASON"] as const) {
      assert.equal(RESOLVING_OVERRIDE_STATES.has(s), true);
    }
    assert.equal(RESOLVING_OVERRIDE_STATES.has("MISSING"), false);
    assert.equal(RESOLVING_OVERRIDE_STATES.has("AI_EXTRACTED"), false);
  });
});

// ─── 6. metadata-override.ts shares the registry's critical set ───────────────

describe("registry — single source of truth across modules (Policy 7)", () => {
  it("metadata-override CRITICAL_METADATA_FIELDS is the same set object as the registry", () => {
    assert.equal(CRITICAL_METADATA_FIELDS, ALWAYS_CRITICAL_FIELDS);
  });

  it("the shared set does not include the reconciled non-critical fields", () => {
    assert.equal(CRITICAL_METADATA_FIELDS.has("reference"), false);
    assert.equal(CRITICAL_METADATA_FIELDS.has("evaluationCriteria"), false);
  });
});

// ─── 7. Field display labels never expose raw column names ────────────────────

describe("registry — user-facing labels", () => {
  it("maps raw column names to human-readable labels", () => {
    assert.equal(fieldDisplayLabel("clientName"), "Client / procuring entity");
    assert.equal(fieldDisplayLabel("submissionEmails"), "Submission email(s)");
    assert.equal(fieldDisplayLabel("deadline"), "Submission deadline");
  });

  it("falls back to the key only for unknown fields", () => {
    assert.equal(fieldDisplayLabel("someUnknownField"), "someUnknownField");
  });
});

// ─── 8. Gate consequences follow criticality ──────────────────────────────────

describe("registry — gate consequences", () => {
  it("critical fields block generation and export", () => {
    const c = gateConsequenceForField("deadline");
    assert.equal(c.blocksGeneration, true);
    assert.equal(c.blocksExport, true);
  });

  it("non-critical fields do not block generation or export", () => {
    const c = gateConsequenceForField("reference");
    assert.equal(c.blocksGeneration, false);
    assert.equal(c.blocksExport, false);
  });

  it("submissionAddress blocks only when the method is physical", () => {
    assert.equal(gateConsequenceForField("submissionAddress", { submissionMethod: "hand delivery" }).blocksGeneration, true);
    assert.equal(gateConsequenceForField("submissionAddress", { submissionMethod: "email" }).blocksGeneration, false);
  });
});
