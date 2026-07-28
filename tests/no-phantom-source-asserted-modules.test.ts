// Guards against a defect class that had grown three times in this codebase:
// a module with no production importer, whose only "coverage" is a test that
// reads its source with readFileSync and substring-matches the text.
//
// That combination is worse than plain dead code. The suite reports the
// behaviour as covered — "atomic job claiming", "operation lock exists",
// "deterministic idempotency key" — while the module is unreachable from the
// running application, so the assertions describe a file rather than the app.
// Three such modules were found and deleted (tender-operation-lock.ts,
// ai-jobs/worker.ts, capability-readiness.ts); in each case a live
// implementation of the same concern already existed elsewhere, and the real
// one was never the thing under test.
//
// A module is flagged only when all three hold:
//   1. nothing under app/, lib/ or components/ imports it,
//   2. no test imports it either (so it has no behavioural coverage), and
//   3. at least one test mentions its path as a string literal (so it is
//      being source-asserted rather than simply unused).
//
// Legitimately test-only helpers are not flagged: they are imported by their
// tests, so condition 2 fails. Plain unused modules are not flagged either —
// that is a separate concern from this one.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

const productionFiles = ["app", "lib", "components"].flatMap((dir) => walk(dir));
const testFiles = walk("tests");
const read = (p: string) => readFileSync(p, "utf8");

const productionSources = new Map(productionFiles.map((f) => [f, read(f)]));
const testSources = new Map(testFiles.map((f) => [f, read(f)]));

/** Does any file in `sources` import the module at `modulePath`? */
function hasImporter(sources: Map<string, string>, modulePath: string): boolean {
  const stem = modulePath.replace(/^lib\//, "").replace(/\.tsx?$/, "");
  const tail = stem.split("/").pop() as string;
  const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match a real module specifier ending in this file, e.g. `from "../lib/x"`
  // or `await import("./x")` — not a bare mention inside a string.
  const specifier = new RegExp(`(?:from|import\\(|require\\()\\s*["'][^"']*\\b${escaped}["']`);
  for (const [file, src] of sources) {
    if (file === modulePath) continue;
    if (specifier.test(src)) return true;
  }
  return false;
}

describe("no module is 'covered' only by assertions on its own source text", () => {
  it("every source-asserted lib module is either imported by production or exercised by a test", () => {
    const phantoms: string[] = [];

    for (const modulePath of productionFiles) {
      if (!modulePath.startsWith("lib/")) continue;
      if (modulePath.endsWith(".d.ts")) continue;

      // 3. Is its path quoted inside any test?
      const quoted = `"${modulePath}"`;
      const sourceAsserted = [...testSources.values()].some((src) => src.includes(quoted));
      if (!sourceAsserted) continue;

      // 1. Any production importer?
      if (hasImporter(productionSources, modulePath)) continue;

      // 2. Any test that actually imports (rather than reads) it?
      if (hasImporter(testSources, modulePath)) continue;

      phantoms.push(modulePath);
    }

    assert.deepEqual(
      phantoms,
      [],
      `These modules have no production importer and no test that imports them, yet a test asserts on their source text. ` +
        `Either wire them into the application, delete them and point the assertions at the live implementation, ` +
        `or import them so the test exercises real behaviour:\n  ${phantoms.join("\n  ")}`,
    );
  });
});
