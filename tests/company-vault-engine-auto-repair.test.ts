import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const verificationPage = readFileSync("components/company-vault-verification-page.tsx", "utf8");
const ingestion = readFileSync("lib/company-vault-ingestion.ts", "utf8");
const verification = readFileSync("lib/company-auto-verification.ts", "utf8");

// The two Engine-panel cases here were removed with
// components/engine-action-panel.tsx. They asserted copy inside a panel that
// could not render its own state. The Vault guarantees below are unaffected
// and are the reason this file still exists.

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
