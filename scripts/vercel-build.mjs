import { execFileSync } from "node:child_process";

// FIX 10: Removed all `public/recovery/` artifact publishing logic and the
// associated `copyFileSync`/`mkdirSync`/`readFileSync`/`writeFileSync`/
// `createHash` imports. The temporary release-recovery artifact is no longer
// needed — strict `npm ci --no-audit --no-fund` is restored and the committed
// secure `package-lock.json` is the single source of truth for installs.
//
// No `/public/recovery/` build artifact is exposed by this script.

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const vercelEnvironment = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();
const isVercel = process.env.VERCEL === "1";

run(node, ["scripts/check-env.mjs"]);
run(npm, ["run", "prisma:generate"]);
run(node, ["scripts/audit-dependencies.mjs"]);

if (isVercel && vercelEnvironment !== "production") {
  console.warn(`Skipping database migrations for Vercel ${vercelEnvironment || "non-production"} build.`);
  console.warn("Preview builds are compile-and-test only; they never mutate a database automatically.");
  console.warn(
    "Any Preview migration requires explicit, fingerprint-bound maintenance against a proven isolated Preview database.",
  );
  // …which also means nothing in this build would otherwise notice that the
  // database is unreachable. Non-fatal by design: see the script's header.
  run(node, ["scripts/probe-database-reachability.mjs"]);
  run(npm, [
    "exec",
    "--",
    "tsx",
    "--test",
    "tests/production-recovery-regression.test.ts",
    "tests/manual-workflow-regression.test.ts",
    "tests/canonical-action-panels.test.ts",
    "tests/release-snapshot-canonical-sources.test.ts",
  ]);
} else {
  run(node, ["scripts/migrate-deploy-safe.mjs"]);
}

run(npm, ["exec", "--", "next", "build"]);
