/**
 * Regression tests for full source-evidence forwarding into the canonical
 * metadata resolver. Assertions intentionally tolerate typed access and legacy
 * `(tender as any)` access while requiring the same fail-closed values.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const FULL_SOURCE_COLS = [
  "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
  "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
  "submissionEmailSourceQuote",
];

function assertForwardedWithNullFallback(src: string, col: string, label: string) {
  const escaped = col.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    src,
    new RegExp(`${escaped}:\\s*(?:(?:\\(tender as any\\)|tender)\\.)${escaped}\\s*\\?\\?\\s*null`),
    `${label} must forward ${col} with ?? null fallback`,
  );
}

function assertActiveIdsFromActiveFiles(src: string, label: string) {
  const direct = /activeTenderFileIds:\s*new Set\(activeFiles\.map\(\(\w+\) => \w+\.id\)\)/.test(src);
  const declaredThenForwarded = /const activeTenderFileIds = new Set\(activeFiles\.map\(\(\w+\) => \w+\.id\)\)/.test(src)
    && /activeTenderFileIds,/.test(src);
  assert.ok(direct || declaredThenForwarded, `${label} must derive activeTenderFileIds only from activeFiles`);
}

describe("final-submission-readiness.ts — full source-evidence forwarding", () => {
  const src = read("lib/engine/final-submission-readiness.ts");

  it("SELECT includes title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of FULL_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });

  it("resolver call forwards source columns with ?? null fallback", () => {
    for (const col of FULL_SOURCE_COLS) assertForwardedWithNullFallback(src, col, "final readiness");
  });

  it("passes activeTenderFileIds filtered to ACTIVE files", () => {
    assert.match(src, /filter\(\(\w+(?:: any)?\) => \(\w+\.deletionStatus \?\? "ACTIVE"\) === "ACTIVE"\)/);
  });
});

describe("tender-release-snapshot.ts — full source-evidence forwarding", () => {
  const src = read("lib/engine/tender-release-snapshot.ts");

  it("SELECT includes title/deadline/submissionEmailSourceQuote columns", () => {
    for (const col of FULL_SOURCE_COLS) assert.ok(src.includes(`${col}: true`));
  });

  it("resolver call forwards source columns with ?? null fallback", () => {
    for (const col of FULL_SOURCE_COLS) assertForwardedWithNullFallback(src, col, "release snapshot");
  });

  it("passes activeTenderFileIds built only from ACTIVE files", () => {
    assert.match(src, /const activeFiles = tender\.files\.filter\(\(\w+\) => \w+\.deletionStatus === "ACTIVE"\)/);
    assertActiveIdsFromActiveFiles(src, "release snapshot");
  });
});

describe("build-plan-hash.ts — activeTenderFileIds filtered to ACTIVE", () => {
  const src = read("lib/engine/build-plan-hash.ts");
  it("filters to deletionStatus=ACTIVE before mapping IDs", () => {
    assert.match(src, /filter\(\(\w+(?:: any)?\) => \(\w+\.deletionStatus \?\? "ACTIVE"\) === "ACTIVE"\)/);
    assert.doesNotMatch(src, /activeTenderFileIds:\s*new Set\(\(tender\.files \?\? \[\]\)\.map/);
  });
});

describe("app/api/tenders/[id]/route.ts — TENDER_DASHBOARD_SELECT complete", () => {
  const src = read("app/api/tenders/[id]/route.ts");
  it("includes all source-evidence columns", () => {
    for (const col of [
      "clientNameSourcePage", "clientNameSourceQuote", "clientNameSourceFileId",
      "titleSourcePage", "titleSourceQuote", "titleSourceFileId",
      "deadlineSourcePage", "deadlineSourceQuote", "deadlineSourceFileId",
      "submissionMethodSourcePage", "submissionMethodSourceQuote", "submissionMethodSourceFileId",
      "submissionAddressSourcePage", "submissionAddressSourceQuote", "submissionAddressSourceFileId",
      "submissionEmailSourcePage", "submissionEmailSourceFileId", "submissionEmailSourceQuote",
      "contactDetailsSourceJson",
    ]) assert.ok(src.includes(`${col}: true`), `dashboard select must include ${col}`);
  });

  it("files select includes deletionStatus", () => {
    assert.ok(src.includes("deletionStatus: true"));
  });
});
