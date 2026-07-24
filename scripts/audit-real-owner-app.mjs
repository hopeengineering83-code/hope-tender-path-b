import { chromium, request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseURL = (process.env.AUDIT_BASE_URL || "").replace(/\/$/, "");
const email = process.env.REAL_APP_EMAIL || "";
const password = process.env.REAL_APP_PASSWORD || "";
const bypass = process.env.VERCEL_BYPASS || "";
const outputDir = path.resolve("real-app-audit");

if (!baseURL) throw new Error("AUDIT_BASE_URL is required");
if (!email || !password) throw new Error("Real-account credentials are not configured in GitHub Actions secrets");

await mkdir(outputDir, { recursive: true });

const extraHTTPHeaders = bypass
  ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
  : {};

const api = await request.newContext({ baseURL, extraHTTPHeaders });
const login = await api.post("/api/auth/login", { data: { email, password } });
if (login.status() !== 200) {
  throw new Error(`Real-account login failed with HTTP ${login.status()}`);
}
const storageState = await api.storageState();
await api.dispose();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  storageState,
  extraHTTPHeaders,
  ignoreHTTPSErrors: false,
});

const seedRoutes = [
  "/dashboard",
  "/dashboard/company",
  "/dashboard/company/profile",
  "/dashboard/company/readiness",
  "/dashboard/company/review",
  "/dashboard/company/review-board",
  "/dashboard/company/plan-b-import",
  "/dashboard/assets",
  "/dashboard/tenders",
  "/dashboard/settings",
];

const routes = new Set(seedRoutes);
const queue = [...seedRoutes];
const visitedDiscovery = new Set();
const globalConsoleErrors = [];
const globalPageErrors = [];
const globalFailedResponses = [];

function safeRoute(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw, baseURL);
    if (url.origin !== new URL(baseURL).origin) return null;
    if (!url.pathname.startsWith("/dashboard")) return null;
    if (/\/(logout|download|delete|remove|archive)(\/|$)/i.test(url.pathname)) return null;
    url.hash = "";
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

async function discoverRoutes() {
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") globalConsoleErrors.push({ route: page.url(), text: msg.text().slice(0, 500) });
  });
  page.on("pageerror", (error) => globalPageErrors.push({ route: page.url(), text: String(error).slice(0, 500) }));
  page.on("response", (response) => {
    if (response.status() >= 400) globalFailedResponses.push({ route: page.url(), url: response.url(), status: response.status() });
  });

  while (queue.length && visitedDiscovery.size < 120) {
    const route = queue.shift();
    if (!route || visitedDiscovery.has(route)) continue;
    visitedDiscovery.add(route);
    try {
      await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(800);
      if (/\/login(?:\?|$)/.test(new URL(page.url()).pathname)) {
        throw new Error("Session redirected to login");
      }
      const hrefs = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")));
      for (const href of hrefs) {
        const candidate = safeRoute(href);
        if (candidate && !routes.has(candidate)) {
          routes.add(candidate);
          queue.push(candidate);
        }
      }
    } catch (error) {
      globalPageErrors.push({ route, text: `Discovery failed: ${String(error).slice(0, 500)}` });
    }
  }
  await page.close();
}

await discoverRoutes();

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "mobile", width: 390, height: 844 },
];

const report = {
  generatedAt: new Date().toISOString(),
  baseURL,
  routeCount: routes.size,
  routes: [...routes].sort(),
  viewports: {},
  globalConsoleErrors,
  globalPageErrors,
  globalFailedResponses,
};

