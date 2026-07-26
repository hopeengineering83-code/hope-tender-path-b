import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFactExtractionPhrase } from "../lib/engine/fact-extraction-phrase-classifier";
import { HEALTHCARE_UNWEIGHTED_CRITERIA, allCriteriaCovered, buildCriterionCoverage } from "../lib/engine/criterion-coverage-model";
import { SCOPE_DISCIPLINES, SCOPE_WORKSTREAMS, buildScopeDisciplineCrosswalk } from "../lib/engine/scope-discipline-crosswalk";
import { buildAppendixAuthorityRegister, resolveAppendixDocumentType } from "../lib/engine/appendix-authority-register";
import { FORBIDDEN_CLIENT_OUTPUT_TERMS, assertClientOutputSeparated } from "../lib/engine/client-output-separation";
import { validateCrossSourceConsistency } from "../lib/engine/cross-source-consistency-validator";
import { CLIENT_QUALITY_DIMENSIONS, scoreClientQuality } from "../lib/engine/client-quality-scoring";
import { buildUploadIntakeSession } from "../lib/engine/upload-intake-session";

describe("tender authority, criterion, and client-output integrity", () => {
  for (const [phrase, expected] of [
    ["The deadline is 30 June 2026", "STATED"], ["Not stated in the RFP", "NOT_STATED"],
    ["Required where applicable", "CONDITIONAL"], ["Joint ventures are not permitted", "REJECTED"], ["", "NOT_STATED"],
  ] as const) it(`classifies '${phrase || "empty"}' as ${expected}`, () => assert.equal(classifyFactExtractionPhrase(phrase), expected));

  it("defines exactly five unweighted healthcare criteria", () => assert.equal(HEALTHCARE_UNWEIGHTED_CRITERIA.length, 5));
  it("fails closed when any criterion lacks evidence", () => {
    const rows = buildCriterionCoverage(HEALTHCARE_UNWEIGHTED_CRITERIA, { clinical_service_scope: ["ev-1"] });
    assert.equal(allCriteriaCovered(rows), false);
    assert.equal(rows.filter((row) => !row.covered).length, 4);
  });
  it("passes only when every criterion has evidence", () => {
    const evidence = Object.fromEntries(HEALTHCARE_UNWEIGHTED_CRITERIA.map((criterion) => [criterion, [`ev-${criterion}`]]));
    assert.equal(allCriteriaCovered(buildCriterionCoverage(HEALTHCARE_UNWEIGHTED_CRITERIA, evidence)), true);
  });

  it("defines six workstreams and fourteen disciplines", () => {
    assert.equal(SCOPE_WORKSTREAMS.length, 6); assert.equal(SCOPE_DISCIPLINES.length, 14);
  });
  it("drops unknown crosswalk assignments", () => {
    const rows = buildScopeDisciplineCrosswalk([{ workstream: "design", discipline: "architecture" }, { workstream: "unknown", discipline: "unknown" }]);
    assert.deepEqual(rows.find((row) => row.workstream === "design")?.disciplines, ["architecture"]);
    assert.equal(rows.length, 6);
  });

  it("never infers Appendix A as CVs", () => {
    const entry = { label: "Appendix A", title: "Pricing Schedule", sourcePage: 20, sourceQuote: "Appendix A — Pricing Schedule", documentType: null };
    assert.equal(resolveAppendixDocumentType(entry), null);
    assert.equal(buildAppendixAuthorityRegister([entry]).length, 1);
  });
  it("requires appendix title and source quote", () => assert.equal(buildAppendixAuthorityRegister([{ label: "A", title: "", sourcePage: 1, sourceQuote: "", documentType: "CV" }]).length, 0));

  it("defines twelve forbidden internal terms", () => assert.equal(FORBIDDEN_CLIENT_OUTPUT_TERMS.length, 12));
  for (const term of FORBIDDEN_CLIENT_OUTPUT_TERMS) it(`blocks internal client-output term '${term}'`, () => assert.equal(assertClientOutputSeparated(`Visible ${term} detail`).ok, false));
  it("allows clean client-facing prose", () => assert.deepEqual(assertClientOutputSeparated("Our delivery plan addresses every requirement."), { ok: true }));

  it("detects grounded cross-source conflicts", () => {
    const conflicts = validateCrossSourceConsistency([
      { field: "deadline", value: "30 June", sourceFileId: "a", sourcePage: 1, sourceQuote: "Deadline is 30 June" },
      { field: "deadline", value: "1 July", sourceFileId: "b", sourcePage: 2, sourceQuote: "Closing date is 1 July" },
    ]);
    assert.equal(conflicts[0]?.blockerCode, "CROSS_SOURCE_CONFLICT");
  });
  it("ignores ungrounded alleged conflicts", () => assert.equal(validateCrossSourceConsistency([{ field: "deadline", value: "x", sourceFileId: "", sourcePage: 0, sourceQuote: "x" }]).length, 0));

  it("defines nine client-quality dimensions", () => assert.equal(CLIENT_QUALITY_DIMENSIONS.length, 9));
  it("caps blocked client quality below 100", () => assert.deepEqual(scoreClientQuality(Object.fromEntries(CLIENT_QUALITY_DIMENSIONS.map((key) => [key, 100])), ["BLOCKED"]).score, 99));
  it("permits 100 only without blockers", () => assert.equal(scoreClientQuality(Object.fromEntries(CLIENT_QUALITY_DIMENSIONS.map((key) => [key, 100]))).score, 100));

  it("builds order-independent intake revisions", () => {
    const a = { id: "a", originalFileName: "a.pdf", contentHash: "hash-a" };
    const b = { id: "b", originalFileName: "b.pdf", contentHash: "hash-b" };
    assert.deepEqual(buildUploadIntakeSession("u", "t", [a, b]), buildUploadIntakeSession("u", "t", [b, a]));
  });
  it("changes intake revision when package content changes", () => {
    const first = buildUploadIntakeSession("u", "t", [{ id: "a", originalFileName: "a.pdf", contentHash: "one" }]);
    const second = buildUploadIntakeSession("u", "t", [{ id: "a", originalFileName: "a.pdf", contentHash: "two" }]);
    assert.notEqual(first.sourceRevision, second.sourceRevision);
  });
});
