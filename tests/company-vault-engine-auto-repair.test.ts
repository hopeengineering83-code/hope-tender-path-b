import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const engine = readFileSync("components/engine-action-panel.tsx", "utf8");
const routePage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const verificationPage = readFileSync("components/company-vault-verification-page.tsx", "utf8");
const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

test("Engine panel has repair function and text-based status (Gap 2: buttons removed)", () => {
  assert.match(engine, /async function repairVaultAndRetry\(\)/);
  assert.match(engine, /fetch\("\/api\/company\/reimport", \{ method: "POST" \}\)/);
  // Gap 2: "Repair source evidence" button text removed from normal path.
  // The function still exists for automatic/diagnostic use.
  assert.match(engine, /Processing automatically/);
  assert.doesNotMatch(engine, /safe: "true"|skipAiRematch|Run Safe Mode|Full AI/);
});

test("Engine recovery copy requests automatic source verification, not approval", () => {
  assert.match(engine, /re-extracting stored source bytes and rebuilding provenance-bound records/);
  assert.match(engine, /Current source-verified inventory/);
  assert.match(engine, /Eligible Company Vault evidence is verified, queued, matched, selected/);
  assert.doesNotMatch(engine, /approve|human confirmation|Review eligible evidence/i);
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