for (const viewport of viewports) {
  const page = await context.newPage();
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const results = [];

  for (const route of [...routes].sort()) {
    const localConsole = [];
    const localPageErrors = [];
    const localResponses = [];
    const onConsole = (msg) => { if (msg.type() === "error") localConsole.push(msg.text().slice(0, 500)); };
    const onPageError = (error) => localPageErrors.push(String(error).slice(0, 500));
    const onResponse = (response) => {
      if (response.status() >= 400) localResponses.push({ url: response.url(), status: response.status() });
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("response", onResponse);

    let navigationError = null;
    try {
      await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(900);
    } catch (error) {
      navigationError = String(error).slice(0, 500);
    }

    const finalURL = page.url();
    const redirectedToLogin = (() => {
      try { return new URL(finalURL).pathname === "/login"; } catch { return false; }
    })();

    let audit = {};
    if (!navigationError && !redirectedToLogin) {
      audit = await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], summary')].filter(visible);
        const items = interactive.map((el, index) => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          const text = clean(el.innerText || el.value || "");
          const aria = clean(el.getAttribute("aria-label"));
          const title = clean(el.getAttribute("title"));
          const label = aria || text || title;
          return {
            index,
            tag: el.tagName.toLowerCase(),
            label: label.slice(0, 180),
            text: text.slice(0, 180),
            aria,
            title,
            href: el instanceof HTMLAnchorElement ? el.getAttribute("href") : null,
            disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
            pointerEvents: style.pointerEvents,
            cursor: style.cursor,
            backgroundColor: style.backgroundColor,
            color: style.color,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            svgCount: el.querySelectorAll("svg").length,
          };
        });

        const labelGroups = new Map();
        for (const item of items) {
          const key = item.label.toLowerCase();
          if (!key) continue;
          const group = labelGroups.get(key) || [];
          group.push(item);
          labelGroups.set(key, group);
        }
        const duplicateLabels = [...labelGroups.entries()]
          .filter(([, group]) => group.length > 1)
          .map(([label, group]) => ({ label, count: group.length, targets: group.map((x) => x.href || x.tag) }));

        const disabled = items.filter((item) => item.disabled || item.pointerEvents === "none");
        const unnamedIconControls = items.filter((item) => !item.label && item.svgCount > 0);
        const hrefGroups = new Map();
        for (const item of items.filter((x) => x.href)) {
          const group = hrefGroups.get(item.href) || [];
          group.push(item.label);
          hrefGroups.set(item.href, group);
        }
        const duplicateDestinations = [...hrefGroups.entries()]
          .filter(([, labels]) => labels.length > 1)
          .map(([href, labels]) => ({ href, labels }));

        const primaryCandidates = items.filter((item) => {
          const bg = item.backgroundColor;
          return item.tag === "button" || item.tag === "a"
            ? /rgb\((0|15|17|22|30|31|33|37|5|6|7|8|9),/.test(bg) || /rgb\([^)]*,\s*(9[0-9]|1[0-5][0-9]),/.test(bg)
            : false;
        });

        const overlaps = [];
        for (let i = 0; i < items.length; i++) {
          for (let j = i + 1; j < items.length; j++) {
            const a = items[i].rect;
            const b = items[j].rect;
            const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
            const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
            const area = w * h;
            if (!area) continue;
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (smaller > 0 && area / smaller > 0.35) {
              overlaps.push({ a: items[i].label || `${items[i].tag}#${i}`, b: items[j].label || `${items[j].tag}#${j}` });
            }
          }
        }

        const body = clean(document.body.innerText).toLowerCase();
        const contradictionRules = [
          ["analysis appears usable", "no usable extracted text"],
          ["completed", "failed"],
          ["ready", "blocked"],
          ["0 extracted", "analysis appears usable"],
          ["no gaps", "critical"],
          ["success", "cannot"],
        ];
        const contradictions = contradictionRules
          .filter(([a, b]) => body.includes(a) && body.includes(b))
          .map(([a, b]) => `${a} <> ${b}`);

        const standaloneClickableIcons = [...document.querySelectorAll("svg")]
          .filter(visible)
          .filter((svg) => {
            const parentInteractive = svg.closest('button, a[href], [role="button"], summary');
            const style = getComputedStyle(svg);
            return !parentInteractive && (style.cursor === "pointer" || svg.hasAttribute("onclick"));
          }).length;

        return {
          title: document.title,
          headings: [...document.querySelectorAll("h1,h2")].filter(visible).map((h) => clean(h.textContent).slice(0, 180)),
          bodyExcerpt: clean(document.body.innerText).slice(0, 1000),
          interactiveCount: items.length,
          items,
          disabled,
          unnamedIconControls,
          duplicateLabels,
          duplicateDestinations,
          primaryCandidates,
          overlaps,
          contradictions,
          standaloneClickableIcons,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: window.innerWidth,
        };
      });

      const actionabilityFailures = [];
      const controls = page.locator('button:visible, a[href]:visible, [role="button"]:visible, summary:visible');
      const controlCount = Math.min(await controls.count(), 160);
      for (let i = 0; i < controlCount; i++) {
        const control = controls.nth(i);
        const disabled = await control.isDisabled().catch(() => false);
        if (disabled) continue;
        try {
          await control.click({ trial: true, timeout: 1000 });
        } catch (error) {
          const label = await control.getAttribute("aria-label") || await control.innerText().catch(() => "") || await control.getAttribute("title") || `control-${i}`;
          actionabilityFailures.push({ label: String(label).replace(/\s+/g, " ").trim().slice(0, 160), error: String(error).split("\n")[0].slice(0, 300) });
        }
      }
      audit.actionabilityFailures = actionabilityFailures;

      const safeName = route.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-") || "root";
      await page.screenshot({ path: path.join(outputDir, `${viewport.name}-${safeName}.png`), fullPage: true });
    }

    results.push({ route, finalURL, redirectedToLogin, navigationError, consoleErrors: localConsole, pageErrors: localPageErrors, failedResponses: localResponses, audit });
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }

  report.viewports[viewport.name] = results;
  await page.close();
}

