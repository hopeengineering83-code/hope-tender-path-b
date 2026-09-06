import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// ─── What this file proves ───────────────────────────────────────────────────
//
// The tender workspace polls the canonical workflow endpoint from more than one
// component. One of those polls was keyed on a condition that never becomes
// false.
//
// app/api/tenders/[id]/engine-readiness computes:
//     engineComplete = latestJob.status === "SUCCEEDED" && !engineRunning
// which is sticky — once the Engine has succeeded it stays true for the life of
// the tender. The panel polled `/workflow-center` every 3s for as long as that
// was true, with no hidden-tab guard, so any tender whose Engine had ever
// succeeded kept hitting a DB-backed canonical snapshot every 3 seconds for as
// long as a tab stayed open. Production logs showed 156 requests to that
// endpoint in 18 minutes from one idle tender, on a pooled Neon connection that
// has already shown reachability failures under load.
//
// The sibling poller in requirement-truth-banner.tsx already paused on
// document.hidden. Same page, same endpoint, two different rules — the usual
// shape of this codebase's bugs.
//
// The polling CONDITION is deliberately unchanged: a downstream job can be
// started elsewhere and must still be discovered. Only the cost of waiting
// changes.

const PANEL = "components/matching-selected-evidence-panel.tsx";
const BANNER = "components/requirement-truth-banner.tsx";
const READINESS_ROUTE = "app/api/tenders/[id]/engine-readiness/route.ts";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * The useEffect block that drives an interval calling `loader`. Split on the
 * effect boundary and pick the one that both sets an interval and calls the
 * loader, so the assertions below cannot accidentally read a neighbouring effect.
 */
function pollEffect(source: string, loader: string): string {
  const blocks = source.split("useEffect(() => {").slice(1);
  const match = blocks.find(
    (block) => block.includes("window.setInterval(") && block.includes(`${loader}()`),
  );
  assert.ok(match, `could not locate the interval effect that polls ${loader}`);
  const end = match.indexOf("}, [");
  return end > 0 ? match.slice(0, end) : match;
}

describe("engineComplete is a sticky terminal state, not a transient one", () => {
  it("the route derives it from a SUCCEEDED job, so it never clears on its own", () => {
    const route = read(READINESS_ROUTE);
    assert.match(route, /engineComplete\s*=\s*Boolean\(latestJob\?\.status === "SUCCEEDED"\)\s*&&\s*!engineRunning/);
    // engineRunning IS transient — it is derived from an active job — which is
    // why polling on it is self-limiting and polling on engineComplete is not.
    assert.match(route, /engineRunning\s*=\s*Boolean\(activeJob\)/);
  });
});

describe("the terminal-state poll does not run at in-flight speed forever", () => {
  const panel = read(PANEL);

  it("defines a distinct idle cadence", () => {
    assert.match(panel, /const POLL_INTERVAL_MS = 3_000;/);
    assert.match(panel, /const IDLE_POLL_INTERVAL_MS = 8_000;/);
  });

  it("uses the fast cadence only while a downstream job is actually active", () => {
    const effect = pollEffect(panel, "loadDownstreamWorkflow");
    assert.match(
      effect,
      /downstream\?\.activeJob \? POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS/,
      "the terminal-state poll must slow down when nothing is in flight",
    );
  });

  it("still polls whenever the Engine has completed, so liveness does not regress", () => {
    // The CONDITION must not have been narrowed: a downstream job started in
    // another tab or by a cron still has to be discovered here.
    const effect = pollEffect(panel, "loadDownstreamWorkflow");
    assert.match(effect, /if \(!readiness\?\.engineComplete \|\| deletedRef\.current\) return;/);
  });

  it("re-evaluates its cadence when downstream activity appears or clears", () => {
    assert.match(
      panel,
      /\[loadDownstreamWorkflow, readiness\?\.engineComplete, downstream\?\.activeJob\]/,
      "the effect must depend on activeJob or it can never switch cadence",
    );
  });
});

describe("no client poller anywhere hits the network from a hidden tab", () => {
  // One rule, applied everywhere, so a background tab cannot quietly generate
  // database load. Enumerated from source rather than listed by hand, so a new
  // unguarded poller added later fails this test instead of shipping.
  it("every setInterval that polls holds a document.hidden guard", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const files = execSync(
      "grep -rl 'setInterval' --include=*.tsx components app || true",
      { encoding: "utf8" },
    ).split("\n").filter(Boolean);
    assert.ok(files.length > 0, "expected to find client intervals to audit");

    const unguarded: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const chunk of source.split("setInterval(").slice(1)) {
        const head = chunk.slice(0, 260);
        // A self-clearing, bounded retry loop is not a poller — it stops on its
        // own and never outlives the interaction that started it.
        if (head.includes("clearInterval(timer)")) continue;
        if (!head.includes("document.hidden")) unguarded.push(file);
      }
    }
    assert.deepEqual([...new Set(unguarded)], [], "these files poll without a visibility guard");
  });
});

describe("every workflow poll on this page obeys the same hidden-tab rule", () => {
  it("the page-level sentinel pauses when the tab is hidden", () => {
    assert.match(read(BANNER), /if \(!document\.hidden\) void loadCanonicalWorkflow\(\);/);
  });

  it("the panel's readiness poll pauses when the tab is hidden", () => {
    assert.match(read(PANEL), /if \(!document\.hidden\) void loadReadiness\(\);/);
  });

  it("the panel's downstream poll pauses when the tab is hidden", () => {
    assert.match(read(PANEL), /if \(!document\.hidden\) void loadDownstreamWorkflow\(\);/);
  });

  it("the AI Analyze panel's engine poll pauses when the tab is hidden", () => {
    assert.match(read("components/ai-analyze-panel.tsx"), /if \(!document\.hidden\) void loadEngineState\(\);/);
  });

  it("leaves no unguarded interval polling a tender endpoint in this panel", () => {
    const panel = read(PANEL);
    // Every setInterval in this file must gate its work on document.hidden.
    const intervals = panel.split("window.setInterval(").slice(1);
    assert.ok(intervals.length >= 2, "expected the readiness and downstream pollers");
    for (const [index, body] of intervals.entries()) {
      const head = body.slice(0, 200);
      assert.match(head, /document\.hidden/, `setInterval #${index + 1} polls without a visibility guard`);
    }
  });
});
