import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoute = readFileSync(resolve("app/api/tenders/[id]/share/route.ts"), "utf8");
const sharePage = readFileSync(resolve("app/share/[token]/page.tsx"), "utf8");

describe("tender share API policy", () => {
  it("limits sharing to mutation-capable roles", () => {
    assert.match(apiRoute, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("uses persistent mutation limiting", () => {
    assert.match(apiRoute, /rateLimitPersistent/);
  });

  it("creates explicit random bearer tokens (hashed before storage)", () => {
    // Audit C-4: the route must use generateTenderShareToken() which returns
    // both a raw token and its SHA-256 hash. The raw token is returned to the
    // caller ONCE; only the hash is persisted. The token column is set to null.
    assert.match(apiRoute, /generateTenderShareToken\(\)/, "must use generateTenderShareToken");
    assert.match(apiRoute, /tokenHash/, "must store the hash");
    assert.match(apiRoute, /token:\s*null/, "must NOT store the plaintext token");
  });

  it("revokes links instead of deleting the audit record", () => {
    assert.match(apiRoute, /revokedAt: new Date\(\)/);
    assert.doesNotMatch(apiRoute, /tenderShare\.delete/);
  });

  it("marks owner share-management responses private and non-cacheable", () => {
    assert.match(apiRoute, /private, no-store/);
  });
});

describe("public share access policy", () => {
  it("forces dynamic non-cached rendering", () => {
    assert.match(sharePage, /dynamic = "force-dynamic"/);
    assert.match(sharePage, /revalidate = 0/);
    assert.match(sharePage, /noStore\(\)/);
  });

  it("claims access atomically with expiry, revocation, and limit checks", () => {
    assert.match(sharePage, /UPDATE "TenderShare"/);
    assert.match(sharePage, /"downloadCount" = "downloadCount" \+ 1/);
    assert.match(sharePage, /"revokedAt" IS NULL/);
    assert.match(sharePage, /"expiresAt" IS NULL OR "expiresAt" > NOW\(\)/);
    assert.match(sharePage, /"downloadCount" < "maxDownloads"/);
    assert.match(sharePage, /RETURNING "id"/);
  });

  it("rejects malformed tokens before querying the database", () => {
    assert.match(sharePage, /isValidTenderShareToken\(token\)/);
  });
});
