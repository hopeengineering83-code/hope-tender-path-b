import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  webServer: {
    command: "npm run dev",
    url: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test",
      SESSION_SECRET: process.env.SESSION_SECRET || "playwright-session-secret-with-enough-bytes-abcdef0123456789-padding",
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "playwright-nextauth-secret-with-enough-bytes-abcdef0123456789",
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || "AIzaPlaywrightKeyNotUsedAtRuntime123456789012345",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      E2E_FULL_AUTH: process.env.E2E_FULL_AUTH || "false",
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
