import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.SCREENSHOT_BASE_URL || "").replace(/\/$/, "");
const email = process.env.SCREENSHOT_TEST_EMAIL || "";
const password = process.env.SCREENSHOT_TEST_PASSWORD || "";
const outputRoot = path.resolve("artifacts/app-screenshots");

if (!baseUrl) throw new Error("SCREENSHOT_BASE_URL is required");
if (!email || !password) throw new Error("Screenshot test credentials are required");

const publicRoutes = ["/", "/login", "/forgot-password", "/offline"];
const authenticatedSeeds = [
  "/dashboard",
  "/dashboard/tenders",
  "/dashboard/tenders/new",
  "/dashboard/company",
  "/dashboard/company/documents",
  "/dashboard/company/readiness",
  "/dashboard/company/plan-b-import",
  "/dashboard/company/review",
  "/dashboard/company/review-board",
  "/dashboard/analysis",
  "/dashboard/matching",
  "/dashboard/history",
  "/dashboard/analytics",
  "/dashboard/export",
  "/dashboard/settings",
  "/dashboard/admin",
];

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "mobile", width: 390, height: 844 },
];

function excludedPath(pathname) {
  return pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.includes("logout") ||
    /\.(pdf|docx?|xlsx?|zip|png|jpe?g|webp)$/i.test(pathname);
}

function normalizeRoute(raw) {
  try {
    const url = new URL(raw, baseUrl);
    if (url.origin !== new URL(baseUrl).origin || excludedPath(url.pathname)) return null;
    url.hash = "";
    const allowed = new URLSearchParams();
    for (const [key, value] of url.searchParams.entries()) {
      if (["tab", "view", "status", "page"].includes(key)) allowed.set(key, value);
    }
    const query = allowed.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function fileSlug(route) {
  const value = route === "/" ? "home" : route.replace(/^\//, "");
  return value.replace(/[?&=]/g, "__").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 180) || "page";
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(900);
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; caret-color: transparent !important; }
    [data-nextjs-toast], nextjs-portal { display: none !important; }
  ` }).catch(() => {});
}

async function login(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await settle(page);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname.startsWith("/dashboard"), { timeout: 60_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  await settle(page);
}

async function captureRoute(page, viewportName, route, records) {
  let status = null;
  let error = null;
  try {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    status = response?.status() ?? null;
    await settle(page);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const finalUrl = page.url();
  const finalPath = normalizeRoute(finalUrl) || finalUrl;
  const title = await page.title().catch(() => "");
  const loginRedirect = new URL(finalUrl).pathname === "/login" && !route.startsWith("/login");
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const notFound = /page not found|\b404\b/i.test(bodyText.slice(0, 1500));
  const screenshotName = `${String(records.length + 1).padStart(3, "0")}-${fileSlug(route)}.png`;
  const screenshotPath = path.join(outputRoot, viewportName, screenshotName);

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" }).catch((err) => {
    error = `${error ? `${error}; ` : ""}screenshot: ${err instanceof Error ? err.message : String(err)}`;
  });

  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href") || "")).catch(() => []);
  records.push({ viewport: viewportName, requestedRoute: route, finalPath, status, title, screenshot: `${viewportName}/${screenshotName}`, loginRedirect, notFound, error });
  return links;
}

async function captureViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const records = [];

  for (const route of publicRoutes) await captureRoute(page, viewport.name, route, records);
  await login(page);

  const queue = [...authenticatedSeeds];
  const seen = new Set();
  while (queue.length > 0 && seen.size < 120) {
    const route = normalizeRoute(queue.shift());
    if (!route || seen.has(route) || !route.startsWith("/dashboard")) continue;
    seen.add(route);
    const links = await captureRoute(page, viewport.name, route, records);
    for (const raw of links) {
      const candidate = normalizeRoute(raw);
      if (candidate?.startsWith("/dashboard") && !seen.has(candidate) && !queue.includes(candidate)) queue.push(candidate);
    }
  }

  await context.close();
  return records;
}

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
const allRecords = [];
try {
  for (const viewport of viewports) allRecords.push(...await captureViewport(browser, viewport));
} finally {
  await browser.close();
}

const summary = { generatedAt: new Date().toISOString(), baseUrl, totalScreenshots: allRecords.length, viewports, pages: allRecords };
await fs.writeFile(path.join(outputRoot, "index.json"), JSON.stringify(summary, null, 2));

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const rows = allRecords.map((r) => `<tr><td>${escapeHtml(r.viewport)}</td><td><code>${escapeHtml(r.requestedRoute)}</code></td><td><code>${escapeHtml(r.finalPath)}</code></td><td>${escapeHtml(r.status)}</td><td>${r.loginRedirect ? "LOGIN REDIRECT" : r.notFound ? "NOT FOUND" : r.error ? "ERROR" : "CAPTURED"}</td><td><a href="${escapeHtml(r.screenshot)}">${escapeHtml(r.screenshot)}</a></td><td>${escapeHtml(r.error)}</td></tr>`).join("\n");
await fs.writeFile(path.join(outputRoot, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Hope Tender Screenshot Index</title><style>body{font:14px system-ui;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9}code{font-size:12px}</style></head><body><h1>Hope Tender App Screenshot Index</h1><p>Generated ${summary.generatedAt}. Total screenshots: ${summary.totalScreenshots}.</p><table><thead><tr><th>Viewport</th><th>Requested route</th><th>Final route</th><th>HTTP</th><th>Result</th><th>Screenshot</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);

console.log(`Captured ${allRecords.length} screenshots into ${outputRoot}`);
