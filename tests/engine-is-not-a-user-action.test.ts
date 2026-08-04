// The Engine is a server stage. Nothing in the UI may offer to run it.
//
// This replaces a large family of assertions that were written against
// components/engine-action-panel.tsx — "the panel has no Start or resume
// Engine button", "no Repair source evidence button", "no Check status now
// button", "no force-run bypass", "no Unicode dingbat", and so on.
//
// Every one of those was true, and none of them proved anything, because that
// panel had stopped being reachable UI. Its two handlers (runEngine,
// repairVaultAndRetry) were never referenced, executeEngineRunAsync was
// reachable only from them, it had no useEffect, and the page never passed
// initialResult/initialAsyncStatus. So setResult/setRunning/setAsyncStatus
// were never called: `result` stayed null forever and the heading resolved to
// "Pending automatic processing" permanently — including after the Engine had
// finished. Roughly 300 of its 490 lines could not execute in production.
//
// Asserting "this file contains no button" is a guarantee about a file. The
// guarantee worth having is about the APP: no surface anywhere offers to run
// the Engine, because the durable worker owns it. That survives the panel's
// deletion, and it is what these checks now assert.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { getTenderAction } from "../lib/ui/action-registry";

const ROOTS = ["components", "app/dashboard"];

function uiFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx")) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

/** Comments stripped, so prose about the old design is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = uiFiles().map((file) => ({ file, src: code(readFileSync(file, "utf8")) }));

describe("no UI surface invokes the Engine", () => {
  it("nothing POSTs to the engine route", () => {
    // The route is real and the durable worker calls it server-side. A client
    // component reaching for it would be a user-triggered Engine run by
    // another name.
    const offenders = FILES.filter(({ src }) => /\/engine`|\/engine"|\/engine'/.test(src)).map((f) => f.file);
    assert.deepEqual(
      offenders,
      [],
      "a UI file references the engine route; the Engine is server-driven and must not be user-invocable",
    );
  });

  it("the deleted panel is gone and not resurrected", () => {
    assert.equal(
      existsSync("components/engine-action-panel.tsx"),
      false,
      "engine-action-panel.tsx was deleted because it could not render its own state; " +
        "reintroducing it reintroduces a second, permanently stale status authority",
    );
  });

  it("no file imports it", () => {
    const offenders = FILES.filter(({ src }) => /engine-action-panel|EngineActionPanel/.test(src)).map((f) => f.file);
    assert.deepEqual(offenders, [], "these still reference the deleted Engine panel");
  });
});

describe("the registry describes the Engine as something to observe", () => {
  it("RUN_ENGINE is navigation, not a normal user action", () => {
    // NORMAL means "the user does this here". Every other NORMAL action has a
    // real control; the Engine has none, which is exactly how the frozen panel
    // survived as a supposed action owner.
    assert.equal(getTenderAction("RUN_ENGINE").availability, "NAVIGATION");
  });

  it("it points at the surface where Engine output is actually visible", () => {
    const action = getTenderAction("RUN_ENGINE");
    assert.equal(action.anchor, "#matching-selected-evidence");
    assert.equal(action.owner, "MatchingSelectedEvidencePanel");
  });

  it("its label does not promise an action the user cannot take", () => {
    const label = getTenderAction("RUN_ENGINE").label;
    assert.doesNotMatch(
      label,
      /\b(start|run|resume|retry)\b/i,
      `RUN_ENGINE label "${label}" reads as an instruction, but nothing lets the user do it`,
    );
  });

  it("keeps the real mutation recorded, because the worker still calls it", () => {
    // Honesty in the other direction: the route exists and is used. Blanking
    // the mutation would hide a real server contract.
    assert.equal(getTenderAction("RUN_ENGINE").mutation, "POST /api/tenders/:id/engine");
  });
});

describe("the premise still holds", () => {
  it("the engine route exists and is worker-driven", () => {
    const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
    assert.match(route, /export async function POST/);
    assert.match(
      route,
      /enqueueEngineJobForCurrentSources/,
      "if the route stopped enqueuing durable work, the Engine would no longer be automatic and this whole classification would need revisiting",
    );
  });

  it("the detector would catch a real Engine control", () => {
    // Anti-vacuity: without this, a regex matching nothing passes forever.
    const sample = 'await fetch(`/api/tenders/${tenderId}/engine`, { method: "POST" });';
    assert.match(sample, /\/engine`|\/engine"|\/engine'/);
  });
});
