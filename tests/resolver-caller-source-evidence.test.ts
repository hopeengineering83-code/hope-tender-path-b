/**
 * Regression tests for the resolver-caller gap fix:
 *
 * Every caller of `resolveCanonicalFieldState` must:
 *   (a) SELECT every source-evidence column from the DB (so the resolver
 *       can read title/deadline/submissionEmailSourceQuote/*SourceFileId);
 *   (b) forward every source-evidence column to the resolver's `tender` arg;
 *   (c) pass `activeTenderFileIds` filtered to ACTIVE files only.
 *
 * Previously, `lib/engine/final-submission-readiness.ts` and
 * `lib/engine/tender-release-snapshot.ts` omitted title/deadline/
 * submissionEmailSourceQuote columns from BOTH the SELECT and the resolver
 * call — so those fields could never reach EXTRACTED_AND_GROUNDED through
 * the export gate or the release snapshot (the canonical UI source).
 *
 * `lib/engine/build-plan-hash.ts` did not filter `activeTenderFileIds` to
 * ACTIVE files — currently safe only because the sole caller pre-filters,
 * but a latent gap if a future caller passes the unfiltered file list.
 *
 * `app/api/tenders/[id]/route.ts` `TENDER_DASHBOARD_SELECT` omitted 9
 * source-evidence columns AND `files.deletionStatus` — so client panels
 * could not reconstruct active-file grounding state.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. final-submission-readiness.ts ────────────────────────────────────────

describe("final-submission-readiness.ts — full source-evidence forwarding", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("SELECT includes title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of [
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionEmailSourceQuote",
    ]) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("resolver call forwards title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of [
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionEmailSourceQuote",
    ]) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `resolver call must forward ${col} (with ?? null fallback)`,
      );
    }
  });

  it("passes activeTenderFileIds filtered to ACTIVE files", () => {
    assert.ok(
      src.includes('filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")'),
      "activeTenderFileIds must filter to deletionStatus=ACTIVE",
    );
  });
});

// ─── 2. tender-release-snapshot.ts ───────────────────────────────────────────

describe("tender-release-snapshot.ts — full source-evidence forwarding", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("SELECT includes title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of [
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionEmailSourceQuote",
    ]) {
      assert.ok(src.includes(`${col}: true`), `SELECT must include ${col}: true`);
    }
  });

  it("resolver call forwards title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of [
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionEmailSourceQuote",
    ]) {
      assert.ok(
        src.includes(`${col}: (tender as any).${col} ?? null`),
        `resolver call must forward ${col} (with ?? null fallback)`,
      );
    }
  });

  it("passes activeTenderFileIds built from activeFiles (filtered to ACTIVE)", () => {
    assert.ok(
      src.includes("activeTenderFileIds: new Set(activeFiles.map((f) => f.id))"),
      "activeTenderFileIds must be built from activeFiles (which is pre-filtered to ACTIVE)",
    );
  });
});

// ─── 3. build-plan-hash.ts ───────────────────────────────────────────────────

describe("build-plan-hash.ts — activeTenderFileIds filtered to ACTIVE", () => {
  const src = read("lib/engine/build-plan-hash.ts");

  it("activeTenderFileIds filters to deletionStatus=ACTIVE (defense-in-depth)", () => {
    // Previously: new Set((tender.files ?? []).map((f: any) => f.id))
    // Now: filter to ACTIVE first, then map to id
    assert.ok(
      src.includes('filter((f: any) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")'),
      "activeTenderFileIds must filter to deletionStatus=ACTIVE — defense-in-depth so a future caller passing unfiltered files cannot let deleted-file evidence count as GROUNDED",
    );
    // And the old unfiltered form must NOT be present
    assert.ok(
      !src.includes("activeTenderFileIds: new Set((tender.files ?? []).map((f: any) => f.id))"),
      "the old unfiltered activeTenderFileIds construction must be removed",
    );
  });
});

// ─── 4. app/api/tenders/[id]/route.ts — TENDER_DASHBOARD_SELECT ──────────────

describe("app/api/tenders/[id]/route.ts — TENDER_DASHBOARD_SELECT complete", () => {
  const src = read("app/api/tenders/[id]/route.ts");

  it("TENDER_DASHBOARD_SELECT includes all source-evidence columns", () => {
    // The dashboard payload must include every source-evidence column so
    // client panels can reconstruct grounding state without an extra round trip.
    const requiredCols = [
      "clientNameSourcePage", "clientNameSourceQuote", "clientNameSourceFileId",
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionMethodSourcePage", "submissionMethodSourceQuote", "submissionMethodSourceFileId",
      "submissionAddressSourcePage", "submissionAddressSourceQuote", "submissionAddressSourceFileId",
      "submissionEmailSourcePage", "submissionEmailSourceFileId", "submissionEmailSourceQuote",
      "contactDetailsSourceJson",
    ];
    for (const col of requiredCols) {
      assert.ok(
        src.includes(`${col}: true`),
        `TENDER_DASHBOARD_SELECT must include ${col}: true`,
      );
    }
  });

  it("files select includes deletionStatus", () => {
    // Client panels need deletionStatus to reconstruct activeTenderFileIds.
    assert.ok(
      src.includes("deletionStatus: true"),
      "files select must include deletionStatus: true so client panels can filter to ACTIVE files",
    );
  });
});
