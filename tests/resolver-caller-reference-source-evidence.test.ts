/**
 * Regression tests for the referenceSource* forwarding gap and the
 * evaluationCriteria → evaluationMethodology resolver mapping.
 *
 * Context: the canonical resolver's getSourceEvidence() reads
 * `tender[`${fieldKey}SourcePage`]` (and Quote/FileId) dynamically for every
 * fieldKey in its iteration list — including "reference". Reference HAS
 * dedicated columns in the schema (referenceSourceFileId/Page/Quote, added in
 * migration 20260703000000) and they ARE declared in CanonicalResolverInput.
 *
 * But four of seven production callers were NOT forwarding them — the Prisma
 * select omitted the columns, and the resolver call did not include them.
 * The gap was MASKED because AI Analyze also writes the same evidence into
 * contactDetailsSourceJson["procurementReferenceNumber"], which the resolver
 * falls back to. However:
 *
 *   1. The hash builder (computeTenderBuildPlanHash) computes a different
 *      hash than validateCriticalMetadataEvidenceForBuildPlan would justify,
 *      because the hash treats `reference` as ungrounded while the validator
 *      treats it as grounded.
 *   2. Any future write path that populates only the dedicated columns (e.g.,
 *      manual repair, future AI Analyze refactor) would silently cause
 *      `reference` to be reported as EXTRACTED_UNVERIFIED (blocker for the
 *      critical `reference` field).
 *
 * Also covers the evaluationCriteria latent resolver bug: the fieldKey
 * "evaluationCriteria" was iterated by the resolver but NOT declared in
 * CanonicalResolverInput (only `evaluationMethodology` is). Every call saw
 * `tender.evaluationCriteria === undefined` → always reported INVALID, even
 * when evaluationMethodology was populated. The fix maps the virtual fieldKey
 * to the real column.
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

// ─── 1. final-submission-readiness.ts ───────────────────────────────────────

describe("final-submission-readiness.ts — referenceSource* forwarding", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `resolver call must forward ${col} (with ?? null fallback)`,
      );
    }
  });

  it("resolver call forwards extended panel fields (evaluationMethodology, legalClientName, etc.)", () => {
    // These are iterated as fieldKeys by the resolver; without forwarding them,
    // every extended field reports INVALID in the export gate's canonical state.
    const extendedFields = [
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
    ];
    for (const f of extendedFields) {
      assert.ok(
        src.includes(`${f}: tender.${f} ?? null`),
        `resolver call must forward extended field ${f}`,
      );
    }
  });
});

// ─── 2. tender-release-snapshot.ts ──────────────────────────────────────────

describe("tender-release-snapshot.ts — referenceSource* forwarding", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `resolver call must forward ${col} (with ?? null fallback)`,
      );
    }
  });
});

// ─── 3. generation-readiness-gate.ts ────────────────────────────────────────

describe("generation-readiness-gate.ts — referenceSource* in SELECT", () => {
  const src = read("lib/engine/generation-readiness-gate.ts");

  it("SELECT includes referenceSource* columns (resolver call uses ...tender spread)", () => {
    // The resolver call uses `...tender` spread, so selecting the columns is
    // sufficient — the spread forwards them automatically. But if the select
    // omits them, the spread forwards `undefined` and the resolver falls back
    // to contactDetailsSourceJson, diverging from the strict BuildPlan validator.
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });
});

// ─── 4. build-plan.ts (computeTenderBuildPlanHash) ──────────────────────────

describe("build-plan.ts — computeTenderBuildPlanHash SELECT includes referenceSource*", () => {
  const src = read("lib/engine/build-plan.ts");

  it("SELECT inside computeTenderBuildPlanHash includes referenceSource* columns", () => {
    // buildCanonicalBuildPlanHashInput (in build-plan-hash.ts) uses `...tender`
    // spread, so once these are in the select they are forwarded automatically.
    // Without them in the select, the hash treats reference as ungrounded even
    // when the columns are populated, diverging from the strict BuildPlan
    // validator (validateCriticalMetadataEvidenceForBuildPlan) which reads them.
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });
});

// ─── 5. metadata-override route ─────────────────────────────────────────────

describe("metadata-override route — referenceSource* forwarding", () => {
  const src = read("app/api/tenders/[id]/metadata-override/route.ts");

  it("SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("resolver call forwards referenceSource* columns with ?? null fallback", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `resolver call must forward ${col} (with ?? null fallback)`,
      );
    }
  });
});

// ─── 6. dashboard route TENDER_DASHBOARD_SELECT ─────────────────────────────

describe("dashboard route — TENDER_DASHBOARD_SELECT includes referenceSource*", () => {
  const src = read("app/api/tenders/[id]/route.ts");

  it("TENDER_DASHBOARD_SELECT includes referenceSource* columns", () => {
    for (const col of REFERENCE_SOURCE_COLS) {
      assert.ok(src.includes(`${col}: true`), `TENDER_DASHBOARD_SELECT must include ${col}: true`);
    }
  });
});

// ─── 7. canonical-field-state.ts — evaluationCriteria mapping ───────────────

describe("canonical-field-state.ts — evaluationCriteria maps to evaluationMethodology", () => {
  const src = read("lib/engine/canonical-field-state.ts");

  it("resolver maps evaluationCriteria fieldKey to tender.evaluationMethodology column", () => {
    // Without this mapping, the resolver iterates "evaluationCriteria" in
    // fieldKeys but reads `tender.evaluationCriteria` (undefined) → always
    // INVALID, even when evaluationMethodology is populated. The mapping
    // ensures the field reflects the real column value.
    assert.ok(
      src.includes(`fieldKey === "evaluationCriteria"\n        ? tender.evaluationMethodology`),
      "resolver must special-case evaluationCriteria to read from tender.evaluationMethodology",
    );
  });
});
