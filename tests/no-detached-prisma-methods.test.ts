// Prisma client methods must be called on the client, never detached.
//
// This class of bug took down the product's final deliverable. In
// lib/tender-generation-readiness.ts:
//
//     const queryRaw = (client as …).$queryRaw;
//     … queryRaw ? await queryRaw`SELECT …`.catch(() => fallback) : fallback
//
// $queryRaw dereferences `this._createPrismaPromise`, so the detached call
// threw `Cannot read properties of undefined`. The throw is synchronous —
// raised while the tagged template is evaluated — so the `.catch()` next to it
// never ran, and the exception escaped to the route. Every request to
// /api/tenders/[id]/download?type=zip answered 500: no tender's final package
// could be downloaded.
//
// It survived a 9,000-test suite because the guard was written for mocks.
// Mocks have no $queryRaw and took the safe branch; only the real client
// reached the broken one, and no unit test uses the real client.
//
// Detaching is never necessary. A capability probe can read the property
// without calling it (`typeof client.$queryRaw === "function"`), and the call
// itself can still go through the client.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "components", "lib", "scripts"];

/** Assignment of a Prisma client method to a standalone binding. */
const DETACHED = new RegExp(
  [
    // const q = (client as SomeCast).$queryRaw;   /   let q = prisma.$executeRaw;
    String.raw`(?:const|let|var)\s+\w+\s*=\s*[^;=\n]*?\.\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe|transaction)\s*;`,
    // const { $queryRaw } = client;
    String.raw`(?:const|let|var)\s*\{[^}]*\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe|transaction)[^}]*\}\s*=`,
  ].join("|"),
);

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(full)) out.push(full);
    }
  };
  ROOTS.forEach(walk);
  return out;
}

/** Strip comments so the explanatory text above (and in the fixed file) is not a hit. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("no Prisma client method is detached from its receiver", () => {
  it("holds across app, components, lib and scripts", () => {
    const offenders = sourceFiles()
      .map((file) => ({ file, src: code(readFileSync(file, "utf8")) }))
      .filter(({ src }) => DETACHED.test(src))
      .map(({ file }) => file);

    assert.deepEqual(
      offenders,
      [],
      "these assign a Prisma method to a binding and call it without its receiver; " +
        "probe with `typeof client.$queryRaw === \"function\"` and call through the client instead",
    );
  });

  it("the detector recognises the exact shape that broke the ZIP download", () => {
    // Without this, a regex that silently matches nothing would make the check
    // above pass forever — the same false-confidence failure the guard it
    // replaces was made of.
    const original =
      'const queryRaw = (client as unknown as { $queryRaw?: unknown }).$queryRaw;';
    assert.ok(DETACHED.test(original), "detector must flag the original detached assignment");

    const destructured = "const { $queryRaw } = prisma;";
    assert.ok(DETACHED.test(destructured), "detector must flag destructuring off the client");
  });

  it("does not flag calling the method on the client", () => {
    assert.ok(!DETACHED.test("const rows = await client.$queryRaw`SELECT 1`;"));
    assert.ok(!DETACHED.test('const ok = typeof client.$queryRaw === "function";'));
  });
});
