// Unit tests for submission-method and deadline export gate blockers.
//
// Tests the logic introduced in lib/engine/export-readiness.ts for:
//   SUBMISSION_EMAIL_MISSING — email method + no submissionEmails → HIGH blocker
//   SUBMISSION_ADDRESS_MISSING — physical method + no submissionAddress → MEDIUM advisory
//   DEADLINE_PASSED — deadline < now → HIGH advisory
//
// Updated for the G4 fix: the gate now uses EFFECTIVE values (override ?? raw)
// and shared policy classifiers (isEmailSubmissionMethod / isPhysicalSubmissionMethod)
// instead of ad-hoc regexes on raw tender columns.
//
// Because checkTenderLevelExportBlockers requires a live DB, these tests
// verify the gate logic through source-code pattern checks.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "lib/engine/export-readiness.ts"), "utf8");

// ── 1. SUBMISSION_EMAIL_MISSING ────────────────────────────────────────────────

describe("export gate — SUBMISSION_EMAIL_MISSING blocker", () => {
  it("source registers SUBMISSION_EMAIL_MISSING as a tenderBlocker code", () => {
    assert.ok(
      SRC.includes('"SUBMISSION_EMAIL_MISSING"'),
      "SUBMISSION_EMAIL_MISSING must be registered in export-readiness.ts",
    );
  });

  it("email detection uses the shared isEmailSubmissionMethod classifier (not ad-hoc regex)", () => {
    assert.ok(
      SRC.includes("isEmailSubmissionMethod(effMethod)"),
      "email detection must use isEmailSubmissionMethod on the effective method (G4 fix)",
    );
    assert.ok(
      !SRC.includes("/email/i.test(method)"),
      "old ad-hoc /email/i regex must be removed (G4 fix)",
    );
  });

  it("email-missing gate fires when effective submissionEmails is falsy", () => {
    assert.ok(
      SRC.includes("isEmailSubmissionMethod(effMethod) && !effEmails"),
      "email-missing gate must check !effEmails (effective value, not raw)",
    );
  });

  it("email-missing blocker uses HIGH severity", () => {
    const emailMissingIdx = SRC.indexOf('"SUBMISSION_EMAIL_MISSING"');
    assert.ok(emailMissingIdx !== -1, "SUBMISSION_EMAIL_MISSING must exist");
    const snippet = SRC.slice(emailMissingIdx, emailMissingIdx + 350);
    assert.ok(snippet.includes('"HIGH"'), "SUBMISSION_EMAIL_MISSING must be a HIGH severity blocker");
  });
});

// ── 2. SUBMISSION_ADDRESS_MISSING ─────────────────────────────────────────────

describe("export gate — SUBMISSION_ADDRESS_MISSING advisory", () => {
  it("source registers SUBMISSION_ADDRESS_MISSING as an advisoryWarning category", () => {
    assert.ok(
      SRC.includes('"SUBMISSION_ADDRESS_MISSING"'),
      "SUBMISSION_ADDRESS_MISSING must be registered as an advisory",
    );
  });

  it("address detection uses the shared isPhysicalSubmissionMethod classifier (not ad-hoc regex)", () => {
    assert.ok(
      SRC.includes("isPhysicalSubmissionMethod(effMethod)"),
      "address detection must use isPhysicalSubmissionMethod on the effective method (G4 fix)",
    );
    assert.ok(
      !SRC.includes("/sealed|hand|courier/i.test(method)"),
      "old ad-hoc /sealed|hand|courier/i regex must be removed (G4 fix)",
    );
    assert.ok(
      !SRC.includes("SEALED_ENVELOPE|HAND_DELIVERY|COURIER"),
      "old ad-hoc enum regex must be removed (G2 underscore-aware classifier covers it)",
    );
  });

  it("address-missing advisory fires when effective submissionAddress is falsy", () => {
    assert.ok(
      SRC.includes("isPhysicalSubmissionMethod(effMethod) && !effAddress"),
      "address-missing advisory must check !effAddress (effective value, not raw)",
    );
  });

  it("address-missing is an advisoryWarning (MEDIUM), not a hard blocker", () => {
    const addressIdx = SRC.indexOf('"SUBMISSION_ADDRESS_MISSING"');
    assert.ok(addressIdx !== -1, "SUBMISSION_ADDRESS_MISSING must exist");
    const before = SRC.slice(Math.max(0, addressIdx - 200), addressIdx);
    assert.ok(
      before.includes("advisoryWarnings.push"),
      "SUBMISSION_ADDRESS_MISSING should be an advisory, not a hard blocker",
    );
    const snippet = SRC.slice(addressIdx, addressIdx + 300);
    assert.ok(snippet.includes('"MEDIUM"'), "SUBMISSION_ADDRESS_MISSING must be MEDIUM severity");
  });
});

// ── 3. DEADLINE_PASSED ────────────────────────────────────────────────────────

