import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/company/documents/route.ts", "utf8");
const page = readFileSync("app/dashboard/company/page.tsx", "utf8");
const assetsRoute = readFileSync("app/api/company/assets/route.ts", "utf8");
const expertsRoute = readFileSync("app/api/company/experts/route.ts", "utf8");
const projectsRoute = readFileSync("app/api/company/projects/route.ts", "utf8");
const reviewPage = readFileSync("app/dashboard/company/review/page.tsx", "utf8");

describe("company documents public DTO privacy", () => {

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
