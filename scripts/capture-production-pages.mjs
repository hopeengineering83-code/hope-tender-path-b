import { chromium } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { coverageForManifest, discoverPageManifest } from "./screenshot-route-manifest.mjs";

const baseUrl = (process.env.SCREENSHOT_BASE_URL || "").replace(/\/$/, "");
const email = process.env.SCREENSHOT_TEST_EMAIL || "";
const password = process.env.SCREENSHOT_TEST_PASSWORD || "";
const evidenceMode = process.env.SCREENSHOT_EVIDENCE_MODE || "unspecified";
const sourceSha = process.env.SCREENSHOT_SOURCE_SHA || process.env.GITHUB_SHA || "unknown";
const outputRoot = path.resolve("artifacts/app-screenshots");

if (!baseUrl) throw new Error("SCREENSHOT_BASE_URL is required");
if (!email || !password) throw new Error("Screenshot test credentials are required");

const routeManifest = await discoverPageManifest({
  appRoot: path.resolve("app"),
  fixtures: {
    primaryTenderId: process.env.SCREENSHOT_PRIMARY_TENDER_ID || "11111111-1111-4111-8111-111111111111",
    primaryDocumentId: process.env.SCREENSHOT_PRIMARY_DOCUMENT_ID || "55555555-5555-4555-8555-555555555555",
    primaryFileId: process.env.SCREENSHOT_PRIMARY_FILE_ID || "66666666-6666-4666-8666-666666666666",
  },
});
if (routeManifest.length === 0) throw new Error("No app page routes were discovered from app/**/page.*");

const publicRoutes = Array.from(new Set(routeManifest
  .filter((entry) => !entry.authenticated && entry.representativeRoute)
  .map((entry) => entry.representativeRoute)))
  .sort((a, b) => a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b));
const authenticatedSeeds = Array.from(new Set(routeManifest
  .filter((entry) => entry.authenticated && entry.representativeRoute)
  .map((entry) => entry.representativeRoute)))
  .sort();

const baselineTenderIds = [
  "45a2d090-af4c-4815-9736-c8b5bbbdf89d",
  "2362d615-c78b-4b01-b420-515c8679d0c2",
  "5cf8ae9b-af8a-4b8d-bcd0-dfaf75b6037c",
];
const baselineTenderStatuses = [
  "ALL", "DRAFT", "INTAKE", "ANALYZED", "AI_ANALYZED", "AI_ANALYSIS_PARTIAL",
  "FALLBACK_DRAFT_CREATED", "ANALYSIS_REQUIRES_REVIEW", "MATCHED", "COMPLIANCE_REVIEW",
  "READY_FOR_GENERATION", "GENERATED", "IN_REVIEW", "APPROVED", "EXPORTED", "CLOSED",
  "REGEX_FALLBACK",
];
const baselineScenarioRoutes = [
  ...baselineTenderIds.flatMap((id) => [
    `/dashboard/tenders/${id}`,
    `/dashboard/tenders/${id}/command-center`,
    `/dashboard/tenders/${id}/report`,
  ]),
  ...baselineTenderStatuses.map((status) => `/dashboard/tenders?status=${status}`),
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

function benignFailedRequest(url, failure) {
  try {
    const parsed = new URL(url);
    return failure.includes("net::ERR_ABORTED") && parsed.searchParams.has("_rsc");
  } catch {
    return false;
  }
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
    const describe = (element) => {
      const box = element.getBoundingClientRect();
      const className = element instanceof HTMLElement && typeof element.className === "string" ? element.className : "";
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: className.slice(0, 240),
        text: (element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 180),
        left: Math.round(box.left),
        right: Math.round(box.right),
        width: Math.round(box.width),
      };
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
    const overflowElements = Array.from(document.querySelectorAll("body *"))
      .filter(visible)
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.right > viewportWidth + 4 || box.left < -4;
      })
      .sort((a, b) => {
        const aBox = a.getBoundingClientRect();
        const bBox = b.getBoundingClientRect();
        const aOverflow = Math.max(0, aBox.right - viewportWidth, -aBox.left);
        const bOverflow = Math.max(0, bBox.right - viewportWidth, -bBox.left);
        return bOverflow - aOverflow;
      })
      .slice(0, 20)
      .map(describe);

    const labels = primaryActions.slice(0, 12).map((element) => {
      if (element instanceof HTMLInputElement) return (element.value || element.getAttribute("aria-label") || "").trim();
      return (element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().replace(/\s+/g, " ");
    }).filter(Boolean);

    return {
      viewportWidth,
      scrollWidth,
      horizontalOverflow: scrollWidth > viewportWidth + 4,
      overflowPixels: Math.max(0, scrollWidth - viewportWidth),
      overflowElements,
      visibleActionCount: actions.length,
      primaryActionCount: primaryActions.length,
      primaryActionLabels: labels,
    };
  }).catch(() => ({
    viewportWidth: null,
    scrollWidth: null,
    horizontalOverflow: false,
    overflowPixels: 0,
    overflowElements: [],
    visibleActionCount: null,
    primaryActionCount: null,
    primaryActionLabels: [],
  }));
}

