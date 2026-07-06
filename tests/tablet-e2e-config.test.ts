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
    assert.ok(src.includes("toBe(800)"), "must assert width === 800");
    assert.ok(src.includes("toBe(1280)"), "must assert height === 1280");
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
    assert.ok(src.includes("dashboard redirects to login"), "must test unauthenticated dashboard redirect");
    assert.ok(src.includes("authenticated dashboard fits at 800px"), "must test authenticated dashboard at 800px");
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

  it("spec skips non-Chromium browsers (tablet project only)", () => {
    const src = read(specPath);
    assert.ok(src.includes("browserName !== \"chromium\""), "must skip non-Chromium browsers");
  });

  it("spec skips cleanly when credentials are missing", () => {
    const src = read(specPath);
    assert.ok(src.includes("SMOKE_TEST_EMAIL"), "must reference SMOKE_TEST_EMAIL");
    assert.ok(src.includes("test.skip"), "must have test.skip for missing credentials");
  });
});
