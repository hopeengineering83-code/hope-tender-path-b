import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");

test("AUTO_FINALIZE replaces a required PDF when its validated DOCX source is newer", () => {
  assert.match(source, /existingPdf\.updatedAt\s*>=\s*sourceDoc\.updatedAt/);
  assert.match(source, /const targetRow = existingPdf \?\? plannedRow/);
  assert.match(source, /generatedDocument\.update\(\{ where: \{ id: targetRow\.id \}/);
});

test("AUTO_FINALIZE refreshes coverage after the replacement PDF is validated", () => {
  const validation = source.indexOf("auto-finalize.pdf-validation.complete");
  const postPdfReconcile = source.indexOf("post-PDF requirement-coverage reconcile failed");
  const packageReconcile = source.indexOf("auto-finalize.package-reconciliation");
  assert.ok(validation < postPdfReconcile && postPdfReconcile < packageReconcile);
});
