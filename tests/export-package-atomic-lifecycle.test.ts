import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const preparationRoute = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
const downloadRoute = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
const persistence = readFileSync("lib/engine/export-package-persistence.ts", "utf8");

describe("export package atomic lifecycle authority", () => {
  it("keeps the legacy export-preparation state transition atomic", () => {
    const start = preparationRoute.indexOf("const exportPackage = await prisma.$transaction");
    const end = preparationRoute.indexOf("await logAction", start);
    assert.ok(start >= 0 && end > start, "export preparation transaction must exist before the audit event");
    const transaction = preparationRoute.slice(start, end);
    assert.match(transaction, /tx\.exportPackage\.updateMany/);
    assert.match(transaction, /tx\.exportPackage\.create/);
    assert.match(transaction, /tx\.tender\.update/);
    assert.match(transaction, /where:\s*\{\s*id,\s*userId\s*\}/);
    assert.equal((transaction.match(/prisma\.\$transaction/g) ?? []).length, 1);
  });

  it("routes the live Final ZIP download through the executable atomic persistence service", () => {
    assert.match(downloadRoute, /persistVerifiedExportPackageDownload/);
    assert.doesNotMatch(downloadRoute, /const freshPkg = await prisma\.exportPackage\.findFirst/);
    assert.doesNotMatch(downloadRoute, /prisma\.exportPackage\.(?:create|update)\(/);
    assert.match(downloadRoute, /packageSha256:\s*assembledZip\.packageSha256/);
    assert.match(downloadRoute, /manifestJson:\s*JSON\.stringify\(assembledZip\.manifest\)/);
  });

  it("locks the owned tender and commits package state with EXPORTED lifecycle state", () => {
    assert.match(persistence, /FOR UPDATE/);
    assert.match(persistence, /WHERE "id" = \$\{input\.tenderId\} AND "userId" = \$\{input\.userId\}/);
    assert.match(persistence, /tx\.exportPackage\.findFirst/);
    assert.match(persistence, /tx\.exportPackage\.create/);
    assert.match(persistence, /tx\.tender\.update/);
    assert.match(persistence, /status:\s*"EXPORTED",\s*stage:\s*"EXPORT"/);
  });
});
