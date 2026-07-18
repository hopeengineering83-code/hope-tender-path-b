import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
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

function shortMessage(value, limit = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
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

async function inspectLayout(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && box.width > 1 && box.height > 1;
    };

    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(root?.scrollWidth ?? 0, body?.scrollWidth ?? 0);
    const actions = Array.from(document.querySelectorAll('button, a[href], input[type="submit"], input[type="button"], [role="button"]')).filter(visible);
    const primaryActions = actions.filter((element) => {
      const classes = element instanceof HTMLElement ? element.className : "";
      return element.hasAttribute("data-primary-action") ||
        element.matches('button[type="submit"], input[type="submit"]') ||
        /bg-(?:slate-9|blue-6|blue-7|green-6|emerald-6|black)/.test(String(classes));
    });

    const labels = primaryActions.slice(0, 12).map((element) => {
      if (element instanceof HTMLInputElement) return (element.value || element.getAttribute("aria-label") || "").trim();
      return (element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
    }).filter(Boolean);

    return {
      viewportWidth,
      scrollWidth,
      horizontalOverflow: scrollWidth > viewportWidth + 4,
      overflowPixels: Math.max(0, scrollWidth - viewportWidth),
      visibleActionCount: actions.length,
      primaryActionCount: primaryActions.length,
      primaryActionLabels: labels,
    };
  }).catch(() => ({
    viewportWidth: null,
    scrollWidth: null,
    horizontalOverflow: false,
    overflowPixels: 0,
    visibleActionCount: null,
    primaryActionCount: null,
    primaryActionLabels: [],
  }));
}

async function captureRoute(page, viewportName, route, records, runtime) {
  runtime.consoleErrors.length = 0;
  runtime.pageErrors.length = 0;
  runtime.failedRequests.length = 0;

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
  const notFound = /page not found|\b404\b/i.test(bodyText.slice(0, 1800));
  const layout = await inspectLayout(page);
  const screenshotName = `${String(records.length + 1).padStart(3, "0")}-${fileSlug(route)}.png`;
  const screenshotPath = path.join(outputRoot, viewportName, screenshotName);

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" }).catch((err) => {
    error = `${error ? `${error}; ` : ""}screenshot: ${err instanceof Error ? err.message : String(err)}`;
  });

  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") || "")).catch(() => []);
  const record = {
    viewport: viewportName,
    requestedRoute: route,
    finalPath,
    status,
    title,
    screenshot: `${viewportName}/${screenshotName}`,
    loginRedirect,
    notFound,
    error,
    ...layout,
    consoleErrors: [...runtime.consoleErrors],
    pageErrors: [...runtime.pageErrors],
    failedRequests: [...runtime.failedRequests],
  };
  records.push(record);
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

  const runtime = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error") runtime.consoleErrors.push(shortMessage(message.text()));
  });
  page.on("pageerror", (err) => runtime.pageErrors.push(shortMessage(err instanceof Error ? err.message : err)));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "request failed";
    runtime.failedRequests.push(shortMessage(`${request.method()} ${request.url()} — ${failure}`));
  });

  const records = [];
  for (const route of publicRoutes) await captureRoute(page, viewport.name, route, records, runtime);
  await login(page);

  const queue = [...authenticatedSeeds];
  const seen = new Set();
  while (queue.length > 0 && seen.size < 120) {
    const route = normalizeRoute(queue.shift());
    if (!route || seen.has(route) || !route.startsWith("/dashboard")) continue;
    seen.add(route);
    const links = await captureRoute(page, viewport.name, route, records, runtime);
    for (const raw of links) {
      const candidate = normalizeRoute(raw);
      if (candidate?.startsWith("/dashboard") && !seen.has(candidate) && !queue.includes(candidate)) queue.push(candidate);
    }
  }

  await context.close();
  return records;
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
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

