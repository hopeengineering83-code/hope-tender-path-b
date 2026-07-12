import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("app/api/tenders/[id]/regenerate-cvs/route.ts", "utf8");

describe("regenerate-cvs transactional persistence safety", () => {
  it("rechecks the canonical gate inside the write transaction", () => {
    assert.match(source, /prisma\.\$transaction\(async \(tx\) => \{/);
    assert.match(source, /withTransactionalGenerationGate\(\{/);
    assert.match(source, /purpose: "regenerate-cvs"/);
    assert.match(source, /write: async \(lockedTx\) => \{/);
  });

  it("does not persist GeneratedDocument rows through the root client", () => {
    const writeRegion = source.slice(source.indexOf("write: async (lockedTx)"));
    assert.ok(writeRegion.length > 0, "locked write callback must exist");
    assert.doesNotMatch(writeRegion, /await prisma\.generatedDocument\.(create|update|upsert)/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.findFirst/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.update/);
    assert.match(writeRegion, /lockedTx\.generatedDocument\.create/);
  });

  it("resets review approval when CV bytes are regenerated", () => {
    assert.match(source, /validationStatus: "PENDING"/);
    assert.match(source, /reviewStatus: "PENDING"/);
    assert.match(source, /reviewedBy: null/);
    assert.match(source, /reviewedAt: null/);
  });

  it("stops further persistence when readiness changes", () => {
    assert.match(source, /err instanceof GenerationPersistenceBlockedError/);
    assert.match(source, /Generation readiness changed before persistence/);
    assert.match(source, /break;/);
  });
});
