// Regression test: TenderIntakeDetailPanel's "N relevant fact(s) missing"
// list and its main Detail grid never consulted TenderMetadataOverride, so
// clicking Ignore or Edit on a missing fact appeared to succeed (the toast
// said "Fact marked as not applicable. Refreshing…") but the SAME fact
// reappeared as missing on every reload, with no visible change anywhere —
// the user's action had no observable effect.
//
// Root cause: app/api/tenders/[id]/metadata-override/route.ts deliberately
// never promotes an override into the tender scalar column ("the tender
// scalar is the EXTRACTOR's territory; the override is the USER's
// territory"), and the panel's missing-facts/effective-value computations
// only ever read the tender scalar + live source-text intelligence, never
// tender.metadataOverrides.
//
// Fixed by:
//   1. app/dashboard/tenders/[id]/page.tsx now includes metadataOverrides
//      on the tender query.
//   2. The panel builds a field -> override lookup and (a) excludes a field
//      from the missing-facts list once it has a resolving override
//      (NOT_APPLICABLE / IGNORED_WITH_REASON / USER_EDITED / USER_CONFIRMED),
//      and (b) falls back to the override's value for display when the
//      source itself provided nothing.
//   3. The "Project Title" missing-fact used an internal key ("projectTitle")
//      that didn't match the canonical scalar field name ("title") used by
//      isSubmissionCriticalField/ENRICHMENT_FIELD_MAP everywhere else in the
//      authority model — aligned to "title" so overrides on it resolve
//      correctly and the critical-field audit-reason gate applies to it too.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  buildOverrideLookup,
  isResolvedByOverride,
  overrideDisplayValue,
} from "../app/dashboard/tenders/[id]/tender-intake-detail-panel";

const src = readFileSync("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx", "utf8");

describe("override lookup — pure logic", () => {
  it("builds a field -> {fieldState, overrideValue} map from the raw override rows", () => {
    const map = buildOverrideLookup([
      { field: "clientName", fieldState: "NOT_APPLICABLE", overrideValue: null },
      { field: "deadline", fieldState: "USER_EDITED", overrideValue: "2026-12-15" },
    ]);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get("clientName"), { fieldState: "NOT_APPLICABLE", overrideValue: null });
    assert.deepEqual(map.get("deadline"), { fieldState: "USER_EDITED", overrideValue: "2026-12-15" });
  });

  it("returns an empty map for undefined/empty overrides", () => {
    assert.equal(buildOverrideLookup(undefined).size, 0);
    assert.equal(buildOverrideLookup([]).size, 0);
  });

  for (const state of ["NOT_APPLICABLE", "IGNORED_WITH_REASON", "USER_EDITED", "USER_CONFIRMED"]) {
    it(`isResolvedByOverride is true for ${state}`, () => {
      const map = buildOverrideLookup([{ field: "clientName", fieldState: state, overrideValue: "x" }]);
      assert.equal(isResolvedByOverride(map, "clientName"), true);
    });
  }

  it("isResolvedByOverride is false when no override exists for the field", () => {
    const map = buildOverrideLookup([{ field: "deadline", fieldState: "USER_EDITED", overrideValue: "x" }]);
    assert.equal(isResolvedByOverride(map, "clientName"), false);
  });

  it("isResolvedByOverride is false for the MISSING retry marker (must stay in the missing list)", () => {
    const map = buildOverrideLookup([{ field: "clientName", fieldState: "MISSING", overrideValue: null }]);
    assert.equal(isResolvedByOverride(map, "clientName"), false);
  });

  it("overrideDisplayValue returns 'Not applicable to this tender' for NOT_APPLICABLE / IGNORED_WITH_REASON", () => {
    const map = buildOverrideLookup([
      { field: "submissionAddress", fieldState: "NOT_APPLICABLE", overrideValue: null },
      { field: "submissionEmails", fieldState: "IGNORED_WITH_REASON", overrideValue: null },
    ]);
    assert.equal(overrideDisplayValue(map, "submissionAddress"), "Not applicable to this tender");
    assert.equal(overrideDisplayValue(map, "submissionEmails"), "Not applicable to this tender");
  });

  it("overrideDisplayValue returns the override's value for USER_EDITED / USER_CONFIRMED", () => {
    const map = buildOverrideLookup([
      { field: "clientName", fieldState: "USER_EDITED", overrideValue: "Ministry of Works" },
      { field: "deadline", fieldState: "USER_CONFIRMED", overrideValue: "15 Dec 2026" },
    ]);
    assert.equal(overrideDisplayValue(map, "clientName"), "Ministry of Works");
    assert.equal(overrideDisplayValue(map, "deadline"), "15 Dec 2026");
  });

  it("overrideDisplayValue returns null when no override exists (caller falls back to its own value)", () => {
    const map = buildOverrideLookup([]);
    assert.equal(overrideDisplayValue(map, "clientName"), null);
  });

  it("overrideDisplayValue returns null for USER_EDITED with no overrideValue (never shows a blank as if resolved)", () => {
    const map = buildOverrideLookup([{ field: "clientName", fieldState: "USER_EDITED", overrideValue: null }]);
    assert.equal(overrideDisplayValue(map, "clientName"), null);
  });
});

