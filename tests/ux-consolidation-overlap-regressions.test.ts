import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const engine = read("components/engine-action-panel.tsx");

test("category A: Engine has one normal server-controlled action owner", () => {
  assert.equal((engine.match(/Start or resume Engine/g) ?? []).length, 1);
  assert.equal((engine.match(/onClick=\{\(\) => void runEngine\(\)\}/g) ?? []).length, 1);
  assert.match(engine, /Durable tender processing/);
  assert.match(engine, /Closing this browser does not stop processing/);
  assert.doesNotMatch(engine, /Run Safe Mode/);
  assert.doesNotMatch(engine, /Full AI/);
});

test("category A: Vault repair remains failure-state recovery only", () => {
  const recoveryGuard = engine.indexOf('result.nextAction === "REVIEW_MATCHING_INPUTS"');
  const repairAction = engine.indexOf("Repair source evidence");
  const normalAction = engine.indexOf("Start or resume Engine");
  assert.ok(normalAction >= 0);
  assert.ok(recoveryGuard > normalAction);
  assert.ok(repairAction > recoveryGuard);
  assert.match(engine, /\/api\/company\/reimport/);
  assert.match(engine, /Restarting the durable Engine workflow/);
});

test("category A: retry controls remain failure-state-only", () => {
  assert.match(
    engine,
    /result\.code === "NETWORK_OR_RUNTIME_ERROR" \|\| result\.code === "ASYNC_ENGINE_FAILED" \|\| result\.code === "ENGINE_JOB_SUPERSEDED"/,
  );
  assert.match(engine, /Retry durable Engine/);
  assert.match(engine, /result\.code === "ASYNC_POLL_TIMEOUT"/);
  assert.match(engine, /Check status now/);
});

test("category E: Engine actions use semantic SVG icons", () => {
  assert.match(engine, /<BoltIcon \/> Start or resume Engine/);
  assert.match(engine, /<ClockIcon \/> Processing/);
  assert.match(engine, /<BoltIcon \/> Repair source evidence/);
  assert.match(engine, /Open Company Vault <ArrowRightIcon \/>/);
});

test("read-only users never receive mutation controls", () => {
  assert.match(engine, /canMutate \? \(/);
  assert.match(engine, /Engine recovery actions require ADMIN or PROPOSAL_MANAGER role/);
  assert.match(engine, /ROLE_READ_ONLY_MUTATION_BLOCKED/);
});
