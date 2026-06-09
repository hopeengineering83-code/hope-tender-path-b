// Regression tests for quality gap fixes — Phase 21.
//
// Phase 21 covers three targeted hardening improvements:
//
//   1. Legal entity contamination detection extended to legalClientName,
//      donorAgency, and implementingAgency (previously only clientName was
//      checked). Portal navigation text or status banners in any entity field
//      now set metadataContaminated = true and block export.
//
//   2. Source reference coverage depth: a new "weak trace" check blocks
//      export when more than 20% of mandatory requirements have confidence
//      scores but neither a page number nor a source quote. Confidence-only
//      traces are unverifiable against the source document.
//
//   3. Entity identity collision: implementingAgency must not equal
//      clientName. Identical values indicate a data-quality issue (same
//      text copied into both fields) and raise a MEDIUM tender-level blocker.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { detectMetadataContamination } from "../lib/engine/tender-metadata-completeness";
import { readFileSync } from "node:fs";

// ── 1. Legal entity contamination detection ───────────────────────────────────

describe("phase 21 — entity contamination detection extended to all entity fields", () => {
  it("portal nav text in legalClientName is flagged as contaminated", () => {
    const result = detectMetadataContamination("View Tender | Ministry of Finance");
    assert.equal(result.contaminated, true, "legalClientName with portal nav text must be contaminated");
  });

  it("portal status banner in donorAgency is flagged as contaminated", () => {
    const result = detectMetadataContamination("Status: OPEN | World Bank Group");
    assert.equal(result.contaminated, true, "donorAgency with status banner must be contaminated");
  });

  it("subscribe link in implementingAgency is flagged as contaminated", () => {
    const result = detectMetadataContamination("Subscribe to Tender Alerts — AAWSA");
    assert.equal(result.contaminated, true, "implementingAgency with subscribe link must be contaminated");
  });

  it("clean legalClientName is not contaminated", () => {
    const result = detectMetadataContamination("Federal Democratic Republic of Ethiopia, Ministry of Water");
    assert.equal(result.contaminated, false, "valid legalClientName must not be flagged");
  });

  it("clean donorAgency is not contaminated", () => {
    const result = detectMetadataContamination("World Bank — International Development Association");
    assert.equal(result.contaminated, false, "valid donorAgency must not be flagged");
  });

  it("clean implementingAgency is not contaminated", () => {
    const result = detectMetadataContamination("Addis Ababa Water and Sewerage Authority");
    assert.equal(result.contaminated, false, "valid implementingAgency must not be flagged");
  });

  it("null/empty entity field does not trigger contamination", () => {
    assert.equal(detectMetadataContamination(null).contaminated, false);
    assert.equal(detectMetadataContamination("").contaminated, false);
    assert.equal(detectMetadataContamination(undefined).contaminated, false);
  });

  it("ai-analyze route checks legalClientName contamination (static audit)", () => {
    const src = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
    assert.ok(
      src.includes("legalNameContamination") && src.includes("detectMetadataContamination(aiResult.legalClientName"),
      "ai-analyze must call detectMetadataContamination on legalClientName",
    );
    assert.ok(
      src.includes("donorAgencyContamination") && src.includes("detectMetadataContamination(aiResult.donorAgency"),
      "ai-analyze must call detectMetadataContamination on donorAgency",
    );
    assert.ok(
      src.includes("implementingAgencyContamination") && src.includes("detectMetadataContamination(aiResult.implementingAgency"),
      "ai-analyze must call detectMetadataContamination on implementingAgency",
    );
    assert.ok(
      src.includes("anyEntityContaminated"),
      "ai-analyze must combine all entity contamination checks",
    );
    assert.ok(
      (src.match(/metadataContaminated: anyEntityContaminated/g) ?? []).length >= 2,
      "both ai-analyze transaction paths must use anyEntityContaminated",
    );
  });
});

// ── 2. Weak-trace check ───────────────────────────────────────────────────────

describe("phase 21 — weak source trace check (confidence-only traces)", () => {
  it("SOURCE_TRACE_WEAK category is present in source (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("SOURCE_TRACE_WEAK"),
      "final-submission-readiness must have SOURCE_TRACE_WEAK blocker category",
    );
  });

  it("weak-trace check fires at > 20% threshold (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("weakRatio > 0.2"),
      "weak-trace threshold must be 0.2 (20%)",
    );
  });

  it("weak trace definition requires confidence > 0 but missing page AND quote (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("weaklyTracedCount"),
      "weak trace count variable must be present",
    );
    assert.ok(
      src.includes("sourceConfidence ?? 0) > 0") || src.includes("(r.sourceConfidence ?? 0) > 0"),
      "weak trace must check sourceConfidence > 0",
    );
    assert.ok(
      src.includes("!r.sourcePageNumber"),
      "weak trace must check absence of sourcePageNumber",
    );
    assert.ok(
      src.includes("sourceExactQuote"),
      "weak trace must check absence of sourceExactQuote",
    );
  });

  it("weak-trace blocker message mentions unverifiable traces (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("traces cannot be verified") || src.includes("weak-traced"),
      "SOURCE_TRACE_WEAK blocker must explain that traces are unverifiable",
    );
  });
});

// ── 3. Entity identity collision ─────────────────────────────────────────────

describe("phase 21 — entity identity collision (implementingAgency === clientName)", () => {
  it("ENTITY_IDENTITY_COLLISION category is present in source (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("ENTITY_IDENTITY_COLLISION"),
      "final-submission-readiness must have ENTITY_IDENTITY_COLLISION blocker category",
    );
  });

  it("collision check compares implementingAgency and clientName (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(
      src.includes("implementingAgencyValue") && src.includes("clientNameValue"),
      "collision check must use implementingAgencyValue and clientNameValue comparison variables",
    );
    assert.ok(
      src.includes(".toLowerCase()"),
      "collision check must be case-insensitive (toLowerCase comparison)",
    );
  });

  it("collision check severity is MEDIUM (static audit)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    // Find the ENTITY_IDENTITY_COLLISION block and confirm MEDIUM appears near it.
    const collisionIdx = src.indexOf("ENTITY_IDENTITY_COLLISION");
    assert.ok(collisionIdx !== -1, "ENTITY_IDENTITY_COLLISION must exist");
    const snippet = src.slice(collisionIdx, collisionIdx + 300);
    assert.ok(snippet.includes("MEDIUM"), "ENTITY_IDENTITY_COLLISION blocker must have MEDIUM severity");
  });
});

// ── 4. Regression: prior Phase 20 checks still present ───────────────────────

describe("phase 21 — regression: phase 20 checks unchanged", () => {
  it("source traceability threshold still 10% (not reverted)", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(src.includes("missingRatio > 0.1"), "10% untraced threshold must remain from phase 20");
    assert.ok(!src.includes("missingRatio > 0.2"), "old 20% threshold must not have returned");
  });

  it("contamination blocker still exists in final-submission-readiness", () => {
    const src = readFileSync("lib/engine/final-submission-readiness.ts", "utf8");
    assert.ok(src.includes("METADATA_CONTAMINATED"), "METADATA_CONTAMINATED blocker must still be present");
    assert.ok(src.includes("metadataContaminated === true"), "contamination gate must check the metadataContaminated flag");
  });
});
