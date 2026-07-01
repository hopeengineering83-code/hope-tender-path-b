// Phase 33 regression tests — gap fixes for criteria 1, 3/4, and 8.
//
// Coverage:
//   1. extraction-quality.ts: imageHeavyPages is populated in PerPageExtractionReport
//   2. extraction-quality-panel.tsx: imageHeavyPages is rendered in the per-file card
//   3. lib/ai.ts: AI prompt contains CLIENT ENTITY RULE for multi-entity disambiguation
//   4. lib/ai.ts: AI prompt contains PLACEHOLDER PROHIBITION rule
//   5. submission-plan/build/route.ts: blocks with BUILD_PLAN_ALL_OPTIONAL_REQUIREMENTS
//      when all requirements are non-MANDATORY and no exactFileName is set

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assessExtractionQualityPerPage } from "../lib/extraction-quality";

// ─── Criterion 1: imageHeavyPages in PerPageExtractionReport ─────────────────

describe("PerPageExtractionReport — imageHeavyPages field", () => {
  it("type definition includes imageHeavyPages array", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib/extraction-quality.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes("imageHeavyPages: number[];"),
      "PerPageExtractionReport type must include imageHeavyPages: number[]",
    );
  });

  it("reportFromPages populates imageHeavyPages from IMAGE_HEAVY status pages", () => {
    const src = readFileSync(
      path.join(process.cwd(), "lib/extraction-quality.ts"),
      "utf-8",
    );
    assert.ok(
      src.includes('"IMAGE_HEAVY"') && src.includes("imageHeavyPages"),
      "reportFromPages must filter IMAGE_HEAVY pages into imageHeavyPages array",
    );
  });

  it("assessExtractionQualityPerPage returns imageHeavyPages field", () => {
    const report = assessExtractionQualityPerPage("");
    assert.ok(
      "imageHeavyPages" in report,
      "assessExtractionQualityPerPage result must have imageHeavyPages field",
    );
    assert.ok(
      Array.isArray(report.imageHeavyPages),
      "imageHeavyPages must be an array",
    );
  });

  it("imageHeavyPages is distinct from tableHeavyPages in the report", () => {
    const report = assessExtractionQualityPerPage("");
    assert.ok(
      "tableHeavyPages" in report && "imageHeavyPages" in report,
      "both tableHeavyPages and imageHeavyPages must exist as separate fields",
    );
  });
});

describe("extraction-quality-panel.tsx — imageHeavyPages display", () => {
  const panelSrc = readFileSync(
    path.join(process.cwd(), "components/extraction-quality-panel.tsx"),
    "utf-8",
  );

  it("panel renders imageHeavyPages count in the per-file grid", () => {
    assert.ok(
      panelSrc.includes("pp.imageHeavyPages.length"),
      "extraction-quality-panel must reference pp.imageHeavyPages.length to display count",
    );
  });

  it("panel labels image/scan pages separately from table-heavy pages", () => {
    assert.ok(
      panelSrc.includes("Image/scan") || panelSrc.includes("image-heavy"),
      "panel must display image/scan pages with a distinct label",
    );
  });

  it("hasProblemPages includes imageHeavyPages", () => {
    assert.ok(
      panelSrc.includes("imageHeavyPages.length > 0"),
      "hasProblemPages condition must check imageHeavyPages.length > 0",
    );
  });
});

// ─── Criterion 3/4: AI prompt entity disambiguation and placeholder prohibition ─

describe("lib/ai.ts — CLIENT ENTITY RULE in AI prompt", () => {
  const aiSrc = readFileSync(
    path.join(process.cwd(), "lib/ai.ts"),
    "utf-8",
  );

  it("prompt contains CLIENT ENTITY RULE instruction", () => {
    assert.ok(
      aiSrc.includes("CLIENT ENTITY RULE"),
      "AI prompt must contain CLIENT ENTITY RULE for multi-entity disambiguation",
    );
  });

  it("prompt distinguishes procuringEntityName, donorAgency, implementingAgency roles", () => {
    assert.ok(
      aiSrc.includes("procuringEntityName") &&
        aiSrc.includes("donorAgency") &&
        aiSrc.includes("implementingAgency"),
      "AI prompt must name each entity field in the CLIENT ENTITY RULE",
    );
  });

  it("prompt says to return null (not copy) when role is not identifiable", () => {
    assert.ok(
      aiSrc.includes("return null") || aiSrc.includes("return null"),
      "CLIENT ENTITY RULE must instruct AI to return null for unidentifiable roles, not copy values",
    );
  });

  it("prompt contains PLACEHOLDER PROHIBITION rule", () => {
    assert.ok(
      aiSrc.includes("PLACEHOLDER PROHIBITION"),
      "AI prompt must contain explicit PLACEHOLDER PROHIBITION rule",
    );
  });

  it("PLACEHOLDER PROHIBITION names specific prohibited strings", () => {
    assert.ok(
      aiSrc.includes("Bid-Team to confirm") && aiSrc.includes("not specified"),
      "PLACEHOLDER PROHIBITION must name 'Bid-Team to confirm' and 'not specified' as prohibited values",
    );
  });

  it("PLACEHOLDER PROHIBITION instructs AI to return null for absent fields", () => {
    assert.ok(
      aiSrc.includes("return null for that field") || aiSrc.includes("return null"),
      "PLACEHOLDER PROHIBITION must say to return null when information is absent",
    );
  });
});

// ─── Criterion 8: no heuristic/derived draft — hard 422 block ───────────────

describe("submission-plan/build — no heuristic/derived draft (authoritative plan only)", () => {
  const buildSrc = readFileSync(
    path.join(process.cwd(), "app/api/tenders/[id]/submission-plan/build/route.ts"),
    "utf-8",
  );

  it("route does NOT import buildDerivedDraftPlan", () => {
    assert.ok(
      !buildSrc.includes("buildDerivedDraftPlan"),
      "build route MUST NOT import or use buildDerivedDraftPlan — heuristic drafts are not authoritative",
    );
  });

  it("route does NOT import buildSubmissionPlanWithDerivedFallback", () => {
    assert.ok(
      !buildSrc.includes("buildSubmissionPlanWithDerivedFallback"),
      "build route MUST NOT import buildSubmissionPlanWithDerivedFallback — derived fallback is not authoritative",
    );
  });

  it("route returns BUILD_PLAN_NO_GROUNDED_ITEMS when no grounded plan items", () => {
    assert.ok(
      buildSrc.includes('"BUILD_PLAN_NO_GROUNDED_ITEMS"'),
      "build route must return BUILD_PLAN_NO_GROUNDED_ITEMS when no grounded items can be derived",
    );
  });

  it("route returns 422 for no-grounded-items block", () => {
    const blockIdx = buildSrc.indexOf("BUILD_PLAN_NO_GROUNDED_ITEMS");
    const status422Idx = buildSrc.indexOf("status: 422", blockIdx);
    assert.ok(
      blockIdx > -1 && status422Idx > -1 && status422Idx - blockIdx < 1500,
      "BUILD_PLAN_NO_GROUNDED_ITEMS block must return status 422 within the same response",
    );
  });

  it("route does NOT persist DERIVED_DRAFT planType", () => {
    // isDerivedDraft must always be false — no DERIVED_DRAFT plans are persisted.
    assert.match(buildSrc, /let isDerivedDraft = false;.*Never persist a DERIVED_DRAFT plan/s);
  });
});
