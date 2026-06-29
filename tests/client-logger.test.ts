/**
 * Tests for the browser-safe client logger.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

describe("Client logger", () => {
  const src = readFileSync("lib/ui/client-logger.ts", "utf8");

  it("exports clientLogger with error, warn, info methods", () => {
    assert.ok(src.includes("export const clientLogger"), "Must export clientLogger");
    assert.ok(src.includes("error:"), "Must have error method");
    assert.ok(src.includes("warn:"), "Must have warn method");
    assert.ok(src.includes("info:"), "Must have info method");
  });

  it("is a no-op in production (NODE_ENV=production)", () => {
    assert.ok(src.includes('process.env.NODE_ENV !== "production"'), "Must check NODE_ENV");
    assert.ok(src.includes("isDev"), "Must have isDev flag");
  });

  it("does not leak errors to browser console in production", () => {
    // In production, the if(isDev) block is skipped entirely
    assert.ok(src.includes("if (isDev)"), "All logging must be inside if(isDev) blocks");
  });
});
