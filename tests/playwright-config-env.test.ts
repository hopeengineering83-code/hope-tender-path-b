import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("playwright.config.ts", "utf8");

test("Playwright local webServer supplies production env placeholders", () => {
  assert.ok(source.includes('SESSION_SECRET: process.env.SESSION_SECRET || "playwright-local-session-secret-32-chars-min"'));
  assert.ok(source.includes('ZAI_API_KEY: process.env.ZAI_API_KEY || "playwright-local-zai-placeholder"'));
  assert.ok(source.includes('DATABASE_URL: process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder"'));
});
