import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

function assertRule(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}: ${detail}`);
}

function walk(directory, predicate, results = []) {
  const full = join(root, directory);
  if (!existsSync(full)) return results;
  for (const entry of readdirSync(full)) {
    const path = join(full, entry);
    const rel = relative(root, path).replaceAll("\\", "/");
    const stat = statSync(path);
    if (stat.isDirectory()) walk(rel, predicate, results);
    else if (predicate(rel)) results.push(rel);
  }
  return results;
}

const packageJson = JSON.parse(read("package.json") || "{}");
const vercelBuild = packageJson.scripts?.["vercel-build"] ?? "";
const releaseAudit = packageJson.scripts?.["audit:release-integrity"] ?? "";
const schemaCheck = packageJson.scripts?.["db:check-critical-schema"] ?? "";
const safeMigration = read("scripts/migrate-deploy-safe.mjs");

assertRule("package release audit script", releaseAudit.includes("audit-release-integrity.mjs"), "package.json must expose npm run audit:release-integrity");
assertRule("package critical schema script", schemaCheck.includes("check-critical-schema.mjs"), "package.json must expose npm run db:check-critical-schema");
assertRule("vercel safe migration command", vercelBuild.includes("migrate-deploy-safe.mjs"), "vercel-build must invoke the safe migration command before next build");
assertRule(
  "safe migration schema verification",
  safeMigration.includes("scripts/check-critical-schema.mjs") && safeMigration.includes('REQUIRE_MIGRATION_HISTORY: "true"'),
  "the safe migration command must verify critical schema and migration history before completing",
);
assertRule(
  "preview database mutation guard",
  safeMigration.includes("ALLOW_PREVIEW_DB_MIGRATIONS") && safeMigration.includes("build-only and is not database-verified"),
  "preview builds must not mutate a database unless an isolated preview database is explicitly authorized",
);
assertRule(
  "no arbitrary preview migration success",
  !safeMigration.includes('return "preview-error"') && !safeMigration.includes('deployResult === "preview-error"'),
  "arbitrary preview migration failures must not be converted to successful database verification",
);

const standardUpload = read("app/api/upload/route.ts");
const uploadFirst = read("app/api/tenders/upload-first/route.ts");
const storage = read("lib/storage.ts");
const documentReview = read("app/api/tenders/[id]/documents/[docId]/route.ts");
const jobClaim = read("lib/job-claim-policy.ts");
const providerPolicy = read("lib/ai-provider-policy.ts");
const ci = read(".github/workflows/ci.yml");
const postDeployWorkflow = read(".github/workflows/post-deploy-health.yml");
const postDeployVerifier = read("scripts/verify-production-health.mjs");
const ledger = read("docs/release-integrity-ledger.md");
const prTemplate = read(".github/pull_request_template.md");

assertRule("standard upload shared handler", standardUpload.includes("handleSecureUpload"), "standard upload route must delegate to the secure shared handler");
assertRule("upload-first shared handler", uploadFirst.includes("handleUploadFirstTender"), "upload-first route must delegate to the atomic shared handler");
assertRule("canonical storage policy", storage.includes("isDatabaseStorageAllowed") && storage.includes("getStorageReadiness"), "storage decisions must be centralized in lib/storage.ts");
assertRule("no route storage env mutation", !standardUpload.includes("ALLOW_DB_FILE_STORAGE =") && !uploadFirst.includes("ALLOW_DB_FILE_STORAGE ="), "upload routes must not mutate storage environment variables per request");

const apiFiles = walk("app/api", (path) => /\.(ts|tsx|js|mjs)$/.test(path));
const legacyStorageCallers = apiFiles.filter((path) => read(path).includes("saveUploadedFile("));
assertRule("no legacy API file storage", legacyStorageCallers.length === 0, `API routes must not call saveUploadedFile directly: ${legacyStorageCallers.join(", ")}`);

const ownerScopeCount = (documentReview.match(/tender:\s*\{\s*userId:\s*actor\.id\s*\}/g) ?? []).length;
assertRule("document review tenant isolation", ownerScopeCount >= 2, "GET and PUT document-review queries must scope through Tender.userId");
assertRule("persistent review rate limiting", documentReview.includes("rateLimitPersistent"), "review mutations must use the persistent limiter");

assertRule("parameterized job claims", !jobClaim.includes("$queryRawUnsafe") && jobClaim.includes("Prisma.sql"), "AiJob claims must use parameterized Prisma SQL");

const expectedProviderOrder = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
let previousIndex = -1;
let providerOrderOk = true;
for (const provider of expectedProviderOrder) {
  const index = providerPolicy.indexOf(`"${provider}"`);
  if (index < 0 || index <= previousIndex) providerOrderOk = false;
  previousIndex = index;
}
assertRule("canonical AI provider order", providerOrderOk, `provider policy must preserve ${expectedProviderOrder.join(" → ")}`);

assertRule("CI release audit", ci.includes("npm run audit:release-integrity"), "CI must execute the release-integrity audit");
assertRule("CI migration path", ci.includes("Deploy the complete migration history") && ci.includes("npx prisma migrate deploy"), "CI must apply migrations to the same clean database used by application tests");
assertRule("CI credential-safe schema diff", ci.includes("Verify credential-safe zero-drift schema comparison") && ci.includes("--from-schema-datasource") && !ci.includes("--from-url"), "CI must execute the same credential-safe schema comparison used by recovery logic");
assertRule("CI migration idempotency", ci.includes("Verify migration idempotency"), "CI must prove a second migration deployment is clean");
assertRule("CI avoids schema shortcuts", !ci.includes("prisma db push") && !ci.includes("prisma db execute"), "CI must not replace migration proof with db push or manual SQL reapplication");
assertRule("CI critical schema", ci.includes("npm run db:check-critical-schema"), "CI must verify critical tables, columns, functions, and migration state");
assertRule("post-deploy workflow", postDeployWorkflow.includes("Verify production health and deployed commit") && postDeployWorkflow.includes("workflow_run"), "successful main CI must trigger production verification");
assertRule("post-deploy release match", postDeployVerifier.includes("health.release === expectedSha") && postDeployVerifier.includes("RateLimitBucket"), "post-deploy verification must check the deployed SHA and critical tables");

assertRule("release integrity ledger", ledger.includes("RI-001") && ledger.includes("RI-014"), "canonical non-negotiable rules must remain documented");
assertRule("PR change impact matrix", prTemplate.includes("Change-impact matrix") && prTemplate.includes("Representative workflow verification"), "PR template must require impact and workflow evidence");

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
