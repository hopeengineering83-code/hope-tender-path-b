// Phase 31 quality-gap regression tests.
//
// Coverage:
//   1. readiness-scoring: EXTRACTION_CORRUPTED_AI_SKIPPED caps score at 30
//   2. readiness-scoring: REGEX_FALLBACK_FROM_WEAK_EXTRACTION caps score at 40
//   3. readiness-scoring: metadataContaminated caps score at 50
//   4. final-submission-readiness passes analysisExtractionStatus + metadataContaminated

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const scoringSource = readFileSync(
  path.join(process.cwd(), "lib/engine/readiness-scoring.ts"),
  "utf-8",
);

const readinessSource = readFileSync(
  path.join(process.cwd(), "lib/engine/final-submission-readiness.ts"),
  "utf-8",
);

// ── 1-3. readiness-scoring caps ───────────────────────────────────────────────

describe("readiness-scoring — extraction status and contamination caps", () => {
  it("declares analysisExtractionStatus in ReadinessScoreInput", () => {
    assert.ok(
      scoringSource.includes("analysisExtractionStatus"),
      "ReadinessScoreInput must include analysisExtractionStatus field",
    );
  });

  it("declares metadataContaminated in ReadinessScoreInput", () => {
    assert.ok(
      scoringSource.includes("metadataContaminated"),
      "ReadinessScoreInput must include metadataContaminated field",
    );
  });

  it("caps score at 30 for EXTRACTION_CORRUPTED_AI_SKIPPED", () => {
    assert.ok(
      scoringSource.includes('"EXTRACTION_CORRUPTED_AI_SKIPPED"') && scoringSource.includes("capScore: 30"),
      "readiness score must be capped at 30 when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED",
    );
  });

  it("caps score at 40 for REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      scoringSource.includes('"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"') && scoringSource.includes("capScore: 40"),
      "readiness score must be capped at 40 when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION",
    );
  });

  it("caps score at 50 when metadataContaminated is true", () => {
    assert.ok(
      scoringSource.includes("input.metadataContaminated") && scoringSource.includes("capScore: 50"),
      "readiness score must be capped at 50 when metadataContaminated is true",
    );
  });
});

// ── 4. final-submission-readiness passes new fields ──────────────────────────

describe("final-submission-readiness — passes extraction status and contamination to scorer", () => {
  it("passes analysisExtractionStatus to computeReadinessScore", () => {
    assert.ok(
      readinessSource.includes("analysisExtractionStatus:"),
      "final-submission-readiness must pass analysisExtractionStatus to computeReadinessScore",
    );
  });

  it("passes metadataContaminated to computeReadinessScore", () => {
    assert.ok(
      readinessSource.includes("metadataContaminated: tender.metadataContaminated"),
      "final-submission-readiness must pass tender.metadataContaminated to computeReadinessScore",
    );
  });
});
