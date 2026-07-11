// Regression: scripts/reconcile-gap-closure.mjs must stay bound to the
// canonical provider order and must pass against the current tree.
//
// The script previously hardcoded a stale pre-Z.ai/Cerebras "Mistral-first"
// chain and reported 11 false drift failures — a duplicated truth source that
// could mislead an operator into "fixing" the canonical order the wrong way.
// This test pins the script's expectations to the catalog and runs it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";

const CANONICAL = [
  "zai", "cerebras", "mistral", "groq", "openrouter",
  "gemini", "openai", "together", "deepseek", "anthropic",
];

describe("reconcile-gap-closure — provider-order truth", () => {
  const src = readFileSync("scripts/reconcile-gap-closure.mjs", "utf8");

  it("registry canonical order matches the documented order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], CANONICAL);
  });

  it("script pins the documented Z.ai-first order (stale Mistral-first chain must never return)", () => {
    const m = src.match(/REQUIRED_ORDER\s*=\s*\[([^\]]+)\]/);
    assert.ok(m, "script must declare REQUIRED_ORDER");
    const scriptOrder = Array.from(m![1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    assert.deepEqual(scriptOrder, CANONICAL, "script REQUIRED_ORDER must equal the canonical order");
    assert.ok(src.includes("Z.ai → Cerebras → Mistral"), "display labels must be Z.ai-first");
    assert.ok(!/^const REQUIRED_CHAIN = \["mistral"/m.test(src), "stale Mistral-first REQUIRED_CHAIN must be gone");
  });

  it("script verifies the catalog itself, not a parallel hardcoded truth", () => {
    assert.ok(src.includes('require("../lib/ai-provider-catalog.cjs")'), "script must read the real catalog");
    assert.ok(src.includes("catalog.CANONICAL_AI_PROVIDER_ORDER"), "script must compare against the catalog order");
  });

  it("script passes against the current tree (ok: true, exit 0)", () => {
    const result = spawnSync(process.execPath, ["scripts/reconcile-gap-closure.mjs"], { encoding: "utf8" });
    assert.equal(result.status, 0, `script failed: ${result.stderr || result.stdout}`);
    assert.ok(result.stdout.includes('"ok": true'), "script must report ok: true");
  });

  it("audit scripts are wired into the CI-run npm script", () => {
    const pkg = readFileSync("package.json", "utf8");
    const m = pkg.match(/"audit:release-integrity":\s*"([^"]+)"/);
    assert.ok(m, "audit:release-integrity script must exist");
    for (const script of ["audit-safe-api-errors.mjs", "audit-no-user-facing-metadata.mjs", "reconcile-gap-closure.mjs"]) {
      assert.ok(m![1].includes(script), `${script} must run in CI via audit:release-integrity`);
    }
  });
});