describe("TenderIntakeDetailPanel — every missing-fact push site checks the override lookup", () => {
  it("deadline", () => {
    assert.match(src, /!si\.deadlineDisplay && !tender\.deadline && !isResolvedByOverride\(overrides, "deadline"\)/);
  });
  it("submissionMethod", () => {
    assert.match(src, /\(!si\.method \|\| si\.method === "Unknown"\) && !tender\.submissionMethod && !isResolvedByOverride\(overrides, "submissionMethod"\)/);
  });
  it("submissionEmails", () => {
    assert.match(src, /si\.emails\.length === 0 && !tender\.submissionEmails && \(si\.method === "Email" \|\| si\.method === "Hybrid"\) && !isResolvedByOverride\(overrides, "submissionEmails"\)/);
  });
  it("submissionAddress", () => {
    assert.match(src, /!si\.physicalAddress && !tender\.submissionAddress && \(si\.method === "Physical" \|\| si\.method === "Hybrid"\) && !isResolvedByOverride\(overrides, "submissionAddress"\)/);
  });
  it("clientName", () => {
    assert.match(src, /!intelligence\.clientOrProcuringEntity && !tender\.clientName && !\(tender as Record<string, unknown>\)\.procuringEntityName && !isResolvedByOverride\(overrides, "clientName"\)/);
  });
  it("title (renamed from the mismatched 'projectTitle' key)", () => {
    assert.match(src, /!intelligence\.projectTitle && !tender\.title && !isResolvedByOverride\(overrides, "title"\)/);
    assert.match(src, /key: "title", label: "Project Title"/);
    assert.doesNotMatch(src, /key: "projectTitle"/);
  });
  it("the sourceDetail fallback branch (no intelligence) also checks the override lookup", () => {
    const elseBranch = src.slice(src.indexOf("// No intelligence"), src.indexOf("const effectiveMissingCount"));
    assert.match(elseBranch, /!isResolvedByOverride\(overrides, f\.key\)/);
  });
});

describe("TenderIntakeDetailPanel — effective values fall back to a resolved override", () => {
  it("effectiveMethod", () => {
    assert.match(src, /overrideDisplayValue\(overrides, "submissionMethod"\) \?\? NOT_EXTRACTED/);
  });
  it("effectiveDeadline", () => {
    assert.match(src, /overrideDisplayValue\(overrides, "deadline"\) \?\? NOT_EXTRACTED/);
  });
  it("effectiveEmails", () => {
    assert.match(src, /overrideDisplayValue\(overrides, "submissionEmails"\) \?\? sEmails/);
  });
  it("effectiveProjectTitle", () => {
    assert.match(src, /overrideDisplayValue\(overrides, "title"\) \?\? NOT_EXTRACTED/);
  });
  it("effectiveClient", () => {
    assert.match(src, /overrideDisplayValue\(overrides, "clientName"\) \?\? NOT_EXTRACTED/);
  });
  it("effectiveSubmissionAddress (the collapsed 'source-grounded facts' section)", () => {
    assert.match(src, /const effectiveSubmissionAddress = sSubAddress !== NOT_EXTRACTED \? sSubAddress : \(overrideDisplayValue\(overrides, "submissionAddress"\) \?\? sSubAddress\)/);
    assert.match(src, /<Detail label="Submission address" value=\{effectiveSubmissionAddress\} \/>/);
  });
});

describe("page.tsx wiring — metadataOverrides reaches the panel", () => {
  const pageSrc = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

  it("the tender query includes metadataOverrides", () => {
    assert.match(pageSrc, /metadataOverrides:\s*\{\s*select:\s*\{\s*field:\s*true,\s*fieldState:\s*true,\s*overrideValue:\s*true\s*\}\s*,?\s*\}/);
  });

  it("tenderForUi is a spread of the full tender row (metadataOverrides passes through)", () => {
    assert.match(pageSrc, /const tenderForUi = \{\s*\.\.\.tender,/);
  });
});
