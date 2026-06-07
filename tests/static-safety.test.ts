import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { CANONICAL_PROVIDER_CHAIN } from "../lib/ai";

describe("Static Safety Tests", () => {
  it("CANONICAL_PROVIDER_CHAIN must end with anthropic", () => {
    const lastProvider = CANONICAL_PROVIDER_CHAIN[CANONICAL_PROVIDER_CHAIN.length - 1];
    assert.strictEqual(lastProvider, "anthropic", "Anthropic must be the last provider in the chain for safety.");
  });

  it("API list/summary routes must not select fileContent or extractedText", () => {
    const routesToScan = [
      "app/api/tenders/route.ts",
      "app/api/tenders/summary/route.ts"
    ];

    for (const route of routesToScan) {
      if (!fs.existsSync(route)) continue;
      const content = fs.readFileSync(route, "utf8");
      assert.ok(!content.includes("fileContent: true"), `Route ${route} should not select fileContent`);
      assert.ok(!content.includes("extractedText: true"), `Route ${route} should not select extractedText`);
    }
  });

  it("Final ZIP generation must not include chat or workbench exports", () => {
    // This is a logic check on lib/engine/final-zip-scope.ts (deferred file)
    // but we can check if there are any obvious inclusions in related files
    const zipScopeFile = "lib/engine/final-zip-scope.ts";
    if (fs.existsSync(zipScopeFile)) {
      const content = fs.readFileSync(zipScopeFile, "utf8");
      assert.ok(!content.includes("chat_history"), "Final ZIP should not include chat history");
      assert.ok(!content.includes("workbench"), "Final ZIP should not include workbench data");
    }
  });

  it("Cleanup cron must require CRON_SECRET check", () => {
    const cronFile = "app/api/cron/cleanup/route.ts";
    if (fs.existsSync(cronFile)) {
      const content = fs.readFileSync(cronFile, "utf8");
      assert.ok(content.includes("CRON_SECRET"), "Cleanup cron should check for CRON_SECRET");
    }
  });
});
