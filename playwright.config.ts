import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isolatedFullAuth = process.env.E2E_FULL_AUTH === "true";
const hasGoldenAuth = process.env.E2E_GOLDEN_AUTH === "true";
const hasSmokeCreds = Boolean(process.env.SMOKE_TEST_EMAIL && process.env.SMOKE_TEST_PASSWORD);

// Global setup authenticates the seeded CI accounts once and saves storage
// state. Tests reuse the saved state instead of logging in repeatedly.
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
  // Global setup authenticates once per CI run, saving storage state that
  // tests reuse. This prevents 429 LOGIN_RATE_LIMITED from repeated logins.
  globalSetup: needsGlobalSetup ? "./e2e/global-setup.ts" : undefined,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Reuse the authenticated storage state when available (CI mode).
        // In local dev (no globalSetup), this is undefined and tests
        // handle their own authentication.
        storageState: needsGlobalSetup ? ".auth/primary.json" : undefined,
      },
    },
    // Tablet project using Chromium engine (not WebKit) so it works in CI
    // where only Chromium browsers are installed. We override the viewport
    // and userAgent to simulate tablet form factors without requiring
    // separate browser binaries.
    {
      name: "samsung-tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 800, height: 1280 },
        userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X916B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        // Same primary storage state — no additional login needed.
        storageState: needsGlobalSetup ? ".auth/primary.json" : undefined,
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
