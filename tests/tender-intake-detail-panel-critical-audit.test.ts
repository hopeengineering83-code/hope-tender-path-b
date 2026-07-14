// Regression test: TenderIntakeDetailPanel's manual-entry ("Edit") action for
// missing/invalid facts previously sent only { field, fieldState, overrideValue }
// to POST /api/tenders/[id]/metadata-override. For submission-critical fields
// (requiredFor: "final_submission" — clientName, deadline, submissionMethod,
// submissionEmails, submissionAddress, projectTitle), that route requires a
// meaningful audit reason (>= MIN_CRITICAL_REASON_LENGTH chars) and a
// confirmationBasis, and rejects the request with MEANINGFUL_REASON_REQUIRED /
// CONFIRMATION_BASIS_REQUIRED otherwise (see the "Authority model" block in
// app/api/tenders/[id]/metadata-override/route.ts). The live panel never
// collected either field, so manually confirming a critical fact from the
// normal tender workspace was silently broken for exactly the fields CLAUDE.md
// marks as blocking (client/procuring entity, submission method, deadline,
// submission address, submission email).
//
// This also restores the CLAUDE.md-mandated "manual confirmation with an
// audit reason and source basis" requirement for critical fields, without
// reintroducing the ClientSubmissionDetailsPanel duplicate that
// tests/generic-tender-ui-defects.test.ts's "defect 3" guards against.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx", "utf8");

describe("TenderIntakeDetailPanel — critical-field audit trail on manual entry", () => {
  it("defines a MIN_CRITICAL_REASON_LENGTH matching the backend's requirement", () => {
    assert.match(src, /MIN_CRITICAL_REASON_LENGTH\s*=\s*10/, "must mirror MIN_CRITICAL_REASON_LENGTH from lib/engine/tender-fact-authority.ts");
  });

  it("defines the full CONFIRMATION_BASIS_OPTIONS list matching CONFIRMATION_BASES", () => {
    for (const basis of [
      "PROCUREMENT_NOTICE", "EMAIL_INVITATION", "PORTAL_LISTING", "PHONE_CALL_WITH_CLIENT",
      "CLIENT_INSTRUCTION", "PRE_BID_MEETING", "CLARIFICATION_DOCUMENT",
      "PRIOR_KNOWLEDGE_OF_CLIENT", "PUBLIC_REGISTRY", "OTHER_DOCUMENTED_SOURCE",
    ]) {
      assert.ok(src.includes(`"${basis}"`), `must include confirmation basis option ${basis}`);
    }
  });

  it("postOverride forwards reason and confirmationBasis to the metadata-override route", () => {
    assert.match(src, /body:\s*JSON\.stringify\(\{\s*field,\s*fieldState,\s*overrideValue,\s*reason,\s*confirmationBasis\s*\}\)/);
  });

  it("FactActions gates critical fields (requiredFor === final_submission) on a valid audit reason + basis", () => {
    assert.match(src, /const isCritical = fact\.requiredFor === "final_submission"/);
    assert.match(src, /const auditValid = !isCritical \|\| \(auditReason\.trim\(\)\.length >= MIN_CRITICAL_REASON_LENGTH && auditBasis !== ""\)/);
  });

  it("the Save button is disabled until the audit fields are valid for critical facts", () => {
    assert.match(src, /disabled=\{busy \|\| !editValue\.trim\(\) \|\| !auditValid\}/);
  });

  it("handleSaveEdit only sends reason/confirmationBasis when the fact is critical", () => {
    const fnStart = src.indexOf("async function handleSaveEdit() {");
    const fnEnd = src.indexOf("\n  function handleReExtract", fnStart);
    assert.ok(fnStart >= 0 && fnEnd > fnStart, "handleSaveEdit function boundaries not found");
    const fnBody = src.slice(fnStart, fnEnd);
    assert.match(fnBody, /isCritical \? auditReason\.trim\(\) : undefined/);
    assert.match(fnBody, /isCritical \? auditBasis : undefined/);
  });

  it("renders the audit reason textarea and confirmation-basis select only for critical facts", () => {
    assert.match(src, /\{isCritical && \(/);
    assert.match(src, /<textarea[\s\S]{0,300}auditReason/);
    assert.match(src, /<select[\s\S]{0,200}auditBasis/);
  });
});
