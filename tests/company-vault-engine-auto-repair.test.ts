import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("components/engine-action-panel.tsx", "utf8");
const routePage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const verificationPage = readFileSync("components/company-vault-verification-page.tsx", "utf8");
const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

test("blocked Engine exposes an explicit Vault recovery action without becoming the normal workflow owner", () => {
  assert.match(engine, /async function repairVaultAndRetry\(\)/);
  assert.match(engine, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(engine, /Repair Vault & Retry Safe Mode/);
  assert.match(engine, /extraParams: \{ safe: "true", skipAiRematch: "true" \}/);
  assert.match(engine, /href="\/dashboard\/company"/);
  assert.match(engine, /Open Automatic Verification/);
});

test("Engine recovery copy requests automatic source verification, not approval", () => {
  assert.match(engine, /verify source-backed records/);
  assert.match(engine, /requires automatic source verification/);
  assert.doesNotMatch(engine, /auto-approve all records|evidence matching still requires review|Review eligible evidence/i);
});

test("Automatic Verification reprocesses stored source bytes before rebuilding records", () => {
  assert.match(routePage, /company-vault-verification-page/);
  assert.match(verificationPage, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  assert.match(verificationPage, /Reprocess and verify/);
  assert.doesNotMatch(verificationPage, /Upload stronger source files/);
  assert.doesNotMatch(verificationPage, /fetch\("\/api\/company\/knowledge\/repair", \{ method: "POST" \}\)/);
});

test("automatic repair produces SOURCE_VERIFIED, never fabricated human REVIEWED", () => {
  assert.match(ingestion, /autoVerifyCompanyKnowledge\(companyId\)/);
  assert.match(verification, /buildSourceVerificationProvenance/);
  assert.match(verification, /trustLevel: "SOURCE_VERIFIED"/);
  assert.match(verification, /reviewedBy: null/);
  assert.match(verification, /reviewedAt: null/);
  assert.doesNotMatch(verification, /data:\s*\{[^}]*trustLevel: "REVIEWED"/s);
});
