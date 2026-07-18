import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/company/documents/route.ts", "utf8");
const page = readFileSync("app/dashboard/company/page.tsx", "utf8");
const assetsRoute = readFileSync("app/api/company/assets/route.ts", "utf8");
const expertsRoute = readFileSync("app/api/company/experts/route.ts", "utf8");
const expertDetailRoute = readFileSync("app/api/company/experts/[id]/route.ts", "utf8");
const projectsRoute = readFileSync("app/api/company/projects/route.ts", "utf8");
const projectDetailRoute = readFileSync("app/api/company/projects/[id]/route.ts", "utf8");
const reviewPage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");
const reviewBoardPage = readFileSync("app/dashboard/company/review-board/page.tsx", "utf8");
const financialRecordsRoute = readFileSync("app/api/company/financial-records/route.ts", "utf8");
const complianceRecordsRoute = readFileSync("app/api/company/compliance-records/route.ts", "utf8");
const legalRecordsRoute = readFileSync("app/api/company/legal-records/route.ts", "utf8");

describe("company documents public DTO privacy", () => {


  it("uses bounded fail-safe pagination and deterministic ordering for vault list DTOs", () => {
    for (const source of [route, expertsRoute, projectsRoute]) {
      assert.match(source, /const DEFAULT_PAGE_SIZE = 50/);
      assert.match(source, /const MAX_PAGE_SIZE = 100/);
      assert.match(source, /function parseBoundedLimit\(value: string \| null\): number/);
      assert.match(source, /if \(!Number\.isFinite\(parsed\) \|\| parsed <= 0\) return DEFAULT_PAGE_SIZE/);
      assert.match(source, /return Math\.min\(parsed, MAX_PAGE_SIZE\)/);
      assert.match(source, /const limit = parseBoundedLimit\(searchParams\.get\("limit"\)\)/);
    }
    assert.match(route, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(expertsRoute, /orderBy: \[\{ trustLevel: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(projectsRoute, /orderBy: \[\{ trustLevel: "asc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
  });


  it("restricts raw expert and project detail DTOs to company knowledge managers", () => {
    for (const source of [expertDetailRoute, projectDetailRoute]) {
      assert.match(source, /try \{ actor = await requireRole\("ADMIN", "PROPOSAL_MANAGER"\); \}/);
      assert.doesNotMatch(source, /const userId = await getSession\(\)/);
      assert.match(source, /where: \{ userId: actor\.id \}/);
      assert.match(source, /companyId: company\.id/);
      assert.match(source, /deletedAt: null/);
    }
  });


  it("restricts financial record list DTOs to company knowledge managers", () => {
    assert.match(financialRecordsRoute, /try \{ actor = await requireRole\("ADMIN", "PROPOSAL_MANAGER"\); \}/);
    assert.doesNotMatch(financialRecordsRoute, /requireRole\("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"\)/);
    assert.match(financialRecordsRoute, /const where = \{ companyId: company\.id \}/);
    assert.match(financialRecordsRoute, /currency: body\.currency \? str\(body\.currency, 10\) : null/);
  });

  it("paginates financial record list DTOs with deterministic ordering", () => {
    assert.match(financialRecordsRoute, /const DEFAULT_PAGE_SIZE = 50/);
    assert.match(financialRecordsRoute, /const MAX_PAGE_SIZE = 100/);
    assert.match(financialRecordsRoute, /function parseLimit\(value: string \| null\): number/);
    assert.match(financialRecordsRoute, /orderBy: \[\{ fiscalYear: "desc" \}, \{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
    assert.match(financialRecordsRoute, /skip: \(page - 1\) \* limit/);
    assert.match(financialRecordsRoute, /take: limit/);
    assert.match(financialRecordsRoute, /hasMore: page \* limit < total/);
    assert.match(page, /fetch\("\/api\/company\/financial-records\?limit=50"\)/);
  });


  it("paginates compliance and legal record list DTOs with deterministic ordering", () => {
    for (const source of [complianceRecordsRoute, legalRecordsRoute]) {
      assert.match(source, /const DEFAULT_PAGE_SIZE = 50/);
      assert.match(source, /const MAX_PAGE_SIZE = 100/);
      assert.match(source, /function parseLimit\(value: string \| null\): number/);
      assert.match(source, /const where = \{ companyId: company\.id \}/);
      assert.match(source, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "desc" \}\]/);
      assert.match(source, /skip: \(page - 1\) \* limit/);
      assert.match(source, /take: limit/);
      assert.match(source, /hasMore: page \* limit < total/);
    }
    assert.match(page, /fetch\("\/api\/company\/compliance-records\?limit=50"\)/);
    assert.match(page, /fetch\("\/api\/company\/legal-records\?limit=50"\)/);
  });

  it("minimizes Company Review expert and project list DTOs", () => {
    assert.match(expertsRoute, /select: \{ id: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, trustLevel: true, createdAt: true \}/);
    assert.doesNotMatch(expertsRoute, /select: \{[^}]*email: true/);
    assert.doesNotMatch(expertsRoute, /select: \{[^}]*phone: true/);
    assert.doesNotMatch(expertsRoute, /select: \{[^}]*profile: true/);
    assert.match(projectsRoute, /select: \{ id: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, trustLevel: true, createdAt: true \}/);
    assert.doesNotMatch(projectsRoute, /select: \{[^}]*contractValue: true/);
    assert.doesNotMatch(projectsRoute, /select: \{[^}]*currency: true/);
    assert.doesNotMatch(projectsRoute, /select: \{[^}]*summary: true/);
  });


  it("Knowledge Review Board uses bounded list DTOs and avoids raw source text", () => {
    assert.doesNotMatch(reviewBoardPage, /fetch\("\/api\/company"/);
    assert.match(reviewBoardPage, /fetch\("\/api\/company\/review-summary"/);
    assert.match(reviewBoardPage, /fetch\("\/api\/company\/experts\?limit=50"/);
    assert.match(reviewBoardPage, /fetch\("\/api\/company\/projects\?limit=50"/);
    assert.match(reviewBoardPage, /type Paginated<T> = \{ items\?: T\[\] \} \| T\[\]/);
    assert.match(reviewBoardPage, /function reviewEvidenceHint\(kind: "expert" \| "project"\)/);
    assert.doesNotMatch(reviewBoardPage, /profile\?: string \| null/);
    assert.doesNotMatch(reviewBoardPage, /summary\?: string \| null/);
    assert.doesNotMatch(reviewBoardPage, /snippet\(/);
  });

  it("Company Review uses bounded list DTOs instead of the full company graph", () => {
    assert.doesNotMatch(reviewPage, /fetch\("\/api\/company"/);
    assert.match(reviewPage, /fetch\("\/api\/company\/review-summary"/);
    assert.match(reviewPage, /fetch\("\/api\/company\/documents\?limit=50"/);
    assert.match(reviewPage, /fetch\("\/api\/company\/experts\?limit=50"/);
    assert.match(reviewPage, /fetch\("\/api\/company\/projects\?limit=50"/);
    assert.match(reviewPage, /type Paginated<T> = \{ items\?: T\[\]/);
  });

  it("keeps storage paths server-side while exposing only storage booleans", () => {
    assert.match(route, /select: \{[\s\S]*storagePath: true[\s\S]*\}/);
    assert.match(route, /const \{ storagePath: privateStoragePath, \.\.\.publicDoc \} = doc/);
    assert.match(route, /\.\.\.publicDoc/);
    assert.match(route, /hasPrivateStorage: Boolean\(privateStoragePath\?\.trim\(\)\)/);
    assert.doesNotMatch(route, /return NextResponse\.json\(\{ items: itemsWithLength[\s\S]*storagePath/);
  });

  it("does not type or render raw document or asset storagePath in the Company Vault client", () => {
    assert.doesNotMatch(page, /storagePath\?: string \| null/);
    assert.doesNotMatch(page, /doc\.storagePath/);
    assert.doesNotMatch(page, /asset\.storagePath/);
    assert.match(page, /hasPrivateStorage\?: boolean \| null/);
    assert.match(page, /doc\.hasInlineFileContent && !doc\.hasPrivateStorage/);
  });

  it("keeps asset storage paths server-side while exposing only storage booleans", () => {
    assert.match(assetsRoute, /select: \{[\s\S]*storagePath: true[\s\S]*\}/);
    assert.match(assetsRoute, /const \{ storagePath: privateStoragePath, \.\.\.publicAsset \} = asset/);
    assert.match(assetsRoute, /hasPrivateStorage: Boolean\(privateStoragePath\?\.trim\(\)\)/);
    assert.doesNotMatch(assetsRoute, /privateJson\(\{ assets: assets\.map\(\(asset\) => \(\{[\s\S]*\.\.\.asset/);
  });

  it("continues to return bounded document presentation fields and extraction counts", () => {
    assert.match(route, /id: true, fileName: true, originalFileName: true, mimeType: true/);
    assert.match(route, /size: true, category: true, createdAt: true/);
    assert.match(route, /extractedTextLength: lengthById\[doc\.id\] \?\? 0/);
    assert.match(route, /hasInlineFileContent: \(fileContentLengthById\[doc\.id\] \?\? 0\) > 0/);
    assert.doesNotMatch(route, /extractedText: true/);
    assert.doesNotMatch(route, /fileContent: true/);
  });
});
