// READINESS_CALCULATOR_CLASSIFICATION must describe the codebase, not a plan.
//
// The table in lib/canonical-release-decision.ts tells whoever finishes the
// readiness consolidation which modules are safe to remove. It is hand-written
// prose in a `const`, so nothing stopped it drifting from the code — and it
// had, in the way that gets a route deleted:
//
//   "lib/engine/runtime-readiness-facts.ts": "DELETE"
//
// while app/api/tenders/[id]/runtime-readiness-parity/route.ts imports
// getRuntimeReadinessFacts and safePanelError from it. Acting on that entry
// would have 500'd a live route. Earlier in this work four API routes looked
// unreferenced and turned out to be operator incident tooling driven from
// docs/runbooks/ — "no caller" is a claim that has to be checked, not assumed.
//
// So the table is checked here against real imports:
//
//   DELETE   => zero production importers. Anything else is a landmine.
//   DELEGATE => the file exists (it is consumed, directly or transitively).
//   CANONICAL=> the file exists.
//
// "Production importer" means a file under app/, components/, lib/ or
// scripts/ that imports the module by path — static `from`, dynamic
// `import()`, or `require()`. Tests deliberately do not count: a module kept
// alive only by its own tests is dead code with a test suite attached.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { READINESS_CALCULATOR_CLASSIFICATION } from "../lib/canonical-release-decision";

const PRODUCTION_ROOTS = ["app", "components", "lib", "scripts"];

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|cjs)$/.test(full)) out.push(full);
    }
  };
  PRODUCTION_ROOTS.forEach(walk);
  return out;
}

const FILES = productionFiles();

/** Files that import `modulePath` by path, excluding the module itself. */
function productionImporters(modulePath: string): string[] {
  const key = basename(modulePath).replace(/\.tsx?$/, "");
  const pattern = new RegExp(
    String.raw`(?:from|import\(|require\()\s*["'][^"']*(?:/|\./)` + key + String.raw`["']`,
  );
  return FILES.filter((f) => {
    if (f === modulePath) return false;
    return pattern.test(readFileSync(f, "utf8"));
  });
}

const entries = Object.entries(READINESS_CALCULATOR_CLASSIFICATION) as Array<
  [string, "CANONICAL" | "DELEGATE" | "DELETE"]
>;

describe("every classified module still exists", () => {
  for (const [modulePath] of entries) {
    it(`${modulePath} is a real file`, () => {
      assert.ok(existsSync(modulePath), `${modulePath} is classified but does not exist`);
    });
  }
});

describe("DELETE means nothing in production imports it", () => {
  const deletable = entries.filter(([, cls]) => cls === "DELETE");

  it("holds for every DELETE entry", () => {
    const landmines = deletable
      .map(([modulePath]) => ({ modulePath, importers: productionImporters(modulePath) }))
      .filter((row) => row.importers.length > 0);

    assert.deepEqual(
      landmines.map((row) => `${row.modulePath} <- ${row.importers.join(", ")}`),
      [],
      "a module marked DELETE is still imported in production; removing it would break these callers",
    );
  });
});

describe("the checker itself is honest", () => {
  it("finds the importers of a module that certainly has some", () => {
    // Guards the regex: if productionImporters silently returned [] for
    // everything, the DELETE check above would pass vacuously and this file
    // would provide exactly the false confidence it exists to remove.
    const importers = productionImporters("lib/canonical-tender-readiness.ts");
    assert.ok(
      importers.length > 0,
      "canonical-tender-readiness has known production importers; the detector found none",
    );
  });

  it("does not count a module as importing itself", () => {
    assert.ok(!productionImporters("lib/canonical-release-decision.ts").includes("lib/canonical-release-decision.ts"));
  });
});
