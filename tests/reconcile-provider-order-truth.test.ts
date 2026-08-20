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
  "gemini", "groq", "mistral", "zai", "openrouter",
  "cerebras", "openai", "together", "deepseek", "anthropic",
];

// The free chain the app may actually contact. The remainder of CANONICAL is
// enumerated for health/diagnostics only.
const ZERO_PAID_CHAIN = ["gemini", "groq", "mistral", "zai", "openrouter"];

describe("reconcile-gap-closure — provider-order truth", () => {
  const src = readFileSync("scripts/reconcile-gap-closure.mjs", "utf8");

  it("registry canonical order matches the documented order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], CANONICAL);
  });

  it("script pins the documented zero-paid-first order", () => {
    const m = src.match(/REQUIRED_ORDER\s*=\s*\[([^\]]+)\]/);
    assert.ok(m, "script must declare REQUIRED_ORDER");
    const scriptOrder = Array.from(m![1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    assert.deepEqual(scriptOrder, CANONICAL, "script REQUIRED_ORDER must equal the canonical order");
    assert.ok(src.includes("Gemini → Groq → Mistral → Z.ai"), "display labels must lead with the free chain");
  });

  it("script pins the zero-paid money gate, not just the order", () => {
    // Order alone is not the guarantee. What stops a charge is that paid
    // providers are unreachable, that the mode defaults ON, and that the
    // eligibility check runs before a request body exists — so the audit pins
    // all three.
    const m = src.match(/REQUIRED_AUTOMATIC_ORDER\s*=\s*\[([^\]]+)\]/);
    assert.ok(m, "script must declare REQUIRED_AUTOMATIC_ORDER");
    const chain = Array.from(m![1].matchAll(/"([^"]+)"/g)).map((x) => x[1]);
    assert.deepEqual(chain, ZERO_PAID_CHAIN);
    assert.ok(src.includes("catalog.isZeroPaidMode({}) === true"), "must pin the fail-closed default");
    assert.match(src, /providerAutomaticEligibility/, "must pin the pre-request money gate");
    assert.match(src, /isBillingLockedOut/, "must pin the billing lockout");
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

  it("DETECTS drift: a reordered catalog makes the script fail (negative test)", async () => {
    const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "reconcile-drift-"));
    try {
      const files = [
        "scripts/reconcile-gap-closure.mjs",
        "lib/ai-provider-catalog.cjs",
        "lib/ai.ts",
        "lib/ai-provider-policy.ts",
        "app/api/ai/health/route.ts",
        "lib/ai-environment-readiness.ts",
        "app/api/tenders/[id]/download/route.ts",
      ];
      for (const f of files) {
        mkdirSync(join(root, dirname(f)), { recursive: true });
        copyFileSync(f, join(root, f));
      }
      // Mutate the catalog: swap gemini and groq — the exact drift the
      // canonical order rule must catch.
      const catalogPath = join(root, "lib/ai-provider-catalog.cjs");
      const catalog = readFileSync(catalogPath, "utf8");
      const mutated = catalog.replace('  "gemini",\n  "groq",', '  "groq",\n  "gemini",');
      assert.notEqual(mutated, catalog, "mutation must apply");
      writeFileSync(catalogPath, mutated);

      const result = spawnSync(process.execPath, ["scripts/reconcile-gap-closure.mjs"], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1, "script must FAIL on a reordered catalog");
      assert.ok(
        result.stderr.includes("Catalog CANONICAL_AI_PROVIDER_ORDER drifted"),
        `must report the catalog drift, got: ${result.stderr.slice(0, 300)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("DETECTS drift: a hardcoded per-use-case chain makes the script fail (negative test)", async () => {
    const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "reconcile-drift-"));
    try {
      const files = [
        "scripts/reconcile-gap-closure.mjs",
        "lib/ai-provider-catalog.cjs",
        "lib/ai.ts",
        "lib/ai-provider-policy.ts",
        "app/api/ai/health/route.ts",
        "lib/ai-environment-readiness.ts",
        "app/api/tenders/[id]/download/route.ts",
      ];
      for (const f of files) {
        mkdirSync(join(root, dirname(f)), { recursive: true });
        copyFileSync(f, join(root, f));
      }
      // Mutate lib/ai.ts: reintroduce a hardcoded extraction chain.
      const aiPath = join(root, "lib/ai.ts");
      writeFileSync(aiPath, readFileSync(aiPath, "utf8") + '\nconst __drift = { extraction: ["mistral", "groq"] };\nvoid __drift;\n');

      const result = spawnSync(process.execPath, ["scripts/reconcile-gap-closure.mjs"], { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 1, "script must FAIL when a hardcoded chain reappears");
      assert.ok(
        result.stderr.includes("extraction use case reintroduced a hardcoded provider chain"),
        `must report the hardcoded chain, got: ${result.stderr.slice(0, 300)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