await browser.close();

const allRows = Object.values(report.viewports).flat();
const summary = {
  routesAudited: allRows.length,
  uniqueRoutes: routes.size,
  navigationFailures: allRows.filter((r) => r.navigationError || r.redirectedToLogin).length,
  pagesWithConsoleErrors: allRows.filter((r) => r.consoleErrors.length).length,
  pagesWithFailedResponses: allRows.filter((r) => r.failedResponses.length).length,
  pagesWithOverflow: allRows.filter((r) => r.audit?.horizontalOverflow).length,
  disabledOrFrozenControls: allRows.reduce((n, r) => n + (r.audit?.disabled?.length || 0), 0),
  nonActionableEnabledControls: allRows.reduce((n, r) => n + (r.audit?.actionabilityFailures?.length || 0), 0),
  unnamedIconControls: allRows.reduce((n, r) => n + (r.audit?.unnamedIconControls?.length || 0), 0),
  standaloneClickableIcons: allRows.reduce((n, r) => n + (r.audit?.standaloneClickableIcons || 0), 0),
  duplicateActionLabels: allRows.reduce((n, r) => n + (r.audit?.duplicateLabels?.length || 0), 0),
  duplicateDestinations: allRows.reduce((n, r) => n + (r.audit?.duplicateDestinations?.length || 0), 0),
  interactiveOverlaps: allRows.reduce((n, r) => n + (r.audit?.overlaps?.length || 0), 0),
  contradictionSignals: allRows.reduce((n, r) => n + (r.audit?.contradictions?.length || 0), 0),
};
report.summary = summary;

const worstPages = allRows
  .map((r) => ({
    viewport: Object.entries(report.viewports).find(([, rows]) => rows.includes(r))?.[0],
    route: r.route,
    score: (r.audit?.disabled?.length || 0) + (r.audit?.duplicateLabels?.length || 0) + (r.audit?.actionabilityFailures?.length || 0) + (r.audit?.contradictions?.length || 0) * 3 + (r.audit?.horizontalOverflow ? 5 : 0) + r.consoleErrors.length * 3 + r.failedResponses.length * 2,
    disabled: r.audit?.disabled?.length || 0,
    duplicateLabels: r.audit?.duplicateLabels?.length || 0,
    nonActionable: r.audit?.actionabilityFailures?.length || 0,
    contradictions: r.audit?.contradictions || [],
    overflow: Boolean(r.audit?.horizontalOverflow),
    consoleErrors: r.consoleErrors.length,
    failedResponses: r.failedResponses.length,
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 30);

const markdown = [
  "# Real owner-account application audit",
  "",
  `Generated: ${report.generatedAt}`,
  `Base URL: ${baseURL}`,
  "",
  "## Summary",
  "",
  ...Object.entries(summary).map(([key, value]) => `- **${key}:** ${value}`),
  "",
  "## Highest-risk pages",
  "",
  "| Viewport | Route | Risk | Disabled/frozen | Duplicate labels | Non-actionable | Contradictions | Overflow | Console errors | Failed responses |",
  "|---|---|---:|---:|---:|---:|---|---|---:|---:|",
  ...worstPages.map((p) => `| ${p.viewport} | ${p.route} | ${p.score} | ${p.disabled} | ${p.duplicateLabels} | ${p.nonActionable} | ${p.contradictions.join("; ") || "—"} | ${p.overflow ? "yes" : "no"} | ${p.consoleErrors} | ${p.failedResponses} |`),
  "",
  "The JSON report contains every route, control, label, destination, disabled state, actionability failure, overlap, contradiction signal, console error and failed response.",
].join("\n");

await writeFile(path.join(outputDir, "audit-report.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(outputDir, "audit-summary.md"), markdown);
console.log(JSON.stringify(summary));
