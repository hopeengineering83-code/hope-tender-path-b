/**
 * Post-deployment smoke check.
 *
 * Usage:
 *   DEPLOYMENT_URL=https://your-preview.vercel.app node scripts/verify-deployment.mjs
 *
 * Checks:
 *   1. /api/health responds 200 with { status: "ok" }
 *   2. / (homepage) responds < 500
 *   3. /login renders without a 5xx
 *   4. /dashboard redirects to /login for unauthenticated requests
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 */

import { setTimeout as sleep } from "node:timers/promises";

const base = (process.env.DEPLOYMENT_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("ERROR: DEPLOYMENT_URL env var is required.");
  process.exit(1);
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 6000;

async function fetchWithRetry(url, options = {}, label = url) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: "manual", ...options });
      return res;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      console.warn(`  [retry ${attempt}/${MAX_RETRIES}] ${label}: ${err.message}`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    checks.push({ name, ok: true });
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    checks.push({ name, ok: false, error: err.message });
  }
}

console.log(`\nDeployment verification: ${base}\n`);

await check("/api/health — responds 200 with status ok", async () => {
  const res = await fetchWithRetry(`${base}/api/health`, {}, "/api/health");
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body || body.status !== "ok") throw new Error(`Unexpected body: ${JSON.stringify(body)}`);
});

await check("/ — homepage responds without 5xx", async () => {
  const res = await fetchWithRetry(`${base}/`, {}, "/");
  if (res.status >= 500) throw new Error(`Got ${res.status}`);
});

await check("/login — responds without 5xx", async () => {
  const res = await fetchWithRetry(`${base}/login`, {}, "/login");
  if (res.status >= 500) throw new Error(`Got ${res.status}`);
});

await check("/dashboard — unauthenticated access is blocked or redirected", async () => {
  const res = await fetchWithRetry(`${base}/dashboard`, {}, "/dashboard");
  // Either a redirect (3xx → /login) or 401 is acceptable.
  // A 200 would mean the dashboard is publicly accessible — that's a failure.
  if (res.status >= 500) throw new Error(`Got 5xx: ${res.status}`);
  if (res.status === 200) {
    // If it returned 200 it must have redirected to login via client-side — we can't
    // verify that here, so we only reject hard 200 with no redirect indicator.
    // In practice Next.js middleware redirects are 307/302, so a 200 here is suspicious.
    const location = res.headers.get("location");
    if (!location) throw new Error("Dashboard returned 200 with no redirect — unauthenticated access may not be blocked");
  }
});

const passed = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok).length;

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
