import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/regenerate-cvs/route.ts", "utf8");

describe("CV regeneration persistence safety", () => {
  it("uses a fast preflight but rechecks under the shared tender lock", () => {
    assert.match(source, /assertTenderReadyForGenerationAndExport\(\{/);
    assert.match(source, /withTransactionalGenerationGate\(\{/);
    assert.match(source, /purpose: "regenerate-cvs"/);
    assert.match(source, /write: async \(lockedTx\) => \{/);
  });

  it("persists GeneratedDocument rows only through the locked client", () => {
    const writeRegion = source.slice(source.indexOf("write: async (lockedTx)"));
    assert.ok(writeRegion.length > 0, "locked write callback must exist");
    assert.doesNotMatch(writeRegion, /await prisma\.generatedDocument\.(create|update|upsert)/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.findFirst/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.update/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.create/);
  });

  it("retries the entire atomic write after a P2002 winner", () => {
    assert.match(source, /const persistCv = async \(\) =>/);
    assert.match(source, /\(createErr as \{ code\?: string \}\)\?\.code === "P2002"/);
    assert.match(source, /await persistCv\(\)/);
    assert.match(source, /P2002 convergence failed: the concurrent winner was deleted/);
  });

  it("clears stale validation and approval whenever CV bytes change", () => {
    assert.match(source, /validationStatus: "PENDING"/);
    assert.match(source, /reviewStatus: "PENDING"/);
    assert.match(source, /reviewedBy: null/);
    assert.match(source, /reviewedAt: null/);
  });

  it("stops the loop when readiness changes before persistence", () => {
    assert.match(source, /err instanceof GenerationPersistenceBlockedError/);
    assert.match(source, /Generation readiness changed before persistence/);
    assert.match(source, /break;/);
  });
});
