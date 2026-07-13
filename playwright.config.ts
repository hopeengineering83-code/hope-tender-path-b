import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isolatedFullAuth = process.env.E2E_FULL_AUTH === "true";
const hasGoldenAuth = process.env.E2E_GOLDEN_AUTH === "true";
const hasSmokeCreds = Boolean(process.env.SMOKE_TEST_EMAIL && process.env.SMOKE_TEST_PASSWORD);

const needsGlobalSetup = isolatedFullAuth || hasGoldenAuth || hasSmokeCreds;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  globalSetup: needsGlobalSetup ? "./e2e/global-setup.ts" : undefined,
  projects: [
    // ─── Anonymous desktop (no auth) ───────────────────────────────────
    {
      name: "chromium-anonymous",
      testDir: "./e2e/anonymous",
      use: { ...devices["Desktop Chrome"] },
    },
    // ─── Authenticated desktop (primary account) ───────────────────────
    // Runs all spec files in e2e/ EXCEPT those in e2e/anonymous/
    {
      name: "chromium-primary",
      testDir: "./e2e",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /anonymous/,
      use: {
        ...devices["Desktop Chrome"],
        storageState: needsGlobalSetup ? ".auth/primary-loopback.json" : undefined,
      },
    },
    // ─── Tablet authenticated (primary account, 800x1280) ──────────────
    {
      name: "samsung-tablet-primary",
      testDir: "./e2e",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /anonymous/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 1280 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        storageState: needsGlobalSetup ? ".auth/primary-loopback.json" : undefined,
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
