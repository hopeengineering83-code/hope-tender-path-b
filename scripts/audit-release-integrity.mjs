import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const checks = [];

function read(path) {
  const full = join(root, path);
  if (!existsSync(full)) {
    failures.push(`Missing required file: ${path}`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function check(name, condition, detail) {
  const ok = Boolean(condition);
  checks.push({ name, ok });
  if (!ok) failures.push(`${name}: ${detail}`);
}

const pkg = JSON.parse(read("package.json") || "{}");
const scripts = pkg.scripts ?? {};
const lifecycle = ["postinstall", "build", "vercel-build", "typecheck", "lint", "test", "test:integration"];
for (const name of lifecycle) {
  check(
    `${name} is non-mutating`,
    typeof scripts[name] === "string" && !scripts[name].includes("reconcile-gap-closure"),
    `${name} must not execute scripts/reconcile-gap-closure.mjs`,
  );
}
check("manual reconciler remains explicit", scripts["reconcile:ai"]?.includes("reconcile-gap-closure"), "reconciler must remain manual");

const migration = read("scripts/migrate-deploy-safe.mjs");
check("preview migration guard", migration.includes("ALLOW_PREVIEW_DB_MIGRATIONS") && migration.includes("build-only and is not database-verified"), "previews must not mutate a shared database by default");
check("no automatic baseline", !migration.includes("PRISMA_BASELINE_EXISTING_DB") && !migration.includes("--applied\", name"), "non-empty databases without history must stop for manual review");
check("known init only", migration.includes('INIT_MIGRATION = "20260601000000_init"') && migration.includes("--expect-failed-init"), "automatic recovery must be restricted to the known failed init migration");
check("no manual SQL reapply", !migration.includes('"db", "execute"') && !migration.includes("Reapplying idempotent"), "migrations must remain the production schema authority");
check("credential redaction", migration.includes("REDACTED_DATABASE_URL"), "captured migration output must redact the database URL");
check("post-migration verification", migration.includes("verify-retroactive-init.mjs") && migration.includes("check-critical-schema.mjs"), "successful deployment must verify history and critical schema");

const initVerifier = read("scripts/verify-retroactive-init.mjs");
check("init checksum verification", initVerifier.includes('createHash("sha256")') && initVerifier.includes("Checksum mismatch"), "failed init recovery must verify the checked-in migration checksum");
check("init object verification", initVerifier.includes("Missing initialization table") && initVerifier.includes("Missing initialization column"), "failed init recovery must verify the existing initialization structure");
check("init history verification", initVerifier.includes("Expected exactly one unfinished migration") && initVerifier.includes("completed, checksum-matching"), "init history state must be verified before and after recovery");

const ci = read(".github/workflows/ci.yml");
check("CI uses migrations", ci.includes("npx prisma migrate deploy"), "CI must construct its database through migration history");
check("CI avoids schema shortcuts", !ci.includes("prisma db push") && !ci.includes("prisma db execute"), "CI must not use db push or manual migration SQL");
check("CI verifies idempotency", ci.includes("Verify migration idempotency"), "CI must run migrate deploy twice");
check("CI verifies critical schema", ci.includes("npm run db:check-critical-schema") && ci.includes("npm run db:verify-retroactive-init"), "CI must verify critical and initialization structures");
check("CI checks clean tree", (ci.match(/git diff --exit-code/g) ?? []).length >= 3, "CI must reject install, build, or test source mutation");
check("CI runs authenticated isolation", ci.includes('E2E_FULL_AUTH: "true"') && ci.includes("E2E_SECOND_EMAIL"), "CI must run authenticated two-user isolation tests");

const assetRoute = read("app/api/company/assets/route.ts");
const shareRoute = read("app/api/tenders/[id]/share/route.ts");
check("company asset hardening preserved", assetRoute.includes("validateCompanyAsset") && assetRoute.includes("rateLimitPersistent"), "company asset security integration must remain present");
check("share hardening preserved", shareRoute.includes("createTenderShareToken") && shareRoute.includes("revokedAt: new Date()"), "share token and revocation security must remain present");

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
