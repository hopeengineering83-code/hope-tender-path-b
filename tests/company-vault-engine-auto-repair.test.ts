import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("components/engine-action-panel.tsx", "utf8");
const review = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const importer = readFileSync("lib/company-knowledge-import-safe.ts", "utf8");

test("blocked Engine can repair Company Vault and retry Safe Mode automatically", () => {
  assert.match(engine, /async function repairVaultAndRetry\(\)/);
  assert.match(engine, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(engine, /Repair Vault & Retry Safe Mode/);
  assert.match(engine, /extraParams: \{ safe: "true", skipAiRematch: "true" \}/);
  assert.match(engine, /href="\/dashboard\/company"/);
});

test("Knowledge Review repairs source extraction before rebuilding records", () => {
  assert.match(review, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(review, /Repair Vault Sources/);
  assert.match(review, /Upload source files in Company Vault/);
  assert.doesNotMatch(review, /fetch\("\/api\/company\/knowledge\/repair", \{ method: "POST" \}\)/);
});

test("automatic repair does not auto-promote records to REVIEWED", () => {
  assert.match(importer, /Records are NEVER promoted to REVIEWED automatically/);
  assert.match(importer, /A human must review/);
});
