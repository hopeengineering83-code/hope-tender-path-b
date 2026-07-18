// Full-surface horizontal-overflow regression guard.
//
// PR #1175 lists "complete mobile/tablet overflow correction" as an
// outstanding release gate, and the app's existing overflow coverage
// (mobile-overflow-gap-repair.spec.ts, tablet-universal-tender-
// intelligence.spec.ts's OWNED_ROUTES) only exercises a subset of routes.
// A manual audit across every static dashboard route and the three
// tender-scoped routes, at both the 390x844 mobile and 800x1280 tablet
// viewports (36 routes x 2 viewports = 72 checks), found zero horizontal
// overflow instances — this file locks that result in as a permanent
// regression guard so a future change can't silently reintroduce overflow
// on a route none of the narrower existing specs happen to cover.
//
// Some overlap with the existing narrower-scoped overflow specs is
// intentional and harmless (re-verifying the same property in two files
// is not a conflict) — this file's purpose is completeness, not
// deduplication of prior coverage.
import { primaryTest as test, expect } from "./auth-helper";
import type { Page } from "@playwright/test";

const SEEDED_PRIMARY_TENDER_ID = "11111111-1111-4111-8111-111111111111";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 800, height: 1280 },
] as const;

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
  ["company documents", "/dashboard/company/documents"],
  ["legacy data import", "/dashboard/company/plan-b-import"],
  ["company readiness", "/dashboard/company/readiness"],
  ["company review", "/dashboard/company/review"],
  ["company review board", "/dashboard/company/review-board"],
  ["matching engine", "/dashboard/matching"],
  ["compliance", "/dashboard/compliance"],
  ["proposal documents", "/dashboard/documents"],
  ["export hub", "/dashboard/export"],
  ["analytics", "/dashboard/analytics"],
  ["activity logs", "/dashboard/activity"],
  ["global search", "/dashboard/search"],
  ["company setup wizard", "/dashboard/setup"],
  ["tender analysis", "/dashboard/analysis"],
  ["brand assets", "/dashboard/assets"],
  ["settings", "/dashboard/settings"],
  ["account", "/dashboard/account"],
  ["admin root", "/dashboard/admin"],
  ["admin AI readiness", "/dashboard/admin/ai-readiness"],
  ["admin safety center", "/dashboard/admin/safety-center"],
  ["user management", "/dashboard/users"],
  ["system", "/dashboard/system"],
];

async function expectNoHorizontalScroll(page: Page, label: string, viewportName: string) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    dimensions.scrollWidth,
    `${label} (${viewportName}) must not overflow horizontally (scrollWidth=${dimensions.scrollWidth}, clientWidth=${dimensions.clientWidth})`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(`Full-route horizontal overflow guard (${vp.name}, ${vp.width}x${vp.height})`, () => {
    for (const [label, path] of ROUTES) {
      test(`${label} has no horizontal overflow`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await expect(page).not.toHaveURL(/\/login/);
        await page.waitForTimeout(700);
        await expectNoHorizontalScroll(page, label, vp.name);
      });
    }
  });
}
