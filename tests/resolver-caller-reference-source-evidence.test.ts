/**
 * Regression tests for referenceSource* forwarding and the
 * evaluationCriteria → evaluationMethodology resolver mapping.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const REFERENCE_SOURCE_COLS = [
  "referenceSourcePage",
  "referenceSourceQuote",
  "referenceSourceFileId",
];

function assertForwardedWithNullFallback(src: string, col: string, label: string) {
  const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    src,
    new RegExp(`${escaped}:\\s*(?:\\(tender as any\\)\\.)?${escaped}\\s*\\?\\?\\s*null`),
    `${label} must forward ${col} with ?? null fallback`,
  );
}

describe("final-submission-readiness.ts — referenceSource* forwarding", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) assertForwardedWithNullFallback(src, col, "final readiness");
  });

  it("resolver call forwards extended panel fields", () => {
    for (const field of [
      "evaluationMethodology",
      "legalClientName",
      "donorAgency",
      "implementingAgency",
      "clientContactTitle",
      "clientContactPhone",
      "clientCity",
      "clientAddress",
      "clientWebsite",
      "clientRepresentative",
      "preBidChannel",
      "preBidMeetingLocation",
    ]) {
      assert.match(src, new RegExp(`${field}:\\s*tender\\.${field}(?:\\s*\\?\\?\\s*null)?`));
    }
  });
});

describe("tender-release-snapshot.ts — referenceSource* forwarding", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) assertForwardedWithNullFallback(src, col, "release snapshot");
  });
});

describe("generation-readiness-gate.ts — referenceSource* in SELECT", () => {
  const src = read("lib/engine/generation-readiness-gate.ts");
  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });
});

describe("build-plan.ts — computeTenderBuildPlanHash SELECT includes referenceSource*", () => {
  const src = read("lib/engine/build-plan.ts");
  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });
});

describe("metadata-override route — referenceSource* forwarding", () => {
  const src = read("app/api/tenders/[id]/metadata-override/route.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) assertForwardedWithNullFallback(src, col, "metadata override");
  });
});

describe("dashboard route — TENDER_DASHBOARD_SELECT includes referenceSource*", () => {
  const src = read("app/api/tenders/[id]/route.ts");
  it("includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });
});

describe("canonical-field-state.ts — evaluationCriteria maps to evaluationMethodology", () => {
  const src = read("lib/engine/canonical-field-state.ts");
  it("maps the virtual field key to the real column", () => {
    assert.match(src, /fieldKey === "evaluationCriteria"[\s\S]*?tender\.evaluationMethodology/);
  });
});
