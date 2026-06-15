import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("merged PR incorporation repair", () => {
  it("uses one exact canonical provider policy", () => {
    const policy = read("lib/ai-provider-policy.ts");
    assert.match(policy, /"mistral"[\s\S]*"groq"[\s\S]*"openrouter"[\s\S]*"gemini"[\s\S]*"openai"[\s\S]*"together"[\s\S]*"deepseek"[\s\S]*"anthropic"/);
    for (const path of ["lib/ai.ts", "lib/system-readiness.ts", "lib/ai-environment-readiness.ts", "app/api/ai/health/route.ts", "components/ai-health-panel.tsx"]) {
      assert.match(read(path), /ai-provider-policy/, `${path} must consume the canonical policy`);
    }
  });

  it("does not mutate tracked source during package lifecycle commands", () => {
    const pkg = JSON.parse(read("package.json"));
    for (const [name, command] of Object.entries(pkg.scripts)) {
      assert.doesNotMatch(String(command), /reconcile-gap-closure|writeFileSync\([^)]*(?:lib|app|components|tests)/, `${name} must not rewrite source`);
    }
    assert.equal(existsSync("scripts/reconcile-gap-closure.mjs"), false);
    assert.equal(pkg.scripts["verify:source-clean"], "node scripts/verify-source-clean.mjs");
  });

  it("wires centralized permissions into high-risk boundaries", () => {
    const auth = read("lib/auth.ts");
    assert.match(auth, /export async function requirePermission/);
    assert.match(auth, /canPerform\(user\.role, action\)/);
    const expected: Record<string, string> = {
      "app/api/tenders/[id]/generate/route.ts": "GENERATION_TRIGGER",
      "app/api/tenders/[id]/export/route.ts": "FINAL_EXPORT",
      "app/api/tenders/[id]/download/route.ts": "FINAL_EXPORT",
      "app/api/company/documents/[id]/route.ts": "COMPANY_KNOWLEDGE_MGMT",
      "app/api/users/[id]/route.ts": "USER_ADMIN",
      "app/api/admin/diagnostics/route.ts": "OPERATIONAL_DIAGNOSTICS",
      "app/api/admin/repair/route.ts": "DATA_REPAIR",
    };
    for (const [path, action] of Object.entries(expected)) {
      const source = read(path);
      assert.match(source, new RegExp(`requirePermission\\("${action}"\\)`), `${path} must enforce ${action}`);
    }
  });
});