const criticalFindings = allRecords.filter((record) =>
  record.loginRedirect ||
  record.notFound ||
  Boolean(record.error) ||
  (typeof record.status === "number" && record.status >= 400) ||
  record.pageErrors.length > 0,
);
const overflowFindings = allRecords.filter((record) => record.horizontalOverflow);
const warningFindings = allRecords.filter((record) =>
  record.consoleErrors.length > 0 ||
  record.failedRequests.length > 0 ||
  (record.requestedRoute.startsWith("/dashboard") && record.visibleActionCount === 0),
);

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  totalScreenshots: allRecords.length,
  routeCountByViewport: Object.fromEntries(viewports.map((viewport) => [viewport.name, allRecords.filter((record) => record.viewport === viewport.name).length])),
  viewports,
  findingCounts: {
    critical: criticalFindings.length,
    horizontalOverflow: overflowFindings.length,
    warning: warningFindings.length,
  },
  pages: allRecords,
};
await fs.writeFile(path.join(outputRoot, "index.json"), JSON.stringify(summary, null, 2));
await fs.writeFile(path.join(outputRoot, "audit-summary.json"), JSON.stringify({
  generatedAt: summary.generatedAt,
  baseUrl,
  counts: summary.findingCounts,
  critical: criticalFindings,
  horizontalOverflow: overflowFindings,
  warnings: warningFindings,
}, null, 2));

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const rows = allRecords.map((record) => {
  const result = record.loginRedirect ? "LOGIN REDIRECT" : record.notFound ? "NOT FOUND" : record.error ? "ERROR" : record.horizontalOverflow ? `OVERFLOW +${record.overflowPixels}px` : "CAPTURED";
  const browserSignals = [
    record.pageErrors.length ? `page errors: ${record.pageErrors.length}` : "",
    record.consoleErrors.length ? `console errors: ${record.consoleErrors.length}` : "",
    record.failedRequests.length ? `failed requests: ${record.failedRequests.length}` : "",
  ].filter(Boolean).join("; ");
  return `<tr><td>${escapeHtml(record.viewport)}</td><td><code>${escapeHtml(record.requestedRoute)}</code></td><td><code>${escapeHtml(record.finalPath)}</code></td><td>${escapeHtml(record.status)}</td><td>${escapeHtml(result)}</td><td>${escapeHtml(record.visibleActionCount)}</td><td>${escapeHtml(record.primaryActionLabels.join(" | "))}</td><td>${escapeHtml(browserSignals)}</td><td><a href="${escapeHtml(record.screenshot)}">${escapeHtml(record.screenshot)}</a></td><td>${escapeHtml(record.error)}</td></tr>`;
}).join("\n");
await fs.writeFile(path.join(outputRoot, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Hope Tender Screenshot Index</title><style>body{font:14px system-ui;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9}code{font-size:12px}</style></head><body><h1>Hope Tender App Screenshot Index</h1><p>Generated ${summary.generatedAt}. Total screenshots: ${summary.totalScreenshots}. Critical: ${criticalFindings.length}. Overflow: ${overflowFindings.length}. Warnings: ${warningFindings.length}.</p><table><thead><tr><th>Viewport</th><th>Requested route</th><th>Final route</th><th>HTTP</th><th>Result</th><th>Visible actions</th><th>Primary actions</th><th>Browser signals</th><th>Screenshot</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);

const filesForManifest = (await listFiles(outputRoot)).filter((file) => !file.endsWith("sha256-manifest.txt")).sort();
const manifestLines = [];
for (const file of filesForManifest) manifestLines.push(`${await sha256(file)}  ${path.relative(outputRoot, file).replaceAll(path.sep, "/")}`);
await fs.writeFile(path.join(outputRoot, "sha256-manifest.txt"), `${manifestLines.join("\n")}\n`);

console.log(`Captured ${allRecords.length} screenshots into ${outputRoot}`);
console.log(`Critical findings: ${criticalFindings.length}; horizontal overflow: ${overflowFindings.length}; warnings: ${warningFindings.length}`);
if (criticalFindings.length > 0 || overflowFindings.length > 0) process.exitCode = 1;
