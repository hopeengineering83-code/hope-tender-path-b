import { primaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const baseOrigin = new URL(baseURL).origin;

const ROUTES: Array<[label: string, path: string]> = [
  ["dashboard overview", "/dashboard"],
  ["active tenders", "/dashboard/tenders"],
  ["new tender", "/dashboard/tenders/new"],
  ["tender detail", `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`],
  ["tender command center", `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}/command-center`],
  ["tender report", `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}/report`],
  ["tender history", "/dashboard/history"],
  ["deadline calendar", "/dashboard/calendar"],
  ["company vault", "/dashboard/company"],
  ["company profile", "/dashboard/company/profile"],
  ["legacy data import", "/dashboard/company/plan-b-import"],
  ["company readiness", "/dashboard/company/readiness"],
  ["company diagnostics", "/dashboard/company/review"],
  ["company review board", "/dashboard/company/review-board"],
  ["matching", "/dashboard/matching"],
  ["compliance", "/dashboard/compliance"],
  ["documents", "/dashboard/documents"],
  ["export hub", "/dashboard/export"],
  ["analytics", "/dashboard/analytics"],
  ["activity", "/dashboard/activity"],
  ["search", "/dashboard/search"],
  ["setup", "/dashboard/setup"],
  ["analysis", "/dashboard/analysis"],
  ["assets", "/dashboard/assets"],
  ["settings", "/dashboard/settings"],
  ["account", "/dashboard/account"],
  ["admin root", "/dashboard/admin"],
  ["AI readiness", "/dashboard/admin/ai-readiness"],
  ["safety center", "/dashboard/admin/safety-center"],
  ["users", "/dashboard/users"],
  ["system", "/dashboard/system"],
];

type RuntimeEvidence = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  serverErrors: string[];
};

