import test from "node:test";
import assert from "node:assert/strict";
import { completenessStats, deriveExpectedCounts, hasUsableText } from "../app/api/company/plan-b-import/route";

test("deriveExpectedCounts prefers explicit expectedCounts over sourceDocuments parsed counts", () => {
  const result = deriveExpectedCounts(
    { expectedCounts: { experts: 25, projects: 114 } },
    [{ parsedExperts: 10, parsedProjects: 80 }],
  );
  assert.deepEqual(result, { experts: 25, projects: 114 });
});

test("deriveExpectedCounts falls back to parsed source document totals when explicit counts are absent", () => {
  const result = deriveExpectedCounts(
    {},
    [{ parsedExperts: 10, parsedProjects: 80 }, { parsedExperts: 2, parsedProjects: 4 }],
  );
  assert.deepEqual(result, { experts: 12, projects: 84 });
});

test("hasUsableText enforces raw-text threshold only when requireRawText=true", () => {
  assert.equal(hasUsableText("short", true), false);
  assert.equal(hasUsableText("x".repeat(50), true), true);
  assert.equal(hasUsableText(null, false), true);
});

test("completenessStats reports missing and excess correctly", () => {
  assert.deepEqual(completenessStats(10, 7), { expected: 10, imported: 7, missing: 3, excess: 0, matched: false });
  assert.deepEqual(completenessStats(10, 12), { expected: 10, imported: 12, missing: 0, excess: 2, matched: false });
  assert.deepEqual(completenessStats(10, 10), { expected: 10, imported: 10, missing: 0, excess: 0, matched: true });
});

