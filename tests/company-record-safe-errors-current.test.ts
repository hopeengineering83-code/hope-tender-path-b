import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const paths = {
  legal: join(rootDir, "app/api/company/legal-records/route.ts"),
  financial: join(rootDir, "app/api/company/financial-records/route.ts"),
  compliance: join(rootDir, "app/api/company/compliance-records/route.ts"),
} as const;
const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]),
) as Record<keyof typeof paths, string>;
const helper = readFileSync(join(rootDir, "lib/company-record-route-error.ts"), "utf8");
const vercel = JSON.parse(readFileSync(join(rootDir, "vercel.json"), "utf8"));

describe("Company Vault record route error boundaries", () => {
  it("uses one stable correlated server-side error helper", () => {
    assert.match(helper, /errorClass: args\.error instanceof Error \? args\.error\.constructor\.name : "UnknownError"/);
    assert.match(helper, /requestId: args\.requestId/);
    assert.doesNotMatch(helper, /error\.message|sanitizeError/);
    for (const source of Object.values(sources)) {
      assert.match(source, /companyRecordRuntimeError/);
      assert.match(source, /extractRequestId\(req\)/);
      assert.doesNotMatch(source, /sanitizeError/);
    }
  });

  it("keeps every query and mutation company scoped", () => {
    for (const source of Object.values(sources)) {
      assert.match(source, /ensureCompanyForUser\(prisma, actor\.id\)/);
      assert.match(source, /companyId: company\.id/);
      assert.match(source, /findFirst\(\{ where: \{ id, companyId: company\.id \}/);
    }
  });

  it("preserves REVIEWER read access and restricted mutation access", () => {
    for (const source of Object.values(sources)) {
      assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
      const mutationRoles = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/g) ?? [];
      assert.equal(mutationRoles.length, 2);
    }
  });

  it("returns stable not-found and validation codes", () => {
    for (const source of Object.values(sources)) {
      assert.match(source, /RECORD_NOT_FOUND/);
      assert.match(source, /MISSING_ID/);
      assert.match(source, /INVALID_JSON/);
    }
    assert.match(sources.financial, /INVALID_FISCAL_YEAR/);
    assert.match(sources.financial, /INVALID_AMOUNT/);
  });

  it("uses domain-specific stable runtime codes", () => {
    assert.match(sources.legal, /LEGAL_RECORDS_RUNTIME_ERROR/);
    assert.match(sources.financial, /FINANCIAL_RECORDS_RUNTIME_ERROR/);
    assert.match(sources.compliance, /COMPLIANCE_RECORDS_RUNTIME_ERROR/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Date validation: invalid dates must return 400 and cause zero writes
// ─────────────────────────────────────────────────────────────────────────────

describe("company record date validation", () => {
  it("compliance-records validates expiryDate before persistence", () => {
    const src = sources.compliance;
    assert.match(src, /INVALID_DATE/);
    assert.match(src, /isNaN\(parsed\.getTime\(\)\)/);
    assert.match(src, /field: "expiryDate"/);
    assert.match(src, /status: 400/);
    assert.doesNotMatch(src, /expiryDate: body\.expiryDate \? new Date\(String\(body\.expiryDate\)\)/,
      "must validate expiryDate before persistence, not pass raw to new Date()");
  });

  it("legal-records validates issueDate and expiryDate before persistence", () => {
    const src = sources.legal;
    assert.match(src, /INVALID_DATE/);
    assert.match(src, /field: "issueDate"/);
    assert.match(src, /field: "expiryDate"/);
    assert.match(src, /isNaN\(parsed\.getTime\(\)\)/);
    assert.match(src, /status: 400/);
    assert.doesNotMatch(src, /issueDate: body\.issueDate \? new Date\(String\(body\.issueDate\)\)/,
      "must validate issueDate before persistence");
    assert.doesNotMatch(src, /expiryDate: body\.expiryDate \? new Date\(String\(body\.expiryDate\)\)/,
      "must validate expiryDate before persistence");
  });

  it("financial-records rejects NaN, Infinity, and non-finite amounts", () => {
    const src = sources.financial;
    assert.match(src, /Number\.isFinite/);
    assert.match(src, /INVALID_AMOUNT/);
  });
});
