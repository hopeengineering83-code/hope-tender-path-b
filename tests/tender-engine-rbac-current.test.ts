import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("tender Engine mutation RBAC", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");
  const panel = read("components/engine-action-panel.tsx");

  it("permits only ADMIN and PROPOSAL_MANAGER at the server boundary", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
    assert.match(route, /forbiddenResponse\(\)/);
    assert.match(route, /unauthorizedResponse\(\)/);
  });

  it("keeps every tender lookup tenant scoped", () => {
    assert.match(route, /const userId = actor\.id/);
    assert.match(route, /prisma\.tender\.findFirst/);
    assert.match(route, /where: \{ id, userId \}/);
    assert.match(route, /TENDER_NOT_FOUND/);
    assert.doesNotMatch(route, /findUnique\(\{\s*where: \{ id \}/);
  });

  it("binds the persisted job to the authenticated tenant", () => {
    assert.match(route, /enqueueEngineJobForCurrentSources\(prisma, \{/);
    assert.match(route, /tenderId: id/);
    assert.match(route, /userId,/);
    assert.match(route, /companyId: vaultPreflight\.companyId/);
  });

  it("blocks read-only UI mutations before a request is sent", () => {
    assert.match(panel, /if \(!canMutate\)/);
    assert.match(panel, /ENGINE_MUTATION_BLOCKED_RESULT/);
    assert.match(panel, /ROLE_READ_ONLY_MUTATION_BLOCKED/);
    assert.match(panel, /Engine runs require the ADMIN or PROPOSAL_MANAGER role/);
  });

  it("does not accept role or policy overrides from the client", () => {
    assert.match(route, /CLIENT_POLICY_OVERRIDE_REJECTED/);
    assert.doesNotMatch(route, /searchParams\.get\("role"\)/);
    assert.doesNotMatch(route, /searchParams\.get\("userId"\)/);
  });
});
