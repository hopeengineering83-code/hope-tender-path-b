import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const paths = {
  legal: "app/api/company/legal-records/route.ts",
  financial: "app/api/company/financial-records/route.ts",
  compliance: "app/api/company/compliance-records/route.ts",
} as const;
const sources = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]),
) as Record<keyof typeof paths, string>;
const helper = readFileSync("lib/company-record-route-error.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

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

  it("preserves REVIEWER read access (except stricter financial reads) and restricted mutation access", () => {
    // Donor #1196's own privacy contract (company-documents-privacy-dto.test.ts,
    // "restricts financial record list DTOs to company knowledge managers")
    // requires financial-records reads to EXCLUDE REVIEWER — financial data is
    // deliberately stricter than legal/compliance. This test's original
    // uniform loop contradicted that; assert the split policy instead.
    for (const source of [sources.legal, sources.compliance]) {
      assert.match(source, /requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
      const mutationRoles = source.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/g) ?? [];
      assert.equal(mutationRoles.length, 2);
    }
    assert.doesNotMatch(sources.financial, /requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
    const financialManagerOnly = sources.financial.match(/requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/g) ?? [];
    assert.equal(financialManagerOnly.length, 3);
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
    assert.equal(vercel.git?.deploymentEnabled?.["main"], true);
  });
});
