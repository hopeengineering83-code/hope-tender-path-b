import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { SETTINGS_PRESENTATION_SEMANTICS } from "../app/dashboard/settings/settings-contract";

test("settings defaults are explicitly presentation-only", () => {
  assert.equal(SETTINGS_PRESENTATION_SEMANTICS.scope, "PRESENTATION_DEFAULTS");
  assert.equal(SETTINGS_PRESENTATION_SEMANTICS.affectsTenderFacts, false);
  assert.equal(SETTINGS_PRESENTATION_SEMANTICS.affectsSubmissionRequirements, false);
  assert.equal(SETTINGS_PRESENTATION_SEMANTICS.affectsEvidence, false);
  assert.equal(SETTINGS_PRESENTATION_SEMANTICS.affectsClientData, false);
});

test("settings UI does not write company or tender fact endpoints", () => {
  const source = readFileSync("app/dashboard/settings/page.tsx", "utf8");
  assert.doesNotMatch(source, /fetch\(["']\/api\/company["']/);
  assert.doesNotMatch(source, /fetch\(["']\/api\/tenders/);
  assert.match(source, /Presentation defaults only/);
  assert.match(source, /never populate tender currency/);
});

test("settings API returns the shared presentation semantics contract", () => {
  const source = readFileSync("app/api/settings/route.ts", "utf8");
  assert.match(source, /SETTINGS_PRESENTATION_SEMANTICS/);
  assert.match(source, /presentationSemantics/);
  assert.doesNotMatch(source, /prisma\.tender\.(?:create|update|upsert)/);
});

test("settings API rejects ZIP instead of silently normalizing it", () => {
  const source = readFileSync("app/api/settings/route.ts", "utf8");
  assert.match(source, /if \(!VALID_EXPORT_FORMATS\.has\(upper\)\)/);
  assert.match(source, /ZIP is a package-download mode, not a document format/);
  assert.doesNotMatch(source, /upper === ["']ZIP["']\s*\?\s*["']DOCX["']/);
});