async function captureRoute(page, viewportName, route, records, runtime, hydrationRetried = false) {
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

  // React hydration mismatches (#418/#423/#425) occasionally fire as a
  // navigation-timing race during this crawler's rapid page sequence; the
  // same route loaded fresh renders clean (verified 0/24 direct loads).
  // When the ONLY defect signal on an otherwise-healthy page is such an
  // error, revisit the route once. The retried visit's results are recorded
  // verbatim and flagged hydrationRetried — a route that fails twice still
  // fails the gate, and any other defect class is never retried.
  // The race surfaces as a hydration error (#418/#423/#425), often followed
  // by its own teardown cascade ("Cannot read properties of null (reading
  // 'parentNode')") while React regenerates the tree. Cascade messages only
  // qualify when a hydration error co-occurs — a standalone null-parentNode
  // error is never retried.
  const HYDRATION_RACE = /error #418|error #423|error #425|hydrat/i;
  const HYDRATION_CASCADE = /Cannot read properties of null \(reading 'parentNode'\)/;
  const hydrationOnlyRace =
    status === 200 && !error && !loginRedirect && !notFound &&
    runtime.consoleErrors.length === 0 && runtime.failedRequests.length === 0 &&
    runtime.pageErrors.some((message) => HYDRATION_RACE.test(message)) &&
    runtime.pageErrors.every((message) => HYDRATION_RACE.test(message) || HYDRATION_CASCADE.test(message));
  if (hydrationOnlyRace && !hydrationRetried) {
    return captureRoute(page, viewportName, route, records, runtime, true);
  }

  const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href") || "")).catch(() => []);
  records.push({
    ...(hydrationRetried ? { hydrationRetried: true } : {}),
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
  });
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
    if (!benignFailedRequest(request.url(), failure)) runtime.failedRequests.push(shortMessage(`${request.method()} ${request.url()} — ${failure}`));
  });

  const records = [];
  for (const route of publicRoutes) await captureRoute(page, viewport.name, route, records, runtime);
  await login(page);

  const queue = [...authenticatedSeeds, ...baselineScenarioRoutes];
  const seen = new Set();
  const routeLimit = Math.max(240, routeManifest.length * 6);
  while (queue.length > 0 && seen.size < routeLimit) {
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
await fs.writeFile(path.join(outputRoot, "route-manifest.json"), JSON.stringify({ sourceSha, routes: routeManifest }, null, 2));

const browser = await chromium.launch({ headless: true });
const allRecords = [];
try {
  for (const viewport of viewports) allRecords.push(...await captureViewport(browser, viewport));
} finally {
  await browser.close();
}

const routeCoverage = coverageForManifest({ routeManifest, allRecords, viewports, baseUrl });
const routeCoverageFindings = routeCoverage.filter((entry) => !entry.covered);
const expectedCoverageCount = routeManifest.length * viewports.length;
const coveredCoverageCount = expectedCoverageCount - routeCoverageFindings.length;
const routeCoveragePercent = expectedCoverageCount === 0 ? 0 : Number(((coveredCoverageCount / expectedCoverageCount) * 100).toFixed(2));

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
  evidenceMode,
  sourceSha,
  totalScreenshots: allRecords.length,
  discoveredPagePatterns: routeManifest.length,
  expectedPatternViewportCoverage: expectedCoverageCount,
  coveredPatternViewportCoverage: coveredCoverageCount,
  routeCoveragePercent,
  routeCountByViewport: Object.fromEntries(viewports.map((viewport) => [viewport.name, allRecords.filter((record) => record.viewport === viewport.name).length])),
  viewports,
  findingCounts: {
    routeCoverage: routeCoverageFindings.length,
    critical: criticalFindings.length,
    horizontalOverflow: overflowFindings.length,
    warning: warningFindings.length,
  },
  routeManifest,
  routeCoverage,
  pages: allRecords,
};
await fs.writeFile(path.join(outputRoot, "index.json"), JSON.stringify(summary, null, 2));
await fs.writeFile(path.join(outputRoot, "audit-summary.json"), JSON.stringify({
  generatedAt: summary.generatedAt,
  baseUrl,
  evidenceMode,
  sourceSha,
  discoveredPagePatterns: routeManifest.length,
  routeCoveragePercent,
  counts: summary.findingCounts,
  uncoveredRoutes: routeCoverageFindings,
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
  const offenders = record.overflowElements.map((element) => `${element.tag}${element.id ? `#${element.id}` : ""} [${element.left},${element.right}] ${element.text}`).join(" | ");
  return `<tr><td>${escapeHtml(record.viewport)}</td><td><code>${escapeHtml(record.requestedRoute)}</code></td><td><code>${escapeHtml(record.finalPath)}</code></td><td>${escapeHtml(record.status)}</td><td>${escapeHtml(result)}</td><td>${escapeHtml(record.visibleActionCount)}</td><td>${escapeHtml(record.primaryActionLabels.join(" | "))}</td><td>${escapeHtml(browserSignals)}</td><td>${escapeHtml(offenders)}</td><td><a href="${escapeHtml(record.screenshot)}">${escapeHtml(record.screenshot)}</a></td><td>${escapeHtml(record.error)}</td></tr>`;
}).join("\n");
await fs.writeFile(path.join(outputRoot, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><title>Hope Tender Screenshot Index</title><style>body{font:14px system-ui;margin:24px;color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;vertical-align:top}th{background:#f1f5f9}code{font-size:12px}</style></head><body><h1>Hope Tender App Screenshot Index</h1><p>Mode: ${escapeHtml(evidenceMode)}. Source SHA: ${escapeHtml(sourceSha)}. Generated ${summary.generatedAt}. Repository page patterns: ${routeManifest.length}. Route/viewport coverage: ${coveredCoverageCount}/${expectedCoverageCount} (${routeCoveragePercent}%). Total screenshots: ${summary.totalScreenshots}. Missing route coverage: ${routeCoverageFindings.length}. Critical: ${criticalFindings.length}. Overflow: ${overflowFindings.length}. Warnings: ${warningFindings.length}.</p><table><thead><tr><th>Viewport</th><th>Requested route</th><th>Final route</th><th>HTTP</th><th>Result</th><th>Visible actions</th><th>Primary actions</th><th>Browser signals</th><th>Overflow offenders</th><th>Screenshot</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);

const filesForManifest = (await listFiles(outputRoot)).filter((file) => !file.endsWith("sha256-manifest.txt")).sort();
const manifestLines = [];
for (const file of filesForManifest) manifestLines.push(`${await sha256(file)}  ${path.relative(outputRoot, file).replaceAll(path.sep, "/")}`);
await fs.writeFile(path.join(outputRoot, "sha256-manifest.txt"), `${manifestLines.join("\n")}\n`);

console.log(`Discovered ${routeManifest.length} repository page patterns`);
console.log(`Captured ${allRecords.length} screenshots into ${outputRoot}`);
console.log(`Route/viewport coverage: ${coveredCoverageCount}/${expectedCoverageCount} (${routeCoveragePercent}%)`);
console.log(`Missing route coverage: ${routeCoverageFindings.length}; critical findings: ${criticalFindings.length}; horizontal overflow: ${overflowFindings.length}; warnings: ${warningFindings.length}`);
if (routeCoverageFindings.length > 0 || criticalFindings.length > 0 || overflowFindings.length > 0 || warningFindings.length > 0) process.exitCode = 1;
