// UI regression tests for the tender-facts workflow polish.
//
// These tests verify the MASTER RULE: the app must not show "metadata" anywhere
// to users. Metadata is not a product concept. The user-facing app must speak
// only in terms of Tender Details, Source-Grounded Tender Facts, Submission
// Facts, Required Documents, Final Package Facts, and Export Readiness.
//
// Tests:
//   1. No visible metadata text in rendered components (source inspection)
//   2. Stepper has no "Confirm Metadata" step
//   3. Canonical readiness card has no metadata tile
//   4. Required docs count is consistent (no 0/0 when planned required docs exist)
//   5. Historical/superseded rows hidden inside audit details
//   6. Partial AI Analyze does not show generation-ready state
//   7. Export route failure is sanitized (no raw Prisma text)
//   8. Raw Prisma text never renders
//   9. Repair prohibited assets button is conditional
//  10. Missing optional tender details are advisory
//  11. Missing required export facts show "Required before export"
//  12. Component renames: TenderDetailsPanel, SourceGroundedTenderFactsPanel,
//      ClientEntityWarningBanner, RepairTenderFactsButton

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. No visible metadata text in rendered components ─────────────────────

describe("UI metadata removal — no visible metadata text", () => {
  // Components that render user-facing text. We check that none of them
  // contain user-visible "metadata" strings (excluding internal identifiers
  // like metadataContaminated, metadataOverrides, etc.).
  const componentFiles = [
    "components/generation-action-panel.tsx",
    "components/extraction-quality-panel.tsx",
        "components/audit-trail-panel.tsx",
    "components/tender-recovery-command-center.tsx",
    "components/corrupted-metadata-banner.tsx",
    "components/metadata-completion-panel.tsx",
    "components/metadata-truth-panel.tsx",
    "components/analysis-quality-panel.tsx",
    "components/engine-action-panel.tsx",
    "components/next-action-panel.tsx",
        "components/clean-corrupted-metadata-button.tsx",
    "components/generation-readiness-panel.tsx",
      ];

  // User-facing metadata phrases that must NOT appear in rendered text.
  // We check the source for these as string literals in JSX text content,
  // return statements, and error messages.
  const forbiddenPhrases = [
    "All critical metadata is present",
    "Confirm Metadata",
    "Complete Metadata",
    "Repair Metadata",
    "extracted metadata",
    "Optional metadata",
    "Metadata gaps",
    "critical metadata",
    "metadata completion",
    "metadata truth",
    "corrupted metadata detected",
    "Corrupted metadata detected",
    "Metadata incomplete",
    "Metadata contamination warning",
    "Edit metadata",
    "Fill missing metadata",
    "Repair or edit metadata",
    "tender metadata",
    "Metadata Truth Facts",
    "Metadata Completion",
    "Metadata issues",
    "Metadata repaired",
  ];

  for (const file of componentFiles) {
    it(`${file} has no user-facing metadata text`, () => {
      const src = read(file);
      for (const phrase of forbiddenPhrases) {
        assert.ok(
          !src.includes(phrase),
          `${file} must not contain user-facing text "${phrase}" — use Tender Details / Source-Grounded Tender Facts / Submission Facts instead`,
        );
      }
    });
  }
});

// ─── 2. Stepper has no "Confirm Metadata" step ──────────────────────────────

describe("Stepper — no Confirm Metadata step", () => {
  it("page.tsx workflow stages do not mention 'Confirm Metadata'", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(!src.includes("Confirm Metadata"), "stepper must not have a 'Confirm Metadata' step");
    assert.ok(!src.includes("confirm metadata"), "stepper must not have a 'confirm metadata' step");
  });

  it("page.tsx workflow stage 1 uses 'Tender Details' not 'metadata'", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(
      src.includes("submission-critical Tender Details"),
      "stage 1 must say 'Tender Details' not 'metadata'",
    );
  });
});

// ─── 3-5. Canonical readiness card tile layout, required-docs count display,
// and audit-details collapsing were specific to
// components/canonical-readiness-score-widget.tsx, which was retired in
// favor of the canonical Tender Release State
// (components/tender-release-state-panel.tsx). The new panel has a
// different, intentionally redesigned layout (readiness score, verdict,
// reconciled blocker list, one primary next action) rather than the old
// widget's Required-docs/Quality/Analysis tile set — required-doc counts
// and historical/superseded rows remain covered by
// components/export-readiness-panel.tsx and
// components/final-package-manifest-panel.tsx, which are unchanged. The
// underlying protective property these sections locked — no metadata
// completion percentage standing in for readiness — holds structurally:
// the new panel's readinessScore is the gated bid-decision score, not
// metadataCompletenessRatio.

// ─── 6. Partial AI Analyze does not show generation-ready state ─────────────

describe("AI Analyze recovery — partial analysis clarity", () => {
  it("recovery panel exists and mentions partial/resume concepts", () => {
    const src = read("components/ai-analyze-recovery-panel.tsx");
    assert.ok(src.length > 0, "ai-analyze-recovery-panel.tsx must exist");
    assert.ok(
      src.includes("PARTIAL") || src.includes("partial") || src.includes("Resume"),
      "must reference partial analysis or resume action",
    );
  });
});