describe("export gate — DEADLINE_PASSED advisory", () => {
  it("source registers DEADLINE_PASSED as an advisoryWarning category", () => {
    assert.ok(
      SRC.includes('"DEADLINE_PASSED"'),
      "DEADLINE_PASSED must be registered as an advisory",
    );
  });

  it("deadline gate uses effective deadline (override-aware)", () => {
    assert.ok(
      SRC.includes("effDeadline < now"),
      "deadline gate must compare the effective deadline < now (G4 fix)",
    );
  });

  it("deadline gate reports days-ago count in the warning message", () => {
    assert.ok(
      SRC.includes("daysAgo"),
      "deadline warning must include the number of days since the deadline",
    );
  });

  it("DEADLINE_PASSED is an advisory (HIGH severity), not a hard blocker", () => {
    const deadlineIdx = SRC.indexOf('"DEADLINE_PASSED"');
    assert.ok(deadlineIdx !== -1, "DEADLINE_PASSED must exist");
    const before = SRC.slice(Math.max(0, deadlineIdx - 200), deadlineIdx);
    assert.ok(
      before.includes("advisoryWarnings.push"),
      "DEADLINE_PASSED should be an advisory, not a hard blocker",
    );
    const snippet = SRC.slice(deadlineIdx, deadlineIdx + 300);
    assert.ok(snippet.includes('"HIGH"'), "DEADLINE_PASSED advisory must be HIGH severity");
  });

  it("deadline gate recommends marking tender as lost/withdrawn after expiry", () => {
    assert.ok(
      SRC.includes("lost/withdrawn"),
      "DEADLINE_PASSED advisory must recommend marking the tender as closed",
    );
  });
});

// ── 4. Effective-value wiring ─────────────────────────────────────────────────

describe("export gate — effective-value wiring (G4 fix)", () => {
  it("declares effMethod, effEmails, effAddress from effectiveValue()", () => {
    assert.ok(
      SRC.includes("const effMethod = effectiveValue(\"submissionMethod\", tender.submissionMethod)"),
      "must declare effMethod via effectiveValue (G4 fix)",
    );
    assert.ok(
      SRC.includes("const effEmails = effectiveValue(\"submissionEmails\", tender.submissionEmails)"),
      "must declare effEmails via effectiveValue (G4 fix)",
    );
    assert.ok(
      SRC.includes("const effAddress = effectiveValue(\"submissionAddress\", tender.submissionAddress)"),
      "must declare effAddress via effectiveValue (G4 fix)",
    );
  });

  it("declares effDeadline from effectiveDeadline()", () => {
    assert.ok(
      SRC.includes("const effDeadline = effectiveDeadline(tender.deadline)"),
      "must declare effDeadline via effectiveDeadline (G4 fix)",
    );
  });

  it("defines effectiveValue helper that reads overrideValue for USER_EDITED/USER_CONFIRMED", () => {
    assert.ok(
      SRC.includes("function effectiveValue(field: string, raw: string | null | undefined): string | null"),
      "must define effectiveValue helper (G4 fix)",
    );
    assert.ok(
      SRC.includes('o.fieldState === "USER_EDITED" || o.fieldState === "USER_CONFIRMED"'),
      "effectiveValue must return overrideValue for USER_EDITED/USER_CONFIRMED (G4 fix)",
    );
  });

  it("imports the shared policy classifiers", () => {
    assert.ok(
      SRC.includes("import { isEmailSubmissionMethod, isPhysicalSubmissionMethod } from \"./submission-method-policy\""),
      "must import isEmailSubmissionMethod + isPhysicalSubmissionMethod (G4 fix)",
    );
  });

  it("email and address checks are guarded by submission method being present", () => {
    const submissionMissingIdx = SRC.indexOf('"SUBMISSION_METHOD_MISSING"');
    assert.ok(submissionMissingIdx !== -1, "SUBMISSION_METHOD_MISSING blocker must exist");
    const elseIdx = SRC.indexOf("} else {", submissionMissingIdx);
    const emailIdx = SRC.indexOf("isEmailSubmissionMethod(effMethod)", elseIdx);
    assert.ok(emailIdx > elseIdx, "email/address checks must be inside the else branch (only when method is set)");
  });
});

// ── 5. DEADLINE_MISSING blocker ────────────────────────────────────────────────

describe("export gate — DEADLINE_MISSING blocker", () => {
  it("DEADLINE_MISSING source string exists in export-readiness.ts", () => {
    assert.ok(
      SRC.includes('"DEADLINE_MISSING"'),
      "DEADLINE_MISSING blocker must be defined in export-readiness.ts",
    );
  });

  it("DEADLINE_MISSING blocker fires when effective deadline is null (before the deadline-passed check)", () => {
    const deadlineMissingIdx = SRC.indexOf('"DEADLINE_MISSING"');
    const deadlinePassedIdx = SRC.indexOf('"DEADLINE_PASSED"');
    assert.ok(deadlineMissingIdx !== -1, "DEADLINE_MISSING must be present");
    assert.ok(deadlinePassedIdx !== -1, "DEADLINE_PASSED must be present");
    assert.ok(
      deadlineMissingIdx < deadlinePassedIdx,
      "DEADLINE_MISSING blocker must appear before DEADLINE_PASSED advisory in source",
    );
  });

  it("DEADLINE_MISSING is a HIGH severity blocker (not just advisory)", () => {
    const idx = SRC.indexOf('"DEADLINE_MISSING"');
    const snippet = SRC.slice(idx, idx + 400);
    assert.ok(
      snippet.includes('"HIGH"'),
      "DEADLINE_MISSING must be a HIGH severity blocker",
    );
  });
});
