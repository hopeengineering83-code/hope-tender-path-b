import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const auditRoute = readFileSync("app/api/audit/route.ts", "utf8");
const tenderRoute = readFileSync("app/api/tenders/[id]/route.ts", "utf8");

describe("tender storage cleanup manifest visibility", () => {
  it("excludes internal cleanup queue rows from the public audit API", () => {
    assert.match(auditRoute, /INTERNAL_AUDIT_ENTITY_TYPE = "TenderStorageCleanup"/);
    assert.match(auditRoute, /NOT: \{ entityType: INTERNAL_AUDIT_ENTITY_TYPE \}/);
    assert.match(auditRoute, /auditLog\.count\(\{ where \}\)/);
  });

  it("excludes internal cleanup rows from dashboard activity feeds", () => {
    const dashboard = readFileSync("app/dashboard/page.tsx", "utf8");
    const analytics = readFileSync("app/dashboard/analytics/page.tsx", "utf8");
    assert.match(dashboard, /NOT: \{ entityType: "TenderStorageCleanup" \}/);
    assert.match(analytics, /NOT: \{ entityType: "TenderStorageCleanup" \}/);
  });

  it("never returns raw storage paths or internal task IDs from tender deletion", () => {
    assert.match(tenderRoute, /storageCleanupPending/);
    assert.doesNotMatch(tenderRoute, /storageCleanupTaskId\s*[,}]/);
    assert.doesNotMatch(tenderRoute, /storagePath\s*:/);
  });
});
