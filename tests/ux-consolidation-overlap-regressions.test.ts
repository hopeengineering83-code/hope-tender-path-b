// Gap 2+3: Engine action panel buttons and icons were removed.
// These tests verify the new text-based status surface.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const engine = read("components/engine-action-panel.tsx");

test("category A: Engine panel uses text-based status (Gap 2: buttons removed)", () => {
  assert.match(engine, /Closing this browser does not stop processing/);
  assert.match(engine, /Processing automatically/);
  assert.doesNotMatch(engine, /Run Safe Mode/);
  assert.doesNotMatch(engine, /Full AI/);
});

test("category A: Vault repair function retained for automatic use", () => {
  assert.match(engine, /\/api\/company\/reimport/);
  assert.match(engine, /async function repairVaultAndRetry/);
});

test("category A: no retry buttons in normal path (Gap 2)", () => {
  assert.doesNotMatch(engine, /Retry durable Engine/);
  assert.doesNotMatch(engine, /Check status now/);
});

test("category E: no SVG icons in engine panel (Gap 2+3)", () => {
  assert.doesNotMatch(engine, /<BoltIcon/);
  assert.doesNotMatch(engine, /<ClockIcon/);
  assert.doesNotMatch(engine, /<ArrowRightIcon/);
});

test("read-only users see text status (no mutation controls)", () => {
  // Gap 2: no canMutate gate needed because there are no buttons.
  assert.match(engine, /Processing automatically/);
});
