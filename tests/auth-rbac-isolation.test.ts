import { test, describe } from "node:test";
import assert from "node:assert";

describe("RBAC and Tenant Isolation Logic", () => {
  const ROLES = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"] as const;
  type Role = (typeof ROLES)[number];

  function canDeleteTender(role: Role, isOwner: boolean): boolean {
    if (role === "ADMIN") return true;
    if (role === "PROPOSAL_MANAGER" && isOwner) return true;
    return false;
  }

  function canReadTender(role: Role, isOwner: boolean, inSameCompany: boolean): boolean {
    if (role === "ADMIN") return true;
    if (inSameCompany) return true;
    return false;
  }

  test("Only ADMIN or PROPOSAL_MANAGER (Owner) can delete tender", () => {
    assert.strictEqual(canDeleteTender("ADMIN", false), true);
    assert.strictEqual(canDeleteTender("PROPOSAL_MANAGER", true), true);
    assert.strictEqual(canDeleteTender("PROPOSAL_MANAGER", false), false);
    assert.strictEqual(canDeleteTender("REVIEWER", true), false);
    assert.strictEqual(canDeleteTender("VIEWER", true), false);
  });

  test("Cannot read tender from another company", () => {
    assert.strictEqual(canReadTender("PROPOSAL_MANAGER", false, true), true);
    assert.strictEqual(canReadTender("PROPOSAL_MANAGER", false, false), false);
    assert.strictEqual(canReadTender("ADMIN", false, false), true);
  });
});
