import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlanBFileName } from "../lib/plan-b-vault-finalize";

const read = (path: string) => readFileSync(path, "utf8");

describe("Plan B Company Vault contract", () => {
  it("normalizes source filenames safely for tenant-owned document fallback", () => {
    assert.equal(normalizePlanBFileName(" C:\\Uploads\\EXPERT CVs.PDF "), "expert cvs.pdf");
    assert.equal(normalizePlanBFileName("/tmp/Project References.PDF"), "project references.pdf");
    assert.equal(normalizePlanBFileName("Ｐｒｏｆｉｌｅ．ＰＤＦ"), "profile.pdf");
  });

  it("stages sourceDocuments without creating fake CompanyDocument rows", () => {
    const route = read("app/api/company/plan-b-import/route.ts");
    assert.match(route, /tx\.planBStaging\.create/);
    assert.match(route, /tx\.planBStaging\.update/);
    assert.doesNotMatch(route, /tx\.companyDocument\.create\s*\(/);
    assert.match(route, /CompanyDocument is for official uploaded files only/);
  });

  it("links only tenant VERIFIED documents using hash before normalized filename", () => {
    const finalize = read("lib/plan-b-vault-finalize.ts");
    const hashLookup = finalize.indexOf("byHash.get(hash)");
    const fileLookup = finalize.indexOf("byFileName.get(fileName)");
    assert.ok(hashLookup >= 0 && fileLookup > hashLookup, "SHA-256 lookup must precede filename fallback");
    assert.match(finalize, /companyId: input\.companyId/);
    assert.match(finalize, /integrityStatus: "VERIFIED"/);
    assert.match(finalize, /data\.sourceDocumentId = doc\.id/);
    assert.match(finalize, /data\.trustLevel = "SOURCE_VERIFIED"/);
  });

  it("restores matched soft-deleted rows and re-reads active Vault counts", () => {
    const finalize = read("lib/plan-b-vault-finalize.ts");
    assert.match(finalize, /data\.deletedAt = null/);
    assert.match(finalize, /data\.deletedBy = null/);
    assert.match(finalize, /data\.isActive = true/);
    assert.match(finalize, /prisma\.expert\.count\(\{ where: \{ companyId: input\.companyId, deletedAt: null, isActive: true \} \}\)/);
    assert.match(finalize, /prisma\.project\.count\(\{ where: \{ companyId: input\.companyId, deletedAt: null \} \}\)/);
  });

  it("uses one deduplicated company-level missing-source blocker", () => {
    const finalize = read("lib/plan-b-vault-finalize.ts");
    const page = read("app/dashboard/company/plan-b-import/page.tsx");
    assert.match(finalize, /const missingSources = new Map<string, string>\(\)/);
    assert.match(finalize, /sourceBlocker: missingSources\.size > 0/);
    assert.match(page, /Company source blocker/);
    assert.match(page, /visibleWarnings/);
    assert.match(page, /could not be source-verified.*upload the source document/i);
  });

  it("keeps Company Vault upload on the canonical upload and auto-ingest path", () => {
    const companyPage = read("app/dashboard/company/page.tsx");
    assert.match(companyPage, /fetch\("\/api\/upload", \{ method:"POST", body:fd \}\)/);
    assert.match(companyPage, /setUploadQueue\(q => q\.map\(x => x\.file===item\.file \? \{ \.\.\.x, status:"done" \}/);
    assert.match(companyPage, /await loadDocs\(\)/);
    assert.match(companyPage, /void startQueuedVaultIngestion\(\)/);
    assert.match(companyPage, /PDF · DOCX · XLSX · CSV · TXT · Up to 10 MB/);
  });
});
