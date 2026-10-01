// Guards against a defect class that had grown three times in this codebase:
// a module with no production importer, whose only "coverage" is a test that
// reads its source with readFileSync and substring-matches the text.
//
// That combination is worse than plain dead code. The suite reports the
// behaviour as covered while the module is unreachable from the running app.
// A module is flagged only when all three hold:
//   1. nothing under app/, lib/ or components/ imports it,
//   2. no test imports it either (so it has no behavioural coverage), and
//   3. at least one test mentions its path as a quoted string literal.

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
const read = (path: string) => readFileSync(path, "utf8");
const productionSources = new Map(productionFiles.map((file) => [file, read(file)]));
const testSources = new Map(testFiles.map((file) => [file, read(file)]));

function hasImporter(sources: Map<string, string>, modulePath: string): boolean {
  const stem = modulePath.replace(/^lib\//, "").replace(/\.tsx?$/, "");
  const tail = stem.split("/").pop() as string;
  const escaped = tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = new RegExp(`(?:from|import\\(|require\\()\\s*["'][^"']*\\b${escaped}["']`);
  for (const [file, source] of sources) {
    if (file === modulePath) continue;
    if (specifier.test(source)) return true;
  }
  return false;
}

describe("no module is covered only by assertions on its own source text", () => {
  it("every source-asserted lib module is imported by production or exercised by a test", () => {
    const phantoms: string[] = [];
    for (const modulePath of productionFiles) {
      if (!modulePath.startsWith("lib/") || modulePath.endsWith(".d.ts")) continue;
      const quoted = `"${modulePath}"`;
      const sourceAsserted = [...testSources.values()].some((source) => source.includes(quoted));
      if (!sourceAsserted) continue;
      if (hasImporter(productionSources, modulePath)) continue;
      if (hasImporter(testSources, modulePath)) continue;
      phantoms.push(modulePath);
    }
    assert.deepEqual(
      phantoms,
      [],
      `These modules have no production importer and no behavioural test, but a test asserts on their source text. Wire them into production, delete them and retarget the assertion, or import them in a behavioural test:\n  ${phantoms.join("\n  ")}`,
    );
  });
});
