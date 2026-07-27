import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("components/engine-action-panel.tsx", "utf8");
const review = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

test("blocked Engine exposes an explicit Vault recovery action without becoming the normal workflow owner", () => {
  assert.match(engine, /async function repairVaultAndRetry\(\)/);
  assert.match(engine, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(engine, /Repair Vault & Retry Safe Mode/);
  assert.match(engine, /extraParams: \{ safe: "true", skipAiRematch: "true" \}/);
  assert.match(engine, /href="\/dashboard\/company"/);
});

test("Review Inbox reprocesses stored source bytes before rebuilding records", () => {
  assert.match(review, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(review, /Reprocess sources/);
  assert.match(review, /Upload stronger source files/);
  assert.doesNotMatch(review, /fetch\("\/api\/company\/knowledge\/repair", \{ method: "POST" \}\)/);
});

test("automatic repair produces auto-REVIEWED with SYSTEM_AUTO_VERIFIED, never fabricated human REVIEWED", () => {
  assert.match(ingestion, /autoVerifyCompanyKnowledge\(companyId\)/);
  // The App auto-verifies against source bytes AND auto-approves to REVIEWED
  // using buildReviewProvenance (not buildSourceVerificationProvenance).
  assert.match(verification, /buildReviewProvenance/);
  assert.match(verification, /trustLevel: "REVIEWED"/);
  assert.match(verification, /reviewedBy: "SYSTEM_AUTO_VERIFIED"/);
  assert.match(verification, /reviewerId: "SYSTEM_AUTO_VERIFIED"/);
});
