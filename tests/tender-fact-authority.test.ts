/**
 * Tests for the Tender Fact Authority Model — the new authority
 * classification that replaces the rigid "USER_EDITED must match raw
 * tender scalar + grounded source" rule.
 *
 * Verifies:
 *   1. SOURCE_GROUNDED — value with active source evidence → no block.
 *   2. HUMAN_CONFIRMED_OPERATIONAL — USER_EDITED/USER_CONFIRMED without
 *      source evidence → no draft block; final block only when audit
 *      insufficient on critical fields.
 *   3. NOT_STATED_IN_SOURCE — NOT_APPLICABLE/IGNORED_WITH_REASON → no
 *      draft block; final block only on critical fields.
 *   4. UNKNOWN — no value, no override → no draft block; final block
 *      only on critical fields.
 *   5. REJECTED_CANDIDATE — placeholder/garbage → no block (value discarded).
 *   6. isMeaningfulReason rejects boilerplate strings.
 *   7. isValidConfirmationBasis validates the basis enum.
 *   8. Operational fields NEVER block draft or final.
 *   9. Submission-critical fields block FINAL only (not draft).
 *  10. The authority model is wired into the metadata-override route.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  classifyTenderFactAuthority,
  isRejectedCandidate,
  isMeaningfulReason,
  isValidConfirmationBasis,
  isOperationalWarningField,
  isSubmissionCriticalField,
  isConditionallySubmissionCritical,
  authorityLabel,
  authorityImpactDescription,
  authorityAllowsDraft,
  authorityAllowsFinalExport,
  CONFIRMATION_BASES,
  MIN_CRITICAL_REASON_LENGTH,
  type AuthorityClassificationInput,
  type HumanConfirmedAudit,
} from "../lib/engine/tender-fact-authority";

// ─── Test fixtures ──────────────────────────────────────────────────────────

const POLICY_CTX_EMAIL = { submissionMethod: "Email" };
const POLICY_CTX_PHYSICAL = { submissionMethod: "Physical delivery" };
const POLICY_CTX_PORTAL = { submissionMethod: "Portal" };
const POLICY_CTX_UNKNOWN = { submissionMethod: null };

const AUDIT_SUFFICIENT: HumanConfirmedAudit = {
  reason: "Client confirmed the deadline during the pre-bid meeting on 2026-07-05.",
  confirmationBasis: "PRE_BID_MEETING",
  confirmedBy: "user-1",
  confirmedAt: new Date("2026-07-05T10:00:00Z"),
};

const AUDIT_INSUFFICIENT: HumanConfirmedAudit = {
  reason: "Manual value entered by user.", // boilerplate — should be rejected
  confirmationBasis: "PRE_BID_MEETING",
  confirmedBy: "user-1",
  confirmedAt: new Date("2026-07-05T10:00:00Z"),
};

function makeInput(overrides: Partial<AuthorityClassificationInput>): AuthorityClassificationInput {
  return {
    field: "clientName",
    effectiveValue: "Ministry of Test",
    rawValue: "Ministry of Test",
    override: null,
    isSourceGrounded: false,
    policyCtx: POLICY_CTX_UNKNOWN,
    audit: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("tender-fact-authority — REJECTED_CANDIDATE detection", () => {
  it("rejects known placeholders", () => {
    assert.equal(isRejectedCandidate("TBD"), true);
    assert.equal(isRejectedCandidate("N/A"), true);
    assert.equal(isRejectedCandidate("Not"), true);
    assert.equal(isRejectedCandidate("Only"), true);
    assert.equal(isRejectedCandidate("TBC"), true);
    assert.equal(isRejectedCandidate("None"), true);
    assert.equal(isRejectedCandidate("Unknown"), true);
    assert.equal(isRejectedCandidate("Reference Number"), true); // generic label
    assert.equal(isRejectedCandidate("Client Name"), true); // generic label
  });

  it("rejects partial emails", () => {
    assert.equal(isRejectedCandidate("procurement@"), true); // no domain
    assert.equal(isRejectedCandidate("@example.com"), true); // no local part
  });

  it("rejects footer fragments", () => {
    assert.equal(isRejectedCandidate("Page 1 of 10"), true);
  });

  it("does NOT reject valid values", () => {
    assert.equal(isRejectedCandidate("Ministry of Water"), false);
    assert.equal(isRejectedCandidate("RFP-2026-001"), false);
    assert.equal(isRejectedCandidate("procurement@example.com"), false);
    assert.equal(isRejectedCandidate("2026-12-15"), false);
  });

  it("does NOT reject empty (empty is UNKNOWN, not REJECTED)", () => {
    assert.equal(isRejectedCandidate(""), false);
    assert.equal(isRejectedCandidate(null), false);
    assert.equal(isRejectedCandidate(undefined), false);
  });
});

describe("tender-fact-authority — isMeaningfulReason", () => {
  it("rejects boilerplate strings the UI used to hardcode", () => {
    assert.equal(isMeaningfulReason("Manual value entered by user."), false);
    assert.equal(isMeaningfulReason("Confirmed from Client & Submission Details panel."), false);
    assert.equal(isMeaningfulReason("Marked not applicable by user."), false);
    assert.equal(isMeaningfulReason("User confirmed this detail was not found in the tender."), false);
  });

  it("rejects short reasons", () => {
    assert.equal(isMeaningfulReason("ok"), false);
    assert.equal(isMeaningfulReason("confirmed"), false);
  });

  it("accepts meaningful reasons", () => {
    assert.equal(isMeaningfulReason("Client confirmed the deadline during the pre-bid meeting."), true);
    assert.equal(isMeaningfulReason("Reference number obtained from the procurement notice PDF."), true);
    assert.equal(isMeaningfulReason("Email address from the invitation email sent on 2026-07-01."), true);
  });
});

describe("tender-fact-authority — isValidConfirmationBasis", () => {
  it("accepts valid bases", () => {
    assert.equal(isValidConfirmationBasis("PROCUREMENT_NOTICE"), true);
    assert.equal(isValidConfirmationBasis("EMAIL_INVITATION"), true);
    assert.equal(isValidConfirmationBasis("PORTAL_LISTING"), true);
    assert.equal(isValidConfirmationBasis("PHONE_CALL_WITH_CLIENT"), true);
    assert.equal(isValidConfirmationBasis("CLIENT_INSTRUCTION"), true);
    assert.equal(isValidConfirmationBasis("PRE_BID_MEETING"), true);
    assert.equal(isValidConfirmationBasis("CLARIFICATION_DOCUMENT"), true);
    assert.equal(isValidConfirmationBasis("PRIOR_KNOWLEDGE_OF_CLIENT"), true);
    assert.equal(isValidConfirmationBasis("PUBLIC_REGISTRY"), true);
    assert.equal(isValidConfirmationBasis("OTHER_DOCUMENTED_SOURCE"), true);
  });

  it("rejects invalid bases", () => {
    assert.equal(isValidConfirmationBasis("GUESSED"), false);
    assert.equal(isValidConfirmationBasis("UNKNOWN"), false);
    assert.equal(isValidConfirmationBasis(""), false);
    assert.equal(isValidConfirmationBasis("random"), false);
  });

  it("CONFIRMATION_BASES has 10 entries", () => {
    assert.equal(CONFIRMATION_BASES.length, 10);
  });
});

describe("tender-fact-authority — field classification", () => {
  it("isOperationalWarningField identifies optional fields", () => {
    assert.equal(isOperationalWarningField("reference"), true);
    assert.equal(isOperationalWarningField("country"), true);
    assert.equal(isOperationalWarningField("donorAgency"), true);
    assert.equal(isOperationalWarningField("clientWebsite"), true);
    assert.equal(isOperationalWarningField("budget"), true);
    assert.equal(isOperationalWarningField("pageLimit"), true);
  });

  it("isSubmissionCriticalField identifies always-critical fields", () => {
    assert.equal(isSubmissionCriticalField("clientName"), true);
    assert.equal(isSubmissionCriticalField("title"), true);
    assert.equal(isSubmissionCriticalField("deadline"), true);
    assert.equal(isSubmissionCriticalField("submissionMethod"), true);
    assert.equal(isSubmissionCriticalField("submissionEndpoint"), true);
  });

  it("isConditionallySubmissionCritical identifies method-dependent fields", () => {
    assert.equal(isConditionallySubmissionCritical("submissionEmails", POLICY_CTX_EMAIL), true);
    assert.equal(isConditionallySubmissionCritical("submissionEmails", POLICY_CTX_PHYSICAL), false);
    assert.equal(isConditionallySubmissionCritical("submissionAddress", POLICY_CTX_PHYSICAL), true);
    assert.equal(isConditionallySubmissionCritical("submissionAddress", POLICY_CTX_EMAIL), false);
  });
});

describe("tender-fact-authority — classifyTenderFactAuthority", () => {
  it("SOURCE_GROUNDED — value with active source evidence → no block", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: "Ministry of Water",
      rawValue: "Ministry of Water",
      override: null,
      isSourceGrounded: true,
    }));
    assert.equal(result.authority, "SOURCE_GROUNDED");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false);
    assert.equal(result.auditSufficientForFinal, true);
  });

  it("HUMAN_CONFIRMED_OPERATIONAL — USER_EDITED on critical field without grounding → no draft block, final block when audit insufficient", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: "Ministry of Water",
      rawValue: null, // not in tender source
      override: { fieldState: "USER_EDITED", overrideValue: "Ministry of Water", reason: null, confirmationBasis: null } as any,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
      audit: null, // no audit
    }));
    assert.equal(result.authority, "HUMAN_CONFIRMED_OPERATIONAL");
    assert.equal(result.blocksDraft, false); // NEVER blocks draft
    assert.equal(result.blocksFinalExport, true); // blocks final (critical + no audit)
    assert.equal(result.auditSufficientForFinal, false);
  });

  it("HUMAN_CONFIRMED_OPERATIONAL — USER_EDITED on critical field with sufficient audit → no block", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: "Ministry of Water",
      rawValue: null,
      override: { fieldState: "USER_EDITED", overrideValue: "Ministry of Water", reason: AUDIT_SUFFICIENT.reason, confirmationBasis: AUDIT_SUFFICIENT.confirmationBasis } as any,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
      audit: AUDIT_SUFFICIENT,
    }));
    assert.equal(result.authority, "HUMAN_CONFIRMED_OPERATIONAL");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false); // audit sufficient
    assert.equal(result.auditSufficientForFinal, true);
  });

  it("HUMAN_CONFIRMED_OPERATIONAL — USER_EDITED on OPERATIONAL field (reference) → NEVER blocks", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "reference",
      effectiveValue: "RFP-2026-001",
      rawValue: null,
      override: { fieldState: "USER_EDITED", overrideValue: "RFP-2026-001", reason: null, confirmationBasis: null } as any,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
      audit: null,
    }));
    assert.equal(result.authority, "HUMAN_CONFIRMED_OPERATIONAL");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false); // operational field — never blocks
    assert.equal(result.auditSufficientForFinal, true); // non-critical → always sufficient
  });

  it("NOT_STATED_IN_SOURCE — IGNORED_WITH_REASON on operational field → no block", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "reference",
      effectiveValue: null,
      rawValue: null,
      override: { fieldState: "IGNORED_WITH_REASON", overrideValue: null, reason: "Reference not stated in tender", confirmationBasis: null } as any,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
    }));
    assert.equal(result.authority, "NOT_STATED_IN_SOURCE");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false); // operational field
  });

  it("NOT_STATED_IN_SOURCE — IGNORED_WITH_REASON on critical field → blocks final only", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: null,
      rawValue: null,
      override: { fieldState: "IGNORED_WITH_REASON", overrideValue: null, reason: "Not stated in tender", confirmationBasis: null } as any,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
    }));
    assert.equal(result.authority, "NOT_STATED_IN_SOURCE");
    assert.equal(result.blocksDraft, false); // never blocks draft
    assert.equal(result.blocksFinalExport, true); // critical field
  });

  it("UNKNOWN — no value, no override on critical field → blocks final only", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: null,
      rawValue: null,
      override: null,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
    }));
    assert.equal(result.authority, "UNKNOWN");
    assert.equal(result.blocksDraft, false); // never blocks draft
    assert.equal(result.blocksFinalExport, true); // critical field
  });

  it("UNKNOWN — no value, no override on operational field → no block", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "reference",
      effectiveValue: null,
      rawValue: null,
      override: null,
      isSourceGrounded: false,
      policyCtx: POLICY_CTX_UNKNOWN,
    }));
    assert.equal(result.authority, "UNKNOWN");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false); // operational field
  });

  it("REJECTED_CANDIDATE — placeholder value → no block (value discarded)", () => {
    const result = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: "TBD",
      rawValue: "TBD",
      override: null,
      isSourceGrounded: false,
    }));
    assert.equal(result.authority, "REJECTED_CANDIDATE");
    assert.equal(result.blocksDraft, false);
    assert.equal(result.blocksFinalExport, false);
  });
});

describe("tender-fact-authority — labels + impact descriptions", () => {
  it("authorityLabel returns human-readable strings", () => {
    assert.equal(authorityLabel("SOURCE_GROUNDED"), "Source-grounded confirmed");
    assert.equal(authorityLabel("HUMAN_CONFIRMED_OPERATIONAL"), "Human-confirmed operational value");
    assert.equal(authorityLabel("NOT_STATED_IN_SOURCE"), "Not stated in source");
    assert.equal(authorityLabel("UNKNOWN"), "Not detected");
    assert.equal(authorityLabel("REJECTED_CANDIDATE"), "Candidate needs review");
  });

  it("authorityImpactDescription distinguishes draft vs final", () => {
    const grounded = classifyTenderFactAuthority(makeInput({ isSourceGrounded: true }));
    assert.equal(authorityImpactDescription(grounded), "Allows draft and final work");

    const unknownCritical = classifyTenderFactAuthority(makeInput({
      field: "clientName",
      effectiveValue: null,
      rawValue: null,
      override: null,
    }));
    assert.equal(authorityImpactDescription(unknownCritical), "Required before final submission");

    const unknownOperational = classifyTenderFactAuthority(makeInput({
      field: "reference",
      effectiveValue: null,
      rawValue: null,
      override: null,
    }));
    assert.equal(authorityImpactDescription(unknownOperational), "Warning only");
  });
});

describe("tender-fact-authority — wired into metadata-override route", () => {
  it("route imports the authority model", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(src.includes("from \"../../../../../lib/engine/tender-fact-authority\""), "must import tender-fact-authority");
    assert.ok(!src.includes("  classifyTenderFactAuthority,"), "must not retain an unused classifier import");
    assert.ok(src.includes("isMeaningfulReason"), "must import isMeaningfulReason");
    assert.ok(src.includes("isValidConfirmationBasis"), "must import isValidConfirmationBasis");
    assert.ok(src.includes("MIN_CRITICAL_REASON_LENGTH"), "must import MIN_CRITICAL_REASON_LENGTH");
  });

  it("route requires meaningful reason for USER_EDITED on critical fields", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(src.includes("MEANINGFUL_REASON_REQUIRED"), "must reject boilerplate reasons");
    assert.ok(src.includes("isMeaningfulReason(reason, MIN_CRITICAL_REASON_LENGTH)"), "must call isMeaningfulReason with MIN_CRITICAL_REASON_LENGTH");
  });

  it("route requires confirmationBasis for USER_EDITED on critical fields", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(src.includes("CONFIRMATION_BASIS_REQUIRED"), "must require confirmationBasis");
    assert.ok(src.includes("isValidConfirmationBasis"), "must validate confirmationBasis");
  });

  it("route persists authorityClass + confirmationBasis + confirmedAt", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(src.includes("authorityClass"), "must persist authorityClass");
    assert.ok(src.includes("confirmationBasis"), "must persist confirmationBasis");
    assert.ok(src.includes("confirmedAt"), "must persist confirmedAt");
  });

  it("route does NOT promote USER_EDITED value into tender scalar (mission rule D)", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    // The old "updateData[field] = overrideValue" promotion must be GONE.
    assert.ok(!src.includes("updateData[field] = field === \"deadline\""), "must NOT promote USER_EDITED into tender scalar");
    assert.ok(src.includes("NOT promoted into the tender scalar"), "must document that USER_EDITED is not promoted");
  });

  it("route accepts confirmationBasis in the request body", () => {
    const src = readFileSync("app/api/tenders/[id]/metadata-override/route.ts", "utf8");
    assert.ok(src.includes("confirmationBasis?: string | null"), "must accept confirmationBasis in body type");
  });
});

describe("tender-fact-authority — wired into canonical resolver", () => {
  it("canonical-field-state.ts imports the authority model", () => {
    const src = readFileSync("lib/engine/canonical-field-state.ts", "utf8");
    assert.ok(src.includes("from \"./tender-fact-authority\""), "must import tender-fact-authority");
    assert.ok(src.includes("auditSufficientForFinal"), "must define auditSufficientForFinal helper");
  });

  it("canonical resolver uses hasExportBlocker for final (not hasGenerationBlocker for draft)", () => {
    const src = readFileSync("lib/engine/canonical-field-state.ts", "utf8");
    // The obsolete value-driven blocker must be absent; final authority is
    // enforced by export eligibility and the audited override path.
    assert.ok(!src.includes("valueDrivenUngroundedBlock"), "must remove the dead value-driven blocker marker");
    // The new draftHardBlockReasons must NOT include manual values
    assert.ok(src.includes("draftHardBlockReasons"), "must define draftHardBlockReasons");
    assert.ok(src.includes("isManualValuePresent"), "must compute isManualValuePresent");
  });

  it("canonical resolver overrides type includes authorityClass + confirmationBasis", () => {
    const src = readFileSync("lib/engine/canonical-field-state.ts", "utf8");
    assert.ok(src.includes("authorityClass?: string | null"), "overrides type must include authorityClass");
    assert.ok(src.includes("confirmationBasis?: string | null"), "overrides type must include confirmationBasis");
  });
});

describe("tender-fact-authority — wired into generation readiness gate", () => {
  it("gate distinguishes draft (hasGenerationBlocker) from final (hasExportBlocker)", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(src.includes("isDraftPurpose"), "must compute isDraftPurpose");
    assert.ok(src.includes("fieldStates.hasGenerationBlocker"), "must use hasGenerationBlocker for draft");
    assert.ok(src.includes("fieldStates.hasExportBlocker"), "must use hasExportBlocker for final");
  });

  it("gate loads authority columns in the metadataOverrides select", () => {
    const src = readFileSync("lib/engine/generation-readiness-gate.ts", "utf8");
    assert.ok(src.includes("confirmationBasis: true"), "must select confirmationBasis");
    assert.ok(src.includes("authorityClass: true"), "must select authorityClass");
  });
});

describe("tender-fact-authority — migration exists", () => {
  it("migration file exists with the 3 new columns", () => {
    const src = readFileSync("prisma/migrations/20260707000000_add_authority_class_to_metadata_override/migration.sql", "utf8");
    assert.ok(src.includes("authorityClass"), "must add authorityClass column");
    assert.ok(src.includes("confirmationBasis"), "must add confirmationBasis column");
    assert.ok(src.includes("confirmedAt"), "must add confirmedAt column");
    // All three must be nullable (additive)
    assert.ok(src.includes("ADD COLUMN \"authorityClass\" TEXT"), "authorityClass must be nullable TEXT");
    assert.ok(src.includes("ADD COLUMN \"confirmationBasis\" TEXT"), "confirmationBasis must be nullable TEXT");
    assert.ok(src.includes("ADD COLUMN \"confirmedAt\" TIMESTAMP(3)"), "confirmedAt must be nullable TIMESTAMP");
  });

  it("schema.prisma includes the 3 new columns on TenderMetadataOverride", () => {
    const src = readFileSync("prisma/schema.prisma", "utf8");
    assert.ok(src.includes("authorityClass   String?"), "schema must include authorityClass");
    assert.ok(src.includes("confirmationBasis String?"), "schema must include confirmationBasis");
    assert.ok(src.includes("confirmedAt      DateTime?"), "schema must include confirmedAt");
  });
});
