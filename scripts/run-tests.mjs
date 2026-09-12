// Cross-platform test runner.
// Sets the env vars needed to import lib/prisma.ts (which validates env
// at module load) and then spawns tsx --test on every tests/*.test.ts.
//
// Run via: npm test
//
// Env vars set here are PLACEHOLDERS used only to satisfy the env check
// at module-load time. Tests that exercise pure functions never touch
// the DB; tests that need a real DB should set DATABASE_URL externally.

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "test-session-secret-with-enough-bytes-abcdef0123456789-padding";
process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-with-enough-bytes-abcdef0123456789";
process.env.GEMINI_API_KEY ??= "AIzaTestKeyNotUsedAtRuntime12345678901234567890";
process.env.NODE_ENV ??= "test";

// ─── Fail-closed production-DB guard (audit requirement #5) ───────────────────
//
// Block the entire test process BEFORE any test file loads when DATABASE_URL
// points at a production-designated database. This catches:
//   - A developer running `npm test` locally with their .env loaded.
//   - A future workflow change that reintroduces `secrets.DATABASE_URL`.
//   - A test script inlining a hardcoded production connection string.
//
// See lib/test-db-guard.ts for the full rule set. The guard throws
// synchronously — the spawnSync below never runs.
//
// AUDIT REQUIREMENT: GitHub Actions and all automated tests can NEVER connect
// to the live Neon Production database. This guard enforces that contract at
// the test-runner entry point.
import { enforceTestDatabaseGuard } from "../lib/test-db-guard.mjs";
enforceTestDatabaseGuard(process.env.DATABASE_URL);

const testDir = resolve(process.cwd(), "tests");

// Walk tests/ recursively so test files in subdirectories (e.g.
// tests/engine/tender-regression.test.ts, tests/engine/integration/*) are
// executed. Earlier the runner used a non-recursive readdirSync and silently
// skipped every test in a subdirectory — the file existed on disk but never
// ran in CI or `npm test`. This walker preserves the relative-path rule
// documented below (Windows ~8 KB command-line limit).
function walkTestFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// IMPORTANT: keep paths RELATIVE to cwd. Windows has an ~8 KB command-line
// limit; with 70+ test files at long absolute paths (~110 chars each) the
// spawnSync invocation hits "The command line is too long" and the entire
// test suite refuses to start. Relative paths (~25 chars each) keep us
// well under the limit even at 200+ test files. Verified: 71 files × 25
// chars + flags ≈ 1.8 KB.
const files = walkTestFiles(testDir).map((abs) => relative(process.cwd(), abs));

if (files.length === 0) {
  console.error("No tests found in tests/**/*.test.ts");
  process.exit(1);
}

const tsx = resolve(process.cwd(), "node_modules", ".bin", "tsx" + (process.platform === "win32" ? ".cmd" : ""));
const args = ["--test", ...files];

const result = spawnSync(tsx, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
process.exit(result.status ?? 0);
