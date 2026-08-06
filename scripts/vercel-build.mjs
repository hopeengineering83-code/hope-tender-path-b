import { execFileSync } from "node:child_process";

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
  console.warn("Preview builds are compile-and-test only; they never mutate the shared Production database.");
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
