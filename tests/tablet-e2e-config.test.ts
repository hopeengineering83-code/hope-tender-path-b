/**
 * Source-inspection tests for the tablet (800x1280) E2E setup.
 *
 * These tests verify that:
 *   1. playwright.config.ts has a samsung-tablet project configured at 800x1280.
 *   2. The tablet project uses touch + isMobile flags.
 *   3. The tablet E2E spec file exists and contains the expected test cases.
 *   4. The tablet tests verify the universal tender intelligence foundation.
 *
 * These tests run without a browser — they're pure source-inspection.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("playwright.config.ts — tablet project configuration", () => {
  it("config has a samsung-tablet project", () => {
    const src = read("playwright.config.ts");
    assert.ok(src.includes("samsung-tablet"), "must have a samsung-tablet project");
  });

  it("tablet project uses 800x1280 viewport", () => {
    const src = read("playwright.config.ts");
    assert.ok(src.includes("width: 800"), "must set width: 800");
    assert.ok(src.includes("height: 1280"), "must set height: 1280");
  });

  it("tablet project uses touch + mobile flags", () => {
    const src = read("playwright.config.ts");
    assert.ok(src.includes("isMobile: true"), "must set isMobile: true");
    assert.ok(src.includes("hasTouch: true"), "must set hasTouch: true");
  });

  it("tablet project uses Android user agent", () => {
    const src = read("playwright.config.ts");
    assert.ok(src.includes("Linux; Android"), "must use Android user agent");
  });

  it("tablet project uses Chromium engine (for CI compatibility)", () => {
    const src = read("playwright.config.ts");
    assert.ok(src.includes('devices["Desktop Chrome"]'), "must use Desktop Chrome device as base");
  });
});

describe("tablet E2E spec — exists and covers universal tender intelligence", () => {
  const specPath = "e2e/tablet-universal-tender-intelligence.spec.ts";
  it("spec file exists", () => {
    assert.ok(existsSync(specPath), `tablet spec must exist at ${specPath}`);
  });

  it("spec verifies 800x1280 viewport", () => {
    const src = read(specPath);
    assert.ok(src.includes("viewport is 800x1280"), "must verify the 800x1280 viewport");
    assert.ok(
      src.includes("toEqual({ width: 800, height: 1280 })"),
      "must assert the viewport is exactly { width: 800, height: 1280 }",
    );
  });

  it("spec checks horizontal scroll does not overflow", () => {
    const src = read(specPath);
    assert.ok(src.includes("expectNoHorizontalScroll"), "must have expectNoHorizontalScroll helper");
    assert.ok(src.includes("scrollWidth"), "must check scrollWidth");
    assert.ok(src.includes("clientWidth"), "must check clientWidth");
  });

  it("spec checks touch targets are ≥44px (Apple HIG / Material minimum)", () => {
    const src = read(specPath);
    assert.ok(src.includes("expectTouchTargetSize"), "must have expectTouchTargetSize helper");
    assert.ok(src.includes("44"), "must check 44px minimum touch target size");
  });

  it("spec covers login page at tablet viewport", () => {
    const src = read(specPath);
    assert.ok(src.includes("login page fits in 800x1280"), "must test login page at 800x1280");
    assert.ok(src.includes("login form submit button is touch-friendly"), "must test login submit button touch size");
  });

  it("spec covers dashboard at tablet viewport", () => {
    const src = read(specPath);
    // The unauthenticated dashboard-redirect assertion was relocated to
    // e2e/anonymous/tablet-dashboard-redirect.spec.ts — it's anonymous
    // (no-session) behavior, not authenticated tablet UX, and now runs
    // under both chromium-anonymous and samsung-tablet-anonymous like the
    // rest of the anonymous suite instead of duplicating inside the
    // authenticated-fixture tablet spec.
    assert.ok(src.includes("authenticated dashboard fits at 800px"), "must test authenticated dashboard at 800px");
    const anonymousSpec = read("e2e/anonymous/tablet-dashboard-redirect.spec.ts");
    assert.ok(anonymousSpec.includes("dashboard redirects to login"), "the anonymous suite must test unauthenticated dashboard redirect");
  });

  it("spec covers tender intake page at tablet viewport", () => {
    const src = read(specPath);
    assert.ok(src.includes("tender intake page"), "must test tender intake page at 800px");
    assert.ok(src.includes("/dashboard/tenders/new"), "must navigate to /dashboard/tenders/new");
  });

  it("spec covers share-link page at tablet viewport", () => {
    const src = read(specPath);
    assert.ok(src.includes("share-link page renders within 800px"), "must test share-link page at 800px");
    assert.ok(src.includes("/share/"), "must navigate to /share/");
  });

  it("spec covers tender list cards (touch-tappable)", () => {
    const src = read(specPath);
    assert.ok(src.includes("tender list cards"), "must test tender list cards");
    assert.ok(src.includes("touch-tappable"), "must verify cards are touch-tappable");
  });

  it("scopes to the tablet project instead of a redundant per-file browser check", () => {
    // The old per-file `browserName !== "chromium"` guard was redundant:
    // the samsung-tablet-primary project (playwright.config.ts) already
    // only runs Chromium (devices["Desktop Chrome"] base), and this spec
    // additionally self-skips by viewport size (not 800x1280 => skip),
    // which only the tablet project satisfies.
    const src = read(specPath);
    assert.ok(
      src.includes("size.width !== 800 || size.height !== 1280"),
      "must self-skip when the running project's viewport isn't 800x1280",
    );
    const config = read("playwright.config.ts");
    assert.ok(config.includes('devices["Desktop Chrome"]'), "tablet project must be Chromium-based (see earlier test)");
  });

  it("skips cleanly when credentials are missing via the shared auth fixture", () => {
    // Credential-based skipping was centralized into the shared
    // tabletPrimaryTest fixture (e2e/auth-helper.ts) instead of each spec
    // file reimplementing its own SMOKE_TEST_EMAIL / test.skip guard.
    const src = read(specPath);
    assert.ok(src.includes('import { tabletPrimaryTest as test'), "must use the shared tabletPrimaryTest fixture");
    const authHelperSrc = read("e2e/auth-helper.ts");
    assert.ok(authHelperSrc.includes("tabletPrimaryTest"), "auth-helper must export tabletPrimaryTest");
    assert.match(
      authHelperSrc,
      /E2E_TEST_EMAIL|E2E_TEST_PASSWORD/,
      "the shared fixture's credential loading must be traceable to the documented E2E_TEST_EMAIL/PASSWORD env vars",
    );
  });
});
