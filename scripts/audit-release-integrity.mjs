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
check("PostCSS patched resolution pinned", pkg.overrides?.postcss === "8.5.10", "package.json must pin the patched PostCSS resolution");

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

const uploadFirst = read("app/api/tenders/upload-first/route.ts");
check("upload route does not mutate process environment", !uploadFirst.includes("process.env.ALLOW_DB_FILE_STORAGE ="), "request handlers must not change process-wide storage policy");

const uploadSecurity = read("lib/upload-security.ts");
check("upload signatures have explicit bounds", uploadSecurity.includes("buffer.length < signature.length"), "signature checks must reject truncated buffers explicitly");
check("OpenXML active content rejected", uploadSecurity.includes("vbaProject") && uploadSecurity.includes("activeX") && uploadSecurity.includes("embeddings") && uploadSecurity.includes("externalLinks"), "Office uploads must reject active and embedded content");
check("legacy Office rejected", uploadSecurity.includes("Legacy DOC/XLS files cannot be safely inspected"), "uninspectable legacy Office binaries must not enter the document pipeline");

const sourcePanel = read("components/tender-source-files-panel.tsx");
const newTender = read("app/dashboard/tenders/new/page.tsx");
const setupWizard = read("app/dashboard/setup/page.tsx");
const companyLayout = read("app/dashboard/company/layout.tsx");
const uploadEnforcer = read("components/secure-upload-policy-enforcer.tsx");
for (const [name, value] of [["source panel", sourcePanel], ["new tender", newTender], ["setup wizard", setupWizard]]) {
  check(`${name} excludes legacy Office pickers`, !value.includes('.pdf,.doc,.docx') && !value.includes('.xls,.xlsx') && value.includes(".pdf,.docx,.xlsx,.csv,.txt"), `${name} must advertise only inspectable document formats`);
}
check("company vault mounts secure upload policy", companyLayout.includes("SecureUploadPolicyEnforcer"), "company vault must mount the document picker policy");
check("company vault policy blocks unsafe change and drop events", uploadEnforcer.includes("stopImmediatePropagation") && uploadEnforcer.includes('document.addEventListener("change"') && uploadEnforcer.includes('document.addEventListener("drop"'), "company vault must reject unsafe selections before page handlers run");

const limiter = read("lib/rate-limit.ts");
check("persistent limiter avoids unsafe raw SQL", !limiter.includes("$queryRawUnsafe"), "rate-limit SQL must remain parameterized");
check("persistent limiter fails closed in production", limiter.includes("RATE_LIMIT_ALLOW_DEGRADED") && limiter.includes("production && !emergencyFailOpen") && limiter.includes("allowed: false"), "production must not silently downgrade to per-instance enforcement");

const directPersistentAiRoutes = [
  "app/api/tenders/[id]/engine/route.ts",
  "app/api/tenders/[id]/ai-proposal/route.ts",
  "app/api/tenders/[id]/ai-rematch/route.ts",
  "app/api/tenders/[id]/regenerate-cvs/route.ts",
  "app/api/tenders/[id]/regenerate-section/route.ts",
  "app/api/tenders/[id]/copilot/route.ts",
  "app/api/tenders/[id]/evaluator-simulation/route.ts",
];
for (const path of directPersistentAiRoutes) {
  const source = read(path);
  check(`${path} uses persistent AI throttling`, source.includes("rateLimitPersistent") && !source.includes("const rl = rateLimit("), `${path} must not rely on a process-local mutation limiter`);
}

const middleware = read("middleware.ts");
const rateGuard = read("app/api/internal/rate-guard/route.ts");
// The signed-token comparison must also require a non-null derived token, so a
// missing SESSION_SECRET can never be mistaken for a trusted internal hop.
check("large AI routes pass through signed guard", middleware.includes("ai-analyze|generate") && middleware.includes("/api/internal/rate-guard") && middleware.includes("guardToken !== null && req.headers.get(INTERNAL_GUARD_HEADER) === guardToken") && middleware.includes("requestHeaders.delete(INTERNAL_GUARD_HEADER)"), "large AI handlers must not be callable without the signed persistent guard");
check("AI guard authenticates and persists rate state", rateGuard.includes("await getSession()") && rateGuard.includes("await rateLimitPersistent") && rateGuard.includes('headers: { "Retry-After"'), "guard must authenticate and persistently limit before forwarding");
check("AI guard cannot become an open proxy", rateGuard.includes("targetUrl.origin !== currentUrl.origin") && rateGuard.includes("GUARDED_ROUTE.test(targetUrl.pathname)"), "guard target must remain same-origin and allowlisted");
check("AI guard forwards a strict header allowlist", rateGuard.includes("FORWARDED_REQUEST_HEADERS") && !rateGuard.includes("new Headers(req.headers)"), "guard must not forward arbitrary infrastructure headers");

const documentRoute = read("app/api/tenders/[id]/documents/[docId]/route.ts");
const commentsRoute = read("app/api/tenders/[id]/documents/[docId]/comments/route.ts");
const planActionRoute = read("app/api/tenders/[id]/documents/[docId]/plan-action/route.ts");
check("document review tenant isolation", documentRoute.includes("tender: { userId: actor.id }") && documentRoute.includes("rateLimitPersistent"), "document reviews must remain owner-scoped and persistently limited");
check("document comments tenant isolation", commentsRoute.includes("tender: { userId: actor.id }") && commentsRoute.includes("rateLimitPersistent") && !commentsRoute.includes("email: true"), "comments must remain owner-scoped, persistently limited, and exclude author email PII");
check("plan action tenant isolation", planActionRoute.includes("tender: { userId: actor.id }") && !planActionRoute.includes("?? await prisma.tender.findFirst"), "plan actions must not fall back to cross-tenant access");

