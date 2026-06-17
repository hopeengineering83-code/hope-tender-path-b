import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = String(process.env.DEPLOYMENT_URL ?? "").replace(/\/$/, "");
const expectedRelease = String(process.env.EXPECTED_RELEASE_SHA ?? "").trim();
const requiredTables = ["RateLimitBucket", "PasswordResetToken", "SubmissionPlanState", "AiAnalyzeChunk", "AiJob"];

if (!baseUrl) throw new Error("DEPLOYMENT_URL is required");
if (!expectedRelease) throw new Error("EXPECTED_RELEASE_SHA is required");

async function fetchWithRetry(path, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { redirect: "manual", ...options });
      if (response.status < 500 || attempt === 6) return response;
      lastError = new Error(`${path} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(attempt * 4_000);
  }
  throw lastError ?? new Error(`Unable to fetch ${path}`);
}

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${name}: ${message}`);
    console.error(`FAIL ${name}: ${message}`);
  }
}

await check("health endpoint, release identity, and critical schema", async () => {
  const response = await fetchWithRetry("/api/health");
  if (response.status !== 200) throw new Error(`expected 200, received ${response.status}`);
  const health = await response.json();
  if (health.status !== "healthy" || health.ok !== true) {
    throw new Error(`health status is ${JSON.stringify({ ok: health.ok, status: health.status })}`);
  }
  if (health.release !== expectedRelease) {
    throw new Error(`release mismatch: expected ${expectedRelease}, received ${health.release}`);
  }
  for (const table of requiredTables) {
    if (health.tables?.[table] !== true) throw new Error(`critical table ${table} is not ready`);
  }
});

await check("homepage renders", async () => {
  const response = await fetchWithRetry("/");
  if (response.status >= 500) throw new Error(`received ${response.status}`);
});

await check("login renders", async () => {
  const response = await fetchWithRetry("/login");
  if (response.status >= 500) throw new Error(`received ${response.status}`);
});

await check("unauthenticated dashboard is not publicly successful", async () => {
  const response = await fetchWithRetry("/dashboard");
  if (response.status >= 500) throw new Error(`received ${response.status}`);
  if (response.status === 200 && !response.headers.get("location")) {
    const body = await response.text();
    if (!/login|sign in|unauthorized/i.test(body)) {
      throw new Error("dashboard returned public content without an authentication redirect or login surface");
    }
  }
});

console.log(JSON.stringify({ ok: failures.length === 0, expectedRelease, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
