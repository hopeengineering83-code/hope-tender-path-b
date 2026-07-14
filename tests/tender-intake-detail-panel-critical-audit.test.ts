// Regression test: TenderIntakeDetailPanel's manual-entry ("Edit") action for
// missing/invalid facts previously sent only { field, fieldState, overrideValue }
// to POST /api/tenders/[id]/metadata-override. For submission-critical fields
// (clientName, title, deadline, submissionMethod, submissionEndpoint), that
// route requires a meaningful audit reason (>= MIN_CRITICAL_REASON_LENGTH chars)
// and a confirmationBasis, and rejects the request with
// MEANINGFUL_REASON_REQUIRED / CONFIRMATION_BASIS_REQUIRED otherwise.
//
// The panel now imports shared constants from tender-fact-authority.ts
// instead of duplicating them.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx", "utf8");

describe("TenderIntakeDetailPanel — critical-field audit trail on manual entry", () => {
  it("imports MIN_CRITICAL_REASON_LENGTH from tender-fact-authority.ts", () => {
    assert.match(src, /import\s*\{[^}]*MIN_CRITICAL_REASON_LENGTH[^}]*\}\s*from\s*"[^"]*tender-fact-authority"/,
      "must import MIN_CRITICAL_REASON_LENGTH from the shared module");
  });

  it("imports CONFIRMATION_BASES from tender-fact-authority.ts", () => {
    assert.match(src, /import\s*\{[^}]*CONFIRMATION_BASES[^}]*\}\s*from\s*"[^"]*tender-fact-authority"/,
      "must import CONFIRMATION_BASES from the shared module");
  });

  it("imports isSubmissionCriticalField from tender-fact-authority.ts", () => {
    assert.match(src, /import\s*\{[^}]*isSubmissionCriticalField[^}]*\}\s*from\s*"[^"]*tender-fact-authority"/,
      "must import isSubmissionCriticalField from the shared module");
  });

  it("derives CONFIRMATION_BASIS_OPTIONS from the shared CONFIRMATION_BASES", () => {
    assert.match(src, /CONFIRMATION_BASIS_OPTIONS\s*=\s*SHARED_CONFIRMATION_BASES/,
      "must derive options from the shared constant, not duplicate them");
  });

  it("postOverride forwards reason and confirmationBasis to the metadata-override route", () => {
    assert.match(src, /body:\s*JSON\.stringify\(\{\s*field,\s*fieldState,\s*overrideValue,\s*reason,\s*confirmationBasis\s*\}\)/);
  });

  it("FactActions gates critical fields using isSubmissionCriticalField", () => {
    assert.match(src, /isSubmissionCriticalField\(fact\.key\)/,
      "must use isSubmissionCriticalField to determine if a field is critical");
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