const aiJobRoute = read("app/api/ai-jobs/[id]/route.ts");
check("AI job authorized before recovery", aiJobRoute.indexOf("const accessRow") >= 0 && aiJobRoute.indexOf("await recoverIfStuck") > aiJobRoute.indexOf("const accessRow"), "AI job recovery must happen only after access is established");

const pricingHeader = read("app/api/tenders/[id]/pricing/route.ts");
const pricingCreate = read("app/api/tenders/[id]/pricing/lines/route.ts");
const pricingLine = read("app/api/tenders/[id]/pricing/lines/[lineId]/route.ts");
check("pricing mutations use persistent limits", [pricingHeader, pricingCreate, pricingLine].every((value) => value.includes("rateLimitPersistent")), "pricing writes must use persistent rate limits");
check("pricing expert references are tenant-owned", pricingCreate.includes("company: { userId: actor.id }") && pricingLine.includes("company: { userId: actor.id }"), "pricing lines must not reference another tenant's experts");
check("pricing totals are bounded", pricingCreate.includes("MAX_TOTAL") && pricingLine.includes("MAX_TOTAL"), "pricing inputs must not create non-finite or unbounded totals");

const aiAnalyze = read("app/api/tenders/[id]/ai-analyze/route.ts");
check("AI source references validated", aiAnalyze.includes("validTenderFileIds.has(req.sourceFileToken)") && !aiAnalyze.includes("sourceTenderFileId: req.sourceFileToken ?? null"), "AI-returned source IDs must match uploaded tender files");
// The vault content digest was moved to lib/engine/tender-analysis-content.ts
// (the shared content+hash builder) during the Stage 1 unification (PR #821).
// Check there instead of the route file.
const tenderAnalysisContent = read("lib/engine/tender-analysis-content.ts");
check("AI vault hash includes content digest", tenderAnalysisContent.includes("[digest:${textDigest}]"), "analysis checkpoints must invalidate when reviewed vault text changes");

// ─── P1: Release/secret governance — reject dangerous files ─────────
import { execSync } from "node:child_process";

// 1. .env file must NEVER be committed
check(".env file is not committed", !existsSync(join(root, ".env")), "committing .env leaks credentials — use .env.example with placeholders only");

// 2. .env.example must not contain real values
const envExample = read(".env.example");
check(".env.example has no real API keys", !envExample.match(/(sk-ant-[A-Za-z0-9]{20,}|sk-or-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9]{20,})/), ".env.example must contain only placeholder values, never real API keys");

// 3. No duplicate repository folders committed as gitlinks
try {
  const trackedFiles = execSync("git ls-files", { cwd: root, encoding: "utf8" }).trim();
  const dangerousDirs = ["repo", "repo-866", "repo-fix", "repo-pr866"];
  for (const dir of dangerousDirs) {
    check(`${dir}/ gitlink is not committed`, !trackedFiles.split("\n").includes(dir), `${dir}/ must not be committed as a gitlink — remove with: git rm --cached ${dir}`);
  }
} catch {
  // git not available — skip
}

// 4. No screenshots or uploaded files committed to git
try {
  const trackedUploads = execSync("git ls-files upload/", { cwd: root, encoding: "utf8" }).trim();
  const uploadFiles = trackedUploads ? trackedUploads.split("\n").filter(Boolean) : [];
  check("upload/ directory has no git-tracked screenshots", uploadFiles.length === 0, `upload/ contains ${uploadFiles.length} git-tracked files — screenshots must not be committed: ${uploadFiles.slice(0, 5).join(", ")}`);
} catch {
  check("upload/ directory has no git-tracked screenshots", true, "");
}

// 5. migration_lock.toml must exist and pin postgresql
const lockFile = read("prisma/migrations/migration_lock.toml");
check("migration_lock.toml pins postgresql", lockFile.includes('provider = "postgresql"'), "migration_lock.toml must pin provider=postgresql to prevent SQLite drift");

// 6. .nvmrc must exist and pin Node 22
const nvmrc = read(".nvmrc").trim();
check(".nvmrc pins Node 22", nvmrc === "22", `.nvmrc must pin Node 22 (got "${nvmrc}") — Vercel and CI must use the same Node version`);

// 7. package.json engines must match .nvmrc
const enginesNode = pkg.engines?.node ?? "";
const allowsNode22 = /(^|[^\d])22($|[^\d])/.test(enginesNode);
const excludesNode24 = !enginesNode.includes("24") && !enginesNode.includes("25");
check("package.json engines matches .nvmrc", allowsNode22 && excludesNode24, `package.json engines.node must match .nvmrc (Node 22) — got "${enginesNode}"`);

// 8. .env must be gitignored
const gitignore = read(".gitignore");
check(".env is gitignored", gitignore.includes(".env") && !gitignore.includes("!.env"), ".env must be in .gitignore and must not be un-ignored");

console.log(JSON.stringify({ ok: failures.length === 0, checks, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
