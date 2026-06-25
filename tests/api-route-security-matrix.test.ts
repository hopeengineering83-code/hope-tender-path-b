import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test("API route security matrix is up-to-date and complete", () => {
  // Use --check mode to verify the committed matrix matches the generated output
  execFileSync(process.execPath, ["scripts/generate-api-route-security-matrix.mjs", "--check"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });

  const matrix = readFileSync("docs/audits/api-route-security-matrix.md", "utf8");
  const routes = walk(path.join(process.cwd(), "app", "api")).filter((file) => file.endsWith(`${path.sep}route.ts`));

  // The matrix now has method-specific rows, so the count will be >= the number of route files.
  const handlerCountMatch = matrix.match(/Generated route handlers: \*\*(\d+)\*\*/);
  const handlerCount = handlerCountMatch ? parseInt(handlerCountMatch[1], 10) : 0;
  assert.ok(handlerCount >= routes.length, `Expected at least ${routes.length} handlers, found ${handlerCount}`);

  assert.match(matrix, /Routes requiring manual auth classification: \*\*0\*\*/);
  const matrixRows = matrix.split("## Matrix")[1] ?? "";
  assert.doesNotMatch(matrixRows, /REVIEW_REQUIRED/);

  for (const routeFile of routes) {
    const relative = path.relative(process.cwd(), routeFile).replaceAll(path.sep, "/");
    assert.ok(matrix.includes(relative), `${relative} is missing from the matrix`);
  }
});