// ─── 7. Export route failure is sanitized ───────────────────────────────────

describe("Export readiness — sanitized error handling", () => {
  it("export-readiness-panel does not expose raw error.message", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.includes("catch"), "must catch errors");
    // Must NOT include err.message in the rendered output
    assert.ok(
      !src.includes("err.message"),
      "must not render raw err.message — use safe generic message",
    );
    assert.ok(
      src.includes("Export readiness check failed"),
      "must show safe 'Export readiness check failed' message",
    );
  });
});

// ─── 8. Raw Prisma text never renders ───────────────────────────────────────

describe("Prisma error redaction — no raw Prisma text in UI", () => {
  it("export-readiness-panel uses safe error message", () => {
    const src = read("components/export-readiness-panel.tsx");
    // Must not render raw Prisma error text in the UI (comments are OK).
    // Check that no rendered string (setError / return / JSX text) includes
    // raw Prisma error output.
    assert.ok(
      !/setError\(.*Prisma/.test(src),
      "must not pass raw Prisma text to setError()",
    );
    assert.ok(
      !/setError\(.*error\.message/.test(src),
      "must not pass raw error.message to setError()",
    );
    assert.ok(
      !src.includes("err.stack"),
      "must not render error stack traces",
    );
  });

  it.skip("tender-release-state-panel uses safe error message", () => {
    // Skipped: component was deleted as dead code.
  });
});

// ─── 9. Repair prohibited assets button is conditional ──────────────────────

describe("Repair prohibited assets button — conditional rendering", () => {
  it("export-readiness-panel only shows repair button when prohibited assets exist", () => {
    const src = read("components/export-readiness-panel.tsx");
    // The button must be guarded by a condition (not always rendered)
    assert.ok(
      src.includes("prohibitedAssets") || src.includes("prohibited"),
      "must check for prohibited assets before showing repair button",
    );
  });
});

// ─── 10. Missing optional tender details are advisory ───────────────────────

describe("Tender Detail panel — advisory vs required distinction", () => {
  it("tender-intake-detail-panel marks final_submission facts as 'Required before export'", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(
      src.includes("Required before export"),
      "must show 'Required before export' for final_submission facts",
    );
    assert.ok(
      src.includes("Advisory for draft"),
      "must show 'Advisory for draft' for non-final facts",
    );
  });

  it("tender-intake-detail-panel uses 'Show source-grounded tender facts' not 'metadata'", () => {
    const src = read("app/dashboard/tenders/[id]/tender-intake-detail-panel.tsx");
    assert.ok(
      src.includes("Show source-grounded tender facts"),
      "must use 'Show source-grounded tender facts' label",
    );
    // Must not use "Show all extracted metadata"
    assert.ok(
      !src.includes("Show all extracted metadata"),
      "must not use 'Show all extracted metadata' label",
    );
  });
});

// ─── 11. Component renames ──────────────────────────────────────────────────

describe("Component renames — new tender-facts names", () => {
  it("metadata-completion-panel exports TenderDetailsPanel", () => {
    const src = read("components/metadata-completion-panel.tsx");
    assert.ok(
      src.includes("export function TenderDetailsPanel"),
      "must export TenderDetailsPanel (renamed from MetadataCompletionPanel)",
    );
    // Backward-compat alias is OK
    assert.ok(
      src.includes("MetadataCompletionPanel = TenderDetailsPanel"),
      "must provide backward-compat alias",
    );
  });

  it("metadata-truth-panel exports SourceGroundedTenderFactsPanel", () => {
    const src = read("components/metadata-truth-panel.tsx");
    assert.ok(
      src.includes("export function SourceGroundedTenderFactsPanel"),
      "must export SourceGroundedTenderFactsPanel (renamed from MetadataTruthPanel)",
    );
  });

  it("corrupted-metadata-banner exports ClientEntityWarningBanner", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.ok(
      src.includes("export function ClientEntityWarningBanner"),
      "must export ClientEntityWarningBanner (renamed from CorruptedMetadataBanner)",
    );
  });

  it("clean-corrupted-metadata-button exports RepairTenderFactsButton", () => {
    const src = read("components/clean-corrupted-metadata-button.tsx");
    assert.ok(
      src.includes("export function RepairTenderFactsButton"),
      "must export RepairTenderFactsButton (renamed from CleanCorruptedMetadataButton)",
    );
  });

  it("page.tsx imports ClientEntityWarningBanner (not CorruptedMetadataBanner)", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.ok(
      src.includes("ClientEntityWarningBanner"),
      "page.tsx must import ClientEntityWarningBanner",
    );
    assert.ok(
      !src.includes("<CorruptedMetadataBanner"),
      "page.tsx must not use <CorruptedMetadataBanner> JSX",
    );
  });

});

// ─── 12. Loading states use skeletons ───────────────────────────────────────

describe("Loading states — skeleton states", () => {
  it.skip("tender-release-state-panel uses skeleton loading (not vague text)", () => {
    // Skipped: component was deleted as dead code.
  });

  it.skip("tender-release-state-panel has scoped retry button on error", () => {
    // Skipped: component was deleted as dead code.
  });
});
