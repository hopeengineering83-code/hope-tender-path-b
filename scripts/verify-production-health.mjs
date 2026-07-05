const baseUrl = (process.env.PRODUCTION_BASE_URL || "https://hope-tender-path-b.vercel.app").replace(/\/$/, "");
const expectedSha = process.env.EXPECTED_SHA || "";
const attempts = Number(process.env.HEALTH_ATTEMPTS || 30);
const delayMs = Number(process.env.HEALTH_DELAY_MS || 20_000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, init) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "follow", ...init });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, text, json };
  } catch (error) {
    return { status: 0, text: error instanceof Error ? error.message : String(error), json: null };
  }
}

async function waitForHealthyRelease() {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await request("/api/health");
    const health = result.json || {};
    const tablesReady = ["RateLimitBucket", "PasswordResetToken", "AiJob"]
      .every((table) => health.tables?.[table] === true);
    const releaseMatches = !expectedSha || health.release === expectedSha;
    if (result.status === 200 && health.status === "healthy" && tablesReady && releaseMatches) {
      console.log(JSON.stringify({
        ok: true,
        status: health.status,
        release: health.release,
        deploymentId: health.deploymentId,
        tables: health.tables,
      }, null, 2));
      return;
    }
    console.log(JSON.stringify({
      attempt,
      status: result.status,
      healthStatus: health.status,
      release: health.release,
      expectedSha,
      tablesReady,
    }));
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`Production did not become healthy on expected commit ${expectedSha || "(not specified)"}`);
}

async function verifyProtectedRoute(path) {
  const result = await request(path, { method: "POST" });
  if (![401, 403].includes(result.status)) {
    throw new Error(`${path} returned unexpected unauthenticated status ${result.status}: ${result.text.slice(0, 300)}`);
  }
}

await waitForHealthyRelease();
await verifyProtectedRoute("/api/upload");
await verifyProtectedRoute("/api/tenders/upload-first");
console.log("Production health and protected upload-route checks passed.");
