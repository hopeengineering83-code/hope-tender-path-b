// Defect 6: source-contract test for the exact-head Preview e2e spec.
//
// The e2e spec at e2e/vault-plan-b-tender-refresh.spec.ts exercises the full
// Vault upload → Plan B import → tender upload → refresh flow against a real
// deployment (local `next start` or a Vercel preview). Running it requires
// E2E_GOLDEN_AUTH=true and a seeded isolated E2E account.
//
// This source-contract test verifies the spec exists and asserts each piece
// of the flow is present, so a refactor that drops one of the steps is
// caught even when the e2e suite is not run.
//
// To run the actual e2e spec against a Vercel preview:
//   PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
//   E2E_GOLDEN_AUTH=true \
//   E2E_TEST_EMAIL=... \
//   E2E_TEST_PASSWORD=... \
//   npx playwright test vault-plan-b-tender-refresh

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const spec = readFileSync("e2e/vault-plan-b-tender-refresh.spec.ts", "utf8");
const config = readFileSync("playwright.config.ts", "utf8");

describe("Defect 6 — exact-head Preview e2e spec exists and covers the full flow", () => {
  it("e2e/vault-plan-b-tender-refresh.spec.ts exists", () => {
    assert.ok(spec.length > 0);
  });

  it("playwright.config.ts includes the spec in DESKTOP_AUTHENTICATED_SPECS", () => {
    assert.match(config, /"vault-plan-b-tender-refresh\.spec\.ts"/);
  });

  it("spec is gated on E2E_GOLDEN_AUTH=true (does not run unconditionally)", () => {
    assert.match(spec, /test\.skip\(!FULL/);
    assert.match(spec, /E2E_GOLDEN_AUTH/);
  });

  it("spec uploads a real PDF to the Company Vault via POST /api/upload", () => {
    assert.match(spec, /page\.request\.post\("\/api\/upload"/);
    assert.match(spec, /companyDoc.*true/);
    assert.match(spec, /application\/pdf/);
  });

  it("spec captures the official contentSha256, contentByteLength, mimeType, fileName immediately after upload", () => {
    assert.match(spec, /officialHash/);
    assert.match(spec, /officialByteLength/);
    assert.match(spec, /officialMime/);
    assert.match(spec, /officialFileName/);
  });

  it("spec computes the SHA-256 of the uploaded bytes (so it can declare them in the Plan B payload)", () => {
    assert.match(spec, /crypto\.subtle\.digest\("SHA-256"/);
  });

  it("spec POSTs a Plan B payload that references the uploaded PDF by fileName AND sha256", () => {
    assert.match(spec, /page\.request\.post\("\/api\/company\/plan-b-import"/);
    assert.match(spec, /sourceDocument:\s*vaultFileName/);
    assert.match(spec, /sourceSha256:\s*pdfSha256/);
  });

  it("spec asserts documents.created === 0 (Plan B did not create a synthetic JSON artifact)", () => {
    assert.match(spec, /planBJson\.documents\.created/);
    assert.match(spec, /\.toBe\(0\)/);
  });

  it("spec asserts evidenceDowngraded === 0 (expert's fields were source-verified against the official bytes)", () => {
    assert.match(spec, /planBJson\.evidenceDowngraded/);
    assert.match(spec, /\.toBe\(0\)/);
  });

  it("spec re-fetches the Company Vault document list and asserts the official row is UNCHANGED", () => {
    assert.match(spec, /page\.request\.get\("\/api\/company\/documents"\)/);
    assert.match(spec, /ourDoc/);
    // Byte-bearing fields must match the post-upload values.
    assert.match(spec, /ourDoc.*\.contentSha256.*\.toBe\(officialHash\)/s);
    assert.match(spec, /ourDoc.*\.contentByteLength.*\.toBe\(officialByteLength\)/s);
    assert.match(spec, /ourDoc.*\.mimeType.*\.toBe\("application\/pdf"\)/s);
    assert.match(spec, /ourDoc.*\.integrityStatus.*\.toBe\("VERIFIED"\)/s);
  });

  it("spec uploads a tender via POST /api/tenders/upload-first", () => {
    assert.match(spec, /page\.request\.post\("\/api\/tenders\/upload-first"/);
  });

  it("spec waits for durable tender extraction", () => {
    assert.match(spec, /waitForDurableTenderExtraction/);
  });

  it("spec refreshes by calling generation-readiness and knowledge/repair", () => {
    assert.match(spec, /\/api\/tenders\/\$\{tenderId\}\/generation-readiness/);
    assert.match(spec, /\/api\/company\/knowledge\/repair/);
  });

  it("spec re-verifies the official Vault row is STILL UNCHANGED after tender upload + refresh", () => {
    // The second verification uses ourDoc2 and re-asserts the same fields.
    assert.match(spec, /ourDoc2/);
    assert.match(spec, /ourDoc2.*\.contentSha256.*\.toBe\(officialHash\)/s);
    assert.match(spec, /ourDoc2.*\.integrityStatus.*\.toBe\("VERIFIED"\)/s);
  });

  it("spec checks for horizontal overflow on /dashboard/tenders/[id] and /dashboard/company", () => {
    assert.match(spec, /dashboard\/tenders\/\$\{tenderId\}/);
    assert.match(spec, /dashboard\/company/);
    assert.match(spec, /scrollWidth.*clientWidth/);
  });

  it("spec cleans up the tender and the Company Vault document in finally blocks", () => {
    assert.match(spec, /page\.request\.delete\(`\/api\/tenders\/\$\{tenderId\}`\)/);
    assert.match(spec, /page\.request\.delete\(`\/api\/company\/documents\/\$\{vaultDocId\}`\)/);
  });

  it("spec sets a generous timeout (at least 120s) for the full flow", () => {
    // 180_000 = 180000 (with underscore separator). Allow digits + underscores.
    assert.match(spec, /test\.setTimeout\(\s*\d[\d_]*\s*\)/);
  });
});
