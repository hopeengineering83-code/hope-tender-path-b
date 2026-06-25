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

test("API route security matrix is generated, complete, and has no REVIEW_REQUIRED routes", () => {
  execFileSync(process.execPath, ["scripts/generate-api-route-security-matrix.mjs"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });

  const matrix = readFileSync("docs/audits/api-route-security-matrix.md", "utf8");
  const routes = walk(path.join(process.cwd(), "app", "api")).filter((file) => file.endsWith(`${path.sep}route.ts`));

  assert.match(matrix, new RegExp(`Generated route handlers: \\*\\*${routes.length}\\*\\*`));
  assert.match(matrix, /Routes requiring manual auth classification: \*\*0\*\*/);
  const matrixRows = matrix.split("## Matrix")[1] ?? "";
  assert.doesNotMatch(matrixRows, /REVIEW_REQUIRED/);

  for (const routeFile of routes) {
    const relative = path.relative(process.cwd(), routeFile).replaceAll(path.sep, "/");
    assert.match(matrix, new RegExp(relative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${relative} is missing from the matrix`);
  }
});
