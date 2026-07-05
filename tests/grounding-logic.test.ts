import { test } from "node:test";
import assert from "node:assert";

// Mirrors the hardened strict-grounding predicate in
// lib/ai-jobs/analysis-job-service.ts finalizeJob(). A mandatory requirement is
// invalid unless it has a NON-EMPTY file reference, a positive source page, and
// a non-empty source quote. Empty-string/undefined/null tokens must NOT pass.
function isInvalidMandatory(r: any): boolean {
  const fileId = typeof r.sourceTenderFileId === "string" ? r.sourceTenderFileId.trim() : "";
  const fileToken = typeof r.sourceFileToken === "string" ? r.sourceFileToken.trim() : "";
  const hasId = fileId.length > 0 || fileToken.length > 0;
  const hasPage = typeof r.sourcePage === "number" && r.sourcePage > 0;
  const hasQuote = typeof r.sourceQuote === "string" && r.sourceQuote.trim().length > 0;
  return !hasId || !hasPage || !hasQuote;
}

test("strict grounding flags requirements missing file/page/quote", () => {
  const mandatoryReqs = [
    { priority: "MANDATORY", sourceTenderFileId: "1", sourcePage: 1, sourceQuote: "quote" }, // valid
    { priority: "MANDATORY", sourceTenderFileId: "1", sourcePage: 1, sourceQuote: null }, // no quote
  ];
  assert.strictEqual(mandatoryReqs.filter(isInvalidMandatory).length, 1);
});

test("empty-string / undefined file tokens do NOT count as grounded", () => {
  const cases = [
    { sourceFileToken: "", sourcePage: 2, sourceQuote: "q" }, // empty token
    { sourceFileToken: "   ", sourcePage: 2, sourceQuote: "q" }, // whitespace token
    { sourceTenderFileId: undefined, sourceFileToken: undefined, sourcePage: 2, sourceQuote: "q" }, // both missing
    { sourceTenderFileId: null, sourcePage: 2, sourceQuote: "q" }, // null id
  ];
  for (const c of cases) {
    assert.strictEqual(isInvalidMandatory(c), true, `expected ${JSON.stringify(c)} to be invalid (ungrounded)`);
  }
});

test("a fully grounded requirement passes", () => {
  assert.strictEqual(
    isInvalidMandatory({ sourceFileToken: "file-abc", sourcePage: 3, sourceQuote: "verbatim snippet" }),
    false,
  );
  // sourcePage must be a positive number; 0 or non-number is invalid.
  assert.strictEqual(isInvalidMandatory({ sourceTenderFileId: "id", sourcePage: 0, sourceQuote: "q" }), true);
});
