import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const preparationRoute = readFileSync("app/api/tenders/[id]/export/route.ts", "utf8");
const downloadRoute = readFileSync("app/api/tenders/[id]/download/route.ts", "utf8");
const persistence = readFileSync("lib/engine/export-package-persistence.ts", "utf8");

describe("export package atomic lifecycle authority", () => {
  it("keeps POST export as a non-mutating readiness preflight", () => {
    assert.match(preparationRoute, /readyToDownload:\s*true/);
    assert.match(preparationRoute, /downloadUrl/);
    assert.match(preparationRoute, /persistedPackageCreated:\s*false/);
    assert.doesNotMatch(preparationRoute, /exportPackage\.(?:create|update|updateMany)/);
    assert.doesNotMatch(preparationRoute, /status:\s*"EXPORTED"/);
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
