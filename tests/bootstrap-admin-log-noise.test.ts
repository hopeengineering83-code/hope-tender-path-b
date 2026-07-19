import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("lib/prisma.ts", "utf8");

test("disabled bootstrap admin seed is not emitted as a production warning", () => {
  assert.doesNotMatch(source, /logger\.warn\([\s\S]{0,240}Skipping bootstrap admin seed in production/);
  assert.match(source, /logger\.debug\([\s\S]{0,160}Bootstrap admin seed is disabled by policy/);
});

test("genuine bootstrap failures remain error-level events", () => {
  assert.match(source, /logger\.error\("\[bootstrap\] failed:"/);
});
