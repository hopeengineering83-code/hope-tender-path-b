import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isolatedFullAuth = process.env.E2E_FULL_AUTH === "true";
const hasGoldenAuth = process.env.E2E_GOLDEN_AUTH === "true";
const hasSmokeCreds = Boolean(process.env.SMOKE_TEST_EMAIL && process.env.SMOKE_TEST_PASSWORD);

// Global setup authenticates the seeded CI accounts once and saves storage
// state. Tests that need auth use test.use({ storageState: ... }) to opt in.
// Tests that test unauthenticated behavior (auth.spec.ts) do NOT set storageState.
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
        // No project-level storageState — each test file decides whether
        // to opt in via test.use({ storageState: ... }). This ensures
        // unauthenticated tests (auth.spec.ts) run without a session.
      },
    },
    {
      name: "samsung-tablet",
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
