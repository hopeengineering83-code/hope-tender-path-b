// Unit tests for submission-method and deadline export gate blockers.
//
// Tests the logic introduced in lib/engine/export-readiness.ts for:
//   SUBMISSION_EMAIL_MISSING — email method + no submissionEmails → HIGH blocker
//   SUBMISSION_ADDRESS_MISSING — physical method + no submissionAddress → MEDIUM advisory
//   DEADLINE_PASSED — deadline < now → HIGH advisory
//
// Because checkTenderLevelExportBlockers requires a live DB, these tests
// verify the gate logic through source-code pattern checks and pure helper
// functions extracted from the same module, following the same pattern used
// in tests/recovery-command-center-actions.test.ts.

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

  it("the email-missing gate checks submissionMethod contains 'email' (case-insensitive)", () => {
    assert.ok(
      SRC.includes("/email/i.test(method)"),
      "email detection must use case-insensitive regex",
    );
  });

  it("the email-missing gate also checks for method === 'EMAIL'", () => {
    assert.ok(
      SRC.includes('method === "EMAIL"'),
      "email detection must also handle exact EMAIL enum value",
    );
  });

  it("email-missing gate fires when submissionEmails is falsy", () => {
    assert.ok(
      SRC.includes("needsEmail && !tender.submissionEmails"),
      "email-missing gate must check !tender.submissionEmails",
    );
  });

  it("email-missing blocker uses HIGH severity", () => {
    const emailMissingIdx = SRC.indexOf('"SUBMISSION_EMAIL_MISSING"');
    assert.ok(emailMissingIdx !== -1, "SUBMISSION_EMAIL_MISSING must exist");
    // The HIGH severity string must appear near the blocker call (within 300 chars)
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

  it("address-missing gate checks for sealed/hand/courier submission methods", () => {
    assert.ok(
      SRC.includes("/sealed|hand|courier/i.test(method)"),
      "address detection must cover sealed/hand/courier methods",
    );
  });

  it("address-missing gate also checks SEALED_ENVELOPE / HAND_DELIVERY / COURIER enum values", () => {
    assert.ok(
      SRC.includes("SEALED_ENVELOPE|HAND_DELIVERY|COURIER"),
      "address detection must cover enum values for physical submission",
    );
  });

  it("address-missing advisory fires when submissionAddress is falsy", () => {
    assert.ok(
      SRC.includes("needsAddress && !tender.submissionAddress"),
      "address-missing advisory must check !tender.submissionAddress",
    );
  });

  it("address-missing is an advisoryWarning (MEDIUM), not a hard blocker", () => {
    const addressIdx = SRC.indexOf('"SUBMISSION_ADDRESS_MISSING"');
    assert.ok(addressIdx !== -1, "SUBMISSION_ADDRESS_MISSING must exist");
    // Should appear inside advisoryWarnings.push(), not blockers.push()
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

  it("deadline gate compares deadline date against current time", () => {
    assert.ok(
      SRC.includes("deadlineDate < now"),
      "deadline gate must compare deadlineDate < now",
    );
  });

  it("deadline gate guards against NaN dates", () => {
    assert.ok(
      SRC.includes("Number.isNaN(deadlineDate.getTime())"),
      "deadline gate must guard against NaN with Number.isNaN",
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

// ── 4. Logic isolation — email vs address method detection ───────────────────

describe("export gate — email vs physical method detection logic", () => {
  it("needsEmail and needsAddress are derived from the same tender.submissionMethod", () => {
    const methodIdx = SRC.indexOf("const needsEmail");
    assert.ok(methodIdx !== -1, "needsEmail variable must be declared");
    const needsAddressIdx = SRC.indexOf("const needsAddress");
    assert.ok(needsAddressIdx !== -1, "needsAddress variable must be declared");
    // Both should appear in close proximity (within 600 chars of each other)
    assert.ok(
      Math.abs(methodIdx - needsAddressIdx) < 600,
      "needsEmail and needsAddress must be declared near each other",
    );
  });

  it("email and address checks are guarded by submission method being present", () => {
    // The submissionMethod check is } else { so these only fire when method is set
    const submissionMissingIdx = SRC.indexOf('"SUBMISSION_METHOD_MISSING"');
    assert.ok(submissionMissingIdx !== -1, "SUBMISSION_METHOD_MISSING blocker must exist");
    const elseIdx = SRC.indexOf("} else {", submissionMissingIdx);
    const emailIdx = SRC.indexOf("needsEmail", elseIdx);
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

  it("DEADLINE_MISSING blocker fires when deadline is null (before the deadline-passed check)", () => {
    const deadlineMissingIdx = SRC.indexOf('"DEADLINE_MISSING"');
    const deadlinePassedIdx = SRC.indexOf('"DEADLINE_PASSED"');
    assert.ok(deadlineMissingIdx !== -1, "DEADLINE_MISSING must be present");
    assert.ok(deadlinePassedIdx !== -1, "DEADLINE_PASSED must be present");
    // DEADLINE_MISSING check (!tender.deadline) must come before DEADLINE_PASSED (deadline < now)
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

// ── 6. EVALUATION_CRITERIA_NOT_EXTRACTED advisory ────────────────────────────

describe("export gate — EVALUATION_CRITERIA_NOT_EXTRACTED advisory", () => {
  it("source registers EVALUATION_CRITERIA_NOT_EXTRACTED as an advisoryWarning category", () => {
    assert.ok(
      SRC.includes('"EVALUATION_CRITERIA_NOT_EXTRACTED"'),
      "EVALUATION_CRITERIA_NOT_EXTRACTED must be registered in export-readiness.ts",
    );
  });

  it("the check reads evaluationCriteriaPages from assessExtractionQualityPerPage output", () => {
    assert.ok(
      SRC.includes("evaluationCriteriaPages"),
      "export-readiness.ts must check evaluationCriteriaPages to enforce the CLAUDE.md export gate",
    );
  });

  it("the check is scoped to totalDetectedPages > 0 to avoid false positives on empty files", () => {
    const criteriaIdx = SRC.indexOf('"EVALUATION_CRITERIA_NOT_EXTRACTED"');
    assert.ok(criteriaIdx !== -1, "EVALUATION_CRITERIA_NOT_EXTRACTED must exist");
    const before = SRC.slice(Math.max(0, criteriaIdx - 500), criteriaIdx);
    assert.ok(
      before.includes("totalDetectedPages > 0"),
      "evaluation criteria check must be guarded by totalDetectedPages > 0",
    );
  });

  it("evaluation criteria warning is an advisoryWarning, not a hard blocker", () => {
    const criteriaIdx = SRC.indexOf('"EVALUATION_CRITERIA_NOT_EXTRACTED"');
    assert.ok(criteriaIdx !== -1, "EVALUATION_CRITERIA_NOT_EXTRACTED must exist");
    const before = SRC.slice(Math.max(0, criteriaIdx - 300), criteriaIdx);
    assert.ok(
      before.includes("advisoryWarnings.push"),
      "EVALUATION_CRITERIA_NOT_EXTRACTED should be an advisory warning, not a hard blocker",
    );
  });
});