function attachRuntimeEvidence(page: Page) {
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
    const failure = request.failure()?.errorText ?? "unknown failure";
    if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return;
    if (new URL(request.url()).origin === baseOrigin) {
      evidence.failedRequests.push(`${request.method()} ${new URL(request.url()).pathname}: ${failure}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && new URL(response.url()).origin === baseOrigin) {
      evidence.serverErrors.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });

  return {
    evidence,
    reset() {
      evidence.consoleErrors.length = 0;
      evidence.pageErrors.length = 0;
      evidence.failedRequests.length = 0;
      evidence.serverErrors.length = 0;
    },
  };
}

async function unnamedVisibleControls(page: Page): Promise<string[]> {
  return page.locator("a[href],button,input,select,textarea").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      if (style.display === "none" || style.visibility === "hidden" || html.getClientRects().length === 0) return [];
      if (element instanceof HTMLInputElement && element.type === "hidden") return [];

      const labelledBy = html.getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ") ?? "";
      const explicitLabel = html.id
        ? document.querySelector(`label[for="${CSS.escape(html.id)}"]`)?.textContent?.trim() ?? ""
        : "";
      const wrappingLabel = html.closest("label")?.textContent?.trim() ?? "";
      const value = element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
        ? element.value
        : "";
      const name = [
        html.getAttribute("aria-label") ?? "",
        labelledBy,
        explicitLabel,
        wrappingLabel,
        html.getAttribute("title") ?? "",
        html.getAttribute("placeholder") ?? "",
        value,
        html.textContent?.trim() ?? "",
      ].find((candidate) => candidate.length > 0);

      if (name) return [];
      return [`${html.tagName.toLowerCase()}${html.id ? `#${html.id}` : ""}${html.className ? `.${String(html.className).split(/\s+/).slice(0, 2).join(".")}` : ""}`];
    }),
  );
}

async function deadVisibleLinks(page: Page): Promise<string[]> {
  return page.locator("a[href]").evaluateAll((links) =>
    links.flatMap((link) => {
      const element = link as HTMLAnchorElement;
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return [];
      const href = element.getAttribute("href")?.trim() ?? "";
      return !href || href === "#" || href.startsWith("javascript:") ? [href || "(empty href)"] : [];
    }),
  );
}

async function duplicateIds(page: Page): Promise<string[]> {
  return page.locator("[id]").evaluateAll((elements) => {
    const counts = new Map<string, number>();
    for (const element of elements) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => `${id} (${count})`);
  });
}

function expectSafeApiBody(body: string, label: string) {
  expect(body, `${label} must not expose private runtime details`).not.toMatch(
    /PrismaClient|prisma\.|stack trace|node_modules|postgresql:\/\/|SELECT\s+.+FROM|\/home\/|C:\\\\|Blob URL|VERCEL_BLOB|DATABASE_URL/i,
  );
}

test.describe.serial("PR #1175 independent principal QA release audit", () => {
  test("every authenticated route renders without hidden runtime failures or disconnected controls", async ({ page }) => {
    test.setTimeout(300_000);
    const monitor = attachRuntimeEvidence(page);

    for (const [label, route] of ROUTES) {
      monitor.reset();
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect.soft(response?.status(), `${label}: route response`).toBeLessThan(400);
      await expect.soft(page, `${label}: must remain authenticated`).not.toHaveURL(/\/login/);
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(150);

      expect.soft(await page.locator("main").count(), `${label}: page must expose a main landmark`).toBeGreaterThan(0);
      expect.soft(await page.locator("h1:visible,h2:visible").count(), `${label}: page must expose a visible heading`).toBeGreaterThan(0);
      expect.soft(await unnamedVisibleControls(page), `${label}: every visible control must have an accessible name`).toEqual([]);
      expect.soft(await deadVisibleLinks(page), `${label}: visible links must have real destinations`).toEqual([]);
      expect.soft(await duplicateIds(page), `${label}: DOM ids must be unique`).toEqual([]);
      expect.soft(monitor.evidence.consoleErrors, `${label}: browser console`).toEqual([]);
      expect.soft(monitor.evidence.pageErrors, `${label}: uncaught page errors`).toEqual([]);
      expect.soft(monitor.evidence.failedRequests, `${label}: failed same-origin requests`).toEqual([]);
      expect.soft(monitor.evidence.serverErrors, `${label}: 5xx same-origin responses`).toEqual([]);
    }
  });

  test("desktop and mobile navigation expose the same ADMIN destinations and the drawer is keyboard-safe", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    const desktopNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(desktopNavigation).toBeVisible();
    const desktopHrefs = await desktopNavigation.locator('a[href^="/dashboard"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)).sort(),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    const opener = page.getByRole("button", { name: "Open navigation" });
    await expect(opener).toBeVisible();
    await opener.click();
    const drawer = page.getByRole("dialog", { name: "Hope Tender" });
    await expect(drawer).toBeVisible();
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile primary navigation" });
    const mobileHrefs = await mobileNavigation.locator('a[href^="/dashboard"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)).sort(),
    );
    expect(mobileHrefs).toEqual(desktopHrefs);
    await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("safe expandable controls and tabs change state instead of acting as dead UI", async ({ page }) => {
    test.setTimeout(120_000);
    for (const route of ["/dashboard", "/dashboard/company", `/dashboard/tenders/${SEEDED_PRIMARY_TENDER_ID}`, "/dashboard/admin/ai-readiness"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);

      const expandableButtons = page.locator('button[aria-expanded="false"]:visible');
      for (let index = 0; index < Math.min(await expandableButtons.count(), 8); index += 1) {
        const button = expandableButtons.nth(index);
        const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? `button ${index}`;
        await button.click();
        await expect.soft(button, `${route}: expandable control '${name.trim()}' must update aria-expanded`).toHaveAttribute("aria-expanded", "true");
      }

      const tabs = page.locator('[role="tab"]:visible');
      for (let index = 0; index < Math.min(await tabs.count(), 6); index += 1) {
        const tab = tabs.nth(index);
        await tab.click();
        await expect.soft(tab, `${route}: clicked tab must become selected`).toHaveAttribute("aria-selected", "true");
      }
    }
  });

  test("temporary real-user tender flow reaches extraction and AI fallback while later release gates fail closed without runtime leakage", async ({ page }) => {
    test.setTimeout(180_000);
    const source = [
      "REQUEST FOR PROPOSAL — INDEPENDENT QA AUDIT",
      "Reference: PR1175-QA-001",
      "Submit a separate technical and financial proposal.",
      "Provide three project references, signed declarations, a work plan, and qualified key experts.",
      "Evaluation: methodology 40, experience 30, experts 20, work plan 10.",
    ].join("\n");

    const intake = await page.request.post("/api/tenders/upload-first", {
      multipart: {
        title: "PR1175 Independent QA Tender",
        reference: "PR1175-QA-001",
        file: { name: "pr1175-independent-qa.txt", mimeType: "text/plain", buffer: Buffer.from(source) },
      },
    });
    expect(intake.status(), await intake.text()).toBe(201);
    const tenderId = ((await intake.json()) as { tenderId: string }).tenderId;
    expect(tenderId).toBeTruthy();

    try {
      await page.goto(`/dashboard/tenders/${tenderId}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText("pr1175-independent-qa.txt")).toBeVisible();

      const sourceFiles = await page.request.get(`/api/tenders/${tenderId}/source-files`);
      expect(sourceFiles.status(), await sourceFiles.text()).toBe(200);
      const sourceJson = (await sourceFiles.json()) as { files: Array<{ extractedTextLength: number }> };
      expect(sourceJson.files.length).toBe(1);
      expect(sourceJson.files[0]?.extractedTextLength).toBeGreaterThan(0);

      const analyze = await page.request.post(`/api/tenders/${tenderId}/ai-analyze?force=true`);
      const analyzeBody = await analyze.text();
      expect(analyze.status(), analyzeBody).toBe(200);
      expectSafeApiBody(analyzeBody, "AI Analyze");
      const analyzeJson = JSON.parse(analyzeBody) as { success: boolean; analysisSource?: string; requirementCount?: number };
      expect(analyzeJson.success).toBe(true);
      expect(analyzeJson.analysisSource).toBe("REGEX_FALLBACK");
      expect(analyzeJson.requirementCount ?? 0).toBeGreaterThan(0);

      const approval = await page.request.post(`/api/tenders/${tenderId}/approve-analysis`, {
        data: { note: "Independent QA audit-only fallback review" },
      });
      const approvalBody = await approval.text();
      expect(approval.status(), approvalBody).toBe(200);
      expectSafeApiBody(approvalBody, "fallback approval");

      const gateChecks: Array<[label: string, method: "get" | "post", route: string]> = [
        ["Build Plan", "post", `/api/tenders/${tenderId}/build-plan`],
        ["Generation readiness", "get", `/api/tenders/${tenderId}/generation-readiness`],
        ["Generate", "post", `/api/tenders/${tenderId}/generate`],
        ["Export readiness", "get", `/api/tenders/${tenderId}/export-readiness`],
        ["PDF finalization", "post", `/api/tenders/${tenderId}/finalize-pdf`],
        ["ZIP export", "post", `/api/tenders/${tenderId}/export`],
      ];

      for (const [label, method, route] of gateChecks) {
        const response = method === "get" ? await page.request.get(route) : await page.request.post(route, { data: {} });
        const body = await response.text();
        expect(response.status(), `${label} route must exist`).not.toBe(404);
        expect(response.status(), `${label} must not crash`).toBeLessThan(500);
        expectSafeApiBody(body, label);
      }
    } finally {
      const cleanup = await page.request.delete(`/api/tenders/${tenderId}`);
      expect([200, 204]).toContain(cleanup.status());
    }
  });
});
