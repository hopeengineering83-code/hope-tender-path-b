import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/admin/repair/route.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

describe("admin repair migration-only schema policy", () => {
  it("contains no request-time DDL or unsafe raw SQL execution", () => {
    assert.doesNotMatch(source, /\$executeRawUnsafe/);
    assert.doesNotMatch(source, /\$queryRawUnsafe/);
    assert.doesNotMatch(source, /ALTER\s+TABLE/i);
    assert.doesNotMatch(source, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    assert.doesNotMatch(source, /DROP\s+(?:TABLE|INDEX|TRIGGER|FUNCTION)/i);
  });

  it("retires schema-drift before database readiness or mutation", () => {
    const disabledPos = source.indexOf('requestedStep === "schema-drift"');
    const prismaReadyPos = source.indexOf("await prismaReady");
    assert.ok(disabledPos >= 0, "schema-drift must be explicitly rejected");
    assert.ok(prismaReadyPos > disabledPos, "retired schema action must return before database work");
    assert.match(source, /RUNTIME_SCHEMA_REPAIR_DISABLED/);
    assert.match(source, /reviewed Prisma migration through the deployment pipeline/);
    assert.match(source, /status: 410/);
  });

  it("returns a stable correlated runtime error without exception text", () => {
    const catchStart = source.lastIndexOf("  } catch (error) {");
    const catchRegion = source.slice(catchStart);
    assert.match(catchRegion, /ADMIN_REPAIR_RUNTIME_ERROR/);
    assert.match(catchRegion, /requestId/);
    assert.match(catchRegion, /errorClass: error instanceof Error \? error\.constructor\.name : "UnknownError"/);
    assert.doesNotMatch(catchRegion, /error\.message/);
    assert.doesNotMatch(catchRegion, /String\(error\)/);
    assert.doesNotMatch(catchRegion, /detail:/);
  });

  it("preserves the supported data-repair operations", () => {
    for (const step of [
      "all",
      "extract",
      "import",
      "labels",
      "requirements",
      "appsettings",
      "prune-superseded",
    ]) {
      assert.match(source, new RegExp(`"${step}"`));
    }
    assert.match(source, /importCompanyKnowledgeFromDocuments/);
    assert.match(source, /cleanTenderTitle/);
    assert.match(source, /tenderRequirement\.updateMany/);
    assert.match(source, /appSettings\.upsert/);
    assert.match(source, /generatedDocument\.deleteMany/);
  });

  it("keeps ADMIN-only authorization and rate limiting", () => {
    assert.match(source, /requireRole\("ADMIN"\)/);
    assert.match(source, /rateLimit\(`admin-repair:\$\{actor\.id\}`/);
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    assert.equal(vercel.git?.deploymentEnabled, true);
  });
});
