import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { primaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

const SEEDED_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const EVIDENCE_DIRECTORY = resolve("test-results/acceptance-evidence/screenshots");

type RuntimeEvidence = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  serverErrors: string[];
};

function monitorRuntime(page: Page): RuntimeEvidence {
  const evidence: RuntimeEvidence = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return;
    evidence.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${failure}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      evidence.serverErrors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  return evidence;
}

test("exact-head desktop, tablet, and mobile screenshot audit is free of overflow and runtime errors", async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const runtime = monitorRuntime(page);
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const cases = [
    { name: "desktop-dashboard", width: 1440, height: 1000, route: "/dashboard" },
    { name: "tablet-review-inbox", width: 800, height: 1280, route: "/dashboard/company/review" },
    { name: "mobile-tender", width: 390, height: 844, route: `/dashboard/tenders/${SEEDED_TENDER_ID}` },
  ];
  const summary: Array<Record<string, unknown>> = [];

  for (const item of cases) {
    runtime.consoleErrors.length = 0;
    runtime.pageErrors.length = 0;
    runtime.failedRequests.length = 0;
    runtime.serverErrors.length = 0;

    await page.setViewportSize({ width: item.width, height: item.height });
    const response = await page.goto(item.route, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${item.name}: HTTP status`).toBeLessThan(400);
    await expect(page, `${item.name}: authentication`).not.toHaveURL(/\/login/);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await expect(page.locator("main")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(dimensions.documentWidth, `${item.name}: document overflow`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.bodyWidth, `${item.name}: body overflow`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(runtime.consoleErrors, `${item.name}: console errors`).toEqual([]);
    expect(runtime.pageErrors, `${item.name}: page errors`).toEqual([]);
    expect(runtime.failedRequests, `${item.name}: failed requests`).toEqual([]);
    expect(runtime.serverErrors, `${item.name}: 5xx responses`).toEqual([]);

    const screenshotPath = resolve(EVIDENCE_DIRECTORY, `${item.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.push({
      ...item,
      headSha,
      finalUrl: page.url(),
      title: await page.title(),
      dimensions,
      screenshot: `${item.name}.png`,
      runtime,
    });
  }

  await writeFile(
    resolve(EVIDENCE_DIRECTORY, "summary.json"),
    JSON.stringify({ headSha, cases: summary }, null, 2),
    "utf8",
  );
});
