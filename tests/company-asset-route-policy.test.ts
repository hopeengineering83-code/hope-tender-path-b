import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve("app/api/company/assets/route.ts"), "utf8");
const downloadRoute = readFileSync(resolve("app/api/company/assets/[id]/route.ts"), "utf8");

describe("company asset route policy", () => {
  it("requires a mutation-capable role for uploads and deletions", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("uses the persistent mutation limiter", () => {
    assert.match(route, /rateLimitPersistent/);
    assert.doesNotMatch(route, /\brateLimit\(/);
  });

  it("uses the storage adapter rather than direct Base64 persistence", () => {
    assert.match(route, /getStorageAdapter\(\)/);
    assert.match(route, /storage\.putFile/);
    assert.doesNotMatch(route, /buffer\.toString\("base64"\)/);
  });

  it("marks asset metadata responses private and non-cacheable", () => {
    assert.match(route, /Cache-Control/);
    assert.match(route, /private, no-store/);
  });

  it("revalidates stored assets before serving them", () => {
    assert.match(downloadRoute, /validateCompanyAsset/);
    assert.match(downloadRoute, /Stored asset failed security validation/);
  });

  it("serves assets with nosniff and no-store headers", () => {
    assert.match(downloadRoute, /X-Content-Type-Options/);
    assert.match(downloadRoute, /private, no-store/);
  });
});
