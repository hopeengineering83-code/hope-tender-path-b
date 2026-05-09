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
import { resolve, join } from "node:path";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.SESSION_SECRET ??= "test-session-secret-with-enough-bytes-abcdef0123456789-padding";
process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-with-enough-bytes-abcdef0123456789";
process.env.GEMINI_API_KEY ??= "AIzaTestKeyNotUsedAtRuntime12345678901234567890";
process.env.NODE_ENV ??= "test";

const testDir = resolve(process.cwd(), "tests");
const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => join(testDir, f));

if (files.length === 0) {
  console.error("No tests found in tests/*.test.ts");
  process.exit(1);
}

const tsx = resolve(process.cwd(), "node_modules", ".bin", "tsx" + (process.platform === "win32" ? ".cmd" : ""));
const args = ["--test", ...files];

const result = spawnSync(tsx, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
process.exit(result.status ?? 0);
