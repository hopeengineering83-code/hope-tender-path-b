import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isolatedFullAuth = process.env.E2E_FULL_AUTH === "true";

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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
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
          // Full-auth CI runs against an isolated disposable database. Permit
          // the bounded DB file fallback only for that harness; production and
          // previews still require durable Blob/S3 storage.
          ALLOW_DB_FILE_STORAGE: isolatedFullAuth ? "true" : (process.env.ALLOW_DB_FILE_STORAGE ?? "false"),
        },
      },
});
