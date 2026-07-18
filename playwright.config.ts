import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isolatedFullAuth = process.env.E2E_FULL_AUTH === "true";

// Desktop-only authenticated specs — these exercise the full app at desktop
// viewport and must run exactly once per CI run. They are deliberately NOT
// matched by samsung-tablet-primary below, so login sessions and full-suite
// runs (golden workflow, tender pipeline, cross-user isolation, production
// smoke) are never duplicated across projects.
const DESKTOP_AUTHENTICATED_SPECS = [
  "golden-tender-workflow.spec.ts",
  "production-smoke.spec.ts",
  "tender-pipeline.spec.ts",
  "cross-user-isolation.spec.ts",
  "health.spec.ts",
  "manual-tender-facts-flexibility.spec.ts",
  "share-link.spec.ts",
  "tender-list.spec.ts",
  "mobile-overflow-gap-repair.spec.ts",
  "full-route-mobile-tablet-overflow.spec.ts",
  "workflow-control-center-action-buttons.spec.ts",
];

// Tablet-authenticated contract specs validate responsive UI, role-aware
// navigation, and the settings API used by that UI. They reuse the one primary
// session created by global setup.
const TABLET_AUTHENTICATED_SPECS = [
  "tablet-universal-tender-intelligence.spec.ts",
  "settings-api-contract.spec.ts",
  "dashboard-role-navigation.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  // Logs in the primary and secondary accounts exactly once each via the
  // real /api/auth/login endpoint and saves the session cookie for
  // e2e/auth-helper.ts's fixtures. See e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // ─── Anonymous desktop (no auth) ───────────────────────────────────
    {
      name: "chromium-anonymous",
      testDir: "./e2e/anonymous",
      use: { ...devices["Desktop Chrome"] },
    },
    // ─── Authenticated desktop (primary + secondary accounts) ──────────
    {
      name: "chromium-primary",
      testDir: "./e2e",
      testMatch: DESKTOP_AUTHENTICATED_SPECS,
      use: { ...devices["Desktop Chrome"] },
    },
    // ─── Tablet authenticated (primary account, 800x1280) ──────────────
    {
      name: "samsung-tablet-primary",
      testDir: "./e2e",
      testMatch: TABLET_AUTHENTICATED_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 1280 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    // ─── Tablet anonymous ──────────────────────────────────────────────
    {
      name: "samsung-tablet-anonymous",
      testDir: "./e2e/anonymous",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 1280 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3000",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          NEXT_TELEMETRY_DISABLED: "1",
          DATABASE_URL: process.env.DATABASE_URL || "postgresql://placeholder:placeholder@localhost:5432/placeholder",
          ALLOW_DB_FILE_STORAGE: isolatedFullAuth ? "true" : (process.env.ALLOW_DB_FILE_STORAGE ?? "false"),
        },
      },
});
