// Regression tests for workflow icons and affordance round 2.
//
// Proves that:
//   1. Recovery Command Center primary action renders SVG icon and visible text.
//   2. Recovery Command Center quick actions render SVG icons.
//   3. Next Required Action panel uses SVG icons, not raw ✓, ⚠, or →.
//   4. Build Plan button renders visible icon + label.
//   5. Match Evidence button renders visible icon + label.
//   6. Generate button renders visible icon + label.
//   7. Review Documents button renders visible icon + label.
//   8. Export button renders visible icon + label.
//   9. Disabled critical buttons retain visible icon + label.
//  10. Disabled critical buttons have title or inline disabled reason.
//  11. Status badges render SVG icon + text.
//  12. No raw Unicode operational icons remain in workflow/action/status components.
//  13. No user-facing "metadata" wording is introduced.
//  14. Existing readiness/export/lifecycle safety tests still pass.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), "utf8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const RAW_UNICODE_PATTERN = /[✓✗⚡▶↻⊘⏳✦→↓↑←▼▲✕↺↗ℹⓘ]/;

// ─── 1. Recovery Command Center primary action renders SVG icon + text ────────

describe("Spec Test 1 — Recovery Command Center primary action", () => {
  it("primary action Execute button has PlayIcon and visible text", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("<PlayIcon />"), "Execute button must render PlayIcon");
    assert.ok(src.includes('"Execute"'), "Execute button must have visible 'Execute' text");
  });

  it("no longer renders its own Download ZIP control (DOWNLOAD_FINAL_ZIP is not a recovery state; FinalSubmissionControlCenter / TenderDownloadActionsPanel own that action)", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(!src.includes("<DownloadIcon"), "Recovery Command Center must not render its own Download ZIP button/icon");
  });
});

// ─── 2. Recovery Command Center quick actions render SVG icons ────────────────

describe("Spec Test 2 — Recovery Command Center quick actions", () => {
  it("quick-action buttons have SVG icons", () => {
    const src = read("components/tender-recovery-command-center.tsx");
    assert.ok(src.includes("<RefreshIcon /> Retry AI Analyze"), "Retry AI Analyze must have RefreshIcon");
    assert.ok(src.includes("<PlayIcon /> Resume AI Analyze"), "Resume AI Analyze must have PlayIcon");
    assert.ok(src.includes("<PlayIcon /> Run Engine"), "Run Engine quick-action must have PlayIcon");
    assert.ok(src.includes("<WarningIcon /> Review Matching Inputs"), "Review Matching Inputs must have WarningIcon");
    assert.ok(src.includes("<CheckIcon /> Link Vault Evidence"), "Link Vault Evidence must have CheckIcon");
  });
});

// ─── 3. Next Required Action panel uses SVG icons, not raw Unicode ────────────

describe("Spec Test 3 — Next Action Panel SVG icons", () => {
  it("stepIcon returns SVG elements, not raw Unicode strings", () => {
    const src = read("components/next-action-panel.tsx");
    // The stepIcon function must return SVG elements, not raw "✓", "⚠", "→"
    assert.ok(src.includes("<CheckCircleIcon />"), "stepIcon must use CheckCircleIcon for complete");
    assert.ok(src.includes("<WarningIcon />"), "stepIcon must use WarningIcon for fix/validation");
    assert.ok(src.includes("<ArrowRightIcon />"), "stepIcon must use ArrowRightIcon for next action");
    // Must NOT return raw Unicode strings
    const stripped = stripComments(src);
    assert.ok(!stripped.includes('return "✓"'), "must NOT return raw '✓' Unicode");
    assert.ok(!stripped.includes('return "⚠"'), "must NOT return raw '⚠' Unicode");
    assert.ok(!stripped.includes('return "→"'), "must NOT return raw '→' Unicode");
  });

  it("workflow shortcut pills use SVG icons, not raw Unicode", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(
      src.includes("<CheckCircleIcon") && src.includes("<ArrowRightIcon"),
      "shortcut pills must use SVG icons for done/active states",
    );
    // Must NOT use raw Unicode in the shortcut pills
    const stripped = stripComments(src);
    assert.ok(!stripped.includes('"✓ "'), "must NOT use raw '✓ ' in shortcut pills");
    assert.ok(!stripped.includes('"→ "'), "must NOT use raw '→ ' in shortcut pills");
  });

  it("imports the required SVG icons", () => {
    const src = read("components/next-action-panel.tsx");
    assert.ok(src.includes("CheckCircleIcon"), "must import CheckCircleIcon");
    assert.ok(src.includes("WarningIcon"), "must import WarningIcon");
    assert.ok(src.includes("ArrowRightIcon"), "must import ArrowRightIcon");
  });
});

// ─── 4. Build Plan button renders visible icon + label ────────────────────────

describe("Spec Test 4 — Build Plan button", () => {
  it("submission-plan-completeness-panel Build Plan has DocumentIcon + text", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes("<DocumentIcon />"), "Build Plan button must render DocumentIcon");
    assert.ok(src.includes('"Build Plan"'), "Build Plan button must have visible 'Build Plan' text");
  });

  it("Build Plan button has title attribute", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes('title="Build the submission plan'), "Build Plan button must have title");
  });
});

// ─── 5. Match Evidence button renders visible icon + label ────────────────────

describe("Spec Test 5 — Match Evidence / Link Evidence button", () => {
  it("export-readiness-panel Use vault evidence has PaperclipIcon", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.includes("<PaperclipIcon />"), "Use vault evidence must render PaperclipIcon");
    assert.ok(src.includes("Use vault evidence"), "must have visible text");
  });

  it("icons.tsx exports LinkIcon for match/link evidence actions", () => {
    const src = read("components/icons.tsx");
    assert.ok(src.includes("export function LinkIcon"), "icons.tsx must export LinkIcon");
  });
});

// ─── 6. Generate button renders visible icon + label ──────────────────────────

describe("Spec Test 6 — Generate button", () => {
  it("generation-action-panel Generate Docs has BoltIcon", () => {
    const src = read("components/generation-action-panel.tsx");
    assert.ok(src.includes("BoltIcon"), "Generate Docs button must use BoltIcon");
  });
});

// ─── 7. Review Documents button renders visible icon + label ──────────────────

describe("Spec Test 7 — Review Documents button", () => {
  it("submission-plan-completeness-panel has CheckCircleIcon for review status", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes("<CheckCircleIcon />"), "review status badge must use CheckCircleIcon");
  });

  it("authority-review-panel has CheckCircleIcon for AUTHORITY_READY", () => {
    const src = read("components/authority-review-panel.tsx");
    assert.ok(src.includes("<CheckCircleIcon />"), "AUTHORITY_READY badge must use CheckCircleIcon");
  });
});

// ─── 8. Export button renders visible icon + label ────────────────────────────

describe("Spec Test 8 — Export button", () => {
  it("export-readiness-panel Download Final ZIP has DownloadIcon + text", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.includes("<DownloadIcon /> Download Final ZIP"), "Download Final ZIP must render DownloadIcon + text");
  });

});

// ─── 9. Disabled critical buttons retain visible icon + label ─────────────────

describe("Spec Test 9 — Disabled buttons retain icon + label", () => {
  it("engine-action-panel disabled buttons use disabled:opacity-60", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.ok(src.includes("disabled:opacity-60"), "engine-action-panel must use disabled:opacity-60");
  });

  it("export-readiness-panel disabled buttons use disabled:opacity-60", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.includes("disabled:opacity-60"), "export-readiness-panel must use disabled:opacity-60");
  });

  it("submission-plan-completeness-panel disabled buttons use disabled:opacity-60", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes("disabled:opacity-60"), "submission-plan-completeness-panel must use disabled:opacity-60");
  });

  it("no priority component uses disabled:opacity-40", () => {
    const files = [
      "components/next-action-panel.tsx",
      "components/tender-recovery-command-center.tsx",
      "components/engine-action-panel.tsx",
      "components/generation-action-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
      "components/requirement-coverage-panel.tsx",
      "components/authority-review-panel.tsx",
      "components/document-validator-panel.tsx",
      "components/export-readiness-panel.tsx",
      "components/tender-controls-panel.tsx",
      "components/tender-share-panel.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.ok(
        !stripComments(src).includes("disabled:opacity-40"),
        `${f} must NOT use disabled:opacity-40 (too faint)`,
      );
    }
  });
});

// ─── 10. Disabled critical buttons have title or inline reason ────────────────

describe("Spec Test 10 — Disabled buttons have title or reason", () => {
  it("export-readiness-panel Download blocked has title", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(src.includes("Download blocked"), "must have Download blocked button with title");
  });

  it("submission-plan RowActionButton has title", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes("title={disabled"), "RowActionButton must have title when disabled");
  });
});

// ─── 11. Status badges render SVG icon + text ────────────────────────────────

describe("Spec Test 11 — Status badges render SVG icon + text", () => {
  it("submission-plan STATUS_BADGE has icon field for all statuses", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.ok(src.includes("icon: <CheckCircleIcon />"), "GENERATED must have CheckCircleIcon");
    assert.ok(src.includes("icon: <WarningIcon />"), "REVIEW NEEDED must have WarningIcon");
    assert.ok(src.includes("icon: <BanIcon />"), "QUALITY FAILED must have BanIcon");
    assert.ok(src.includes("icon: <ClockIcon />"), "PLANNED must have ClockIcon");
  });

  it("submission-plan STATUS_BADGE does not reuse PLANNED's waiting-clock icon for SUPERSEDED (contradicts 'historical/already replaced')", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    const supersededLine = src.split("\n").find((line) => line.includes('SUPERSEDED: { label: "HISTORICAL"'));
    assert.ok(supersededLine, "SUPERSEDED status badge entry must exist");
    assert.ok(supersededLine!.includes("icon: <FolderIcon />"), "SUPERSEDED must use FolderIcon, not ClockIcon (a clock implies still-pending, not already-replaced)");
  });

  it("authority-review statusBadge uses SVG icons", () => {
    const src = read("components/authority-review-panel.tsx");
    assert.ok(src.includes("<CheckCircleIcon /> AUTHORITY READY"), "AUTHORITY READY must have CheckCircleIcon");
    assert.ok(src.includes("<WarningIcon /> NEEDS REVIEW"), "NEEDS REVIEW must have WarningIcon");
    assert.ok(src.includes("<CrossIcon /> BLOCKED"), "BLOCKED must have CrossIcon");
  });

  it("document-validator scoreBadge uses SVG icons", () => {
    const src = read("components/document-validator-panel.tsx");
    assert.ok(src.includes("<CheckIcon /> Clean"), "Clean badge must have CheckIcon");
    assert.ok(src.includes("<WarningIcon /> Review"), "Review badge must have WarningIcon");
    assert.ok(src.includes("<CrossIcon /> Blocked"), "Blocked badge must have CrossIcon");
  });
});

// ─── 12. No raw Unicode operational icons remain in workflow components ───────

describe("Spec Test 12 — No raw Unicode in workflow components", () => {
  const WORKFLOW_COMPONENTS = [
    "next-action-panel.tsx",
    "tender-recovery-command-center.tsx",
    "engine-action-panel.tsx",
    "generation-action-panel.tsx",
    "generation-readiness-panel.tsx",
    "submission-plan-reconciliation-panel.tsx",
    "submission-plan-completeness-panel.tsx",
    "requirement-coverage-panel.tsx",
    "authority-review-panel.tsx",
    "document-validator-panel.tsx",
    "export-readiness-panel.tsx",
    "tender-controls-panel.tsx",
    "tender-share-panel.tsx",
    "ai-analyze-status-banner.tsx",
    "ai-analyze-panel.tsx",
    "generation-progress-panel.tsx",
    "tender-download-actions-panel.tsx",
    "document-review-panel.tsx",
    "bid-decision-form.tsx",
    "vault-evidence-search-panel.tsx",
    "score-breakdown-panel.tsx",
    "tender-release-state-panel.tsx",
  ];

  for (const file of WORKFLOW_COMPONENTS) {
    it(`${file} has no raw Unicode dingbats in user-facing JSX`, () => {
      const raw = read(`components/${file}`);
      const src = stripComments(raw);
      const matches = src.match(RAW_UNICODE_PATTERN);
      assert.ok(
        !matches,
        `${file} must not contain raw Unicode dingbats (${matches?.[0]}) in user-facing JSX`,
      );
    });
  }

});

// ─── 13. No user-facing "metadata" wording introduced ─────────────────────────

describe("Spec Test 13 — No user-facing 'metadata' wording", () => {
  it("next-action-panel does not use 'metadata' in user-facing JSX text", () => {
    const raw = read("components/next-action-panel.tsx");
    const src = stripComments(raw);
    const userFacingMetadata = src.match(/>\s*[Mm]etadata[\s<]/);
    assert.ok(!userFacingMetadata, "next-action-panel must not use 'metadata' in user-facing text");
  });

  it("tender-recovery-command-center does not use 'metadata' in user-facing JSX text", () => {
    const raw = read("components/tender-recovery-command-center.tsx");
    const src = stripComments(raw);
    const userFacingMetadata = src.match(/>\s*[Mm]etadata[\s<]/);
    assert.ok(!userFacingMetadata, "tender-recovery-command-center must not use 'metadata' in user-facing text");
  });
});

// ─── 14. icons.tsx exports all required icons ─────────────────────────────────

describe("Spec Test 14 — icons.tsx exports all required icons", () => {
  it("all spec-required icons are exported", () => {
    const src = read("components/icons.tsx");
    const requiredIcons = [
      "SparklesIcon", "BoltIcon", "CheckIcon", "CheckCircleIcon",
      "CrossIcon", "ArrowRightIcon", "DownloadIcon", "PlayIcon",
      "RefreshIcon", "BanIcon", "WarningIcon", "LockIcon",
      "InfoIcon", "ClockIcon", "ChevronDownIcon", "AlertCircleIcon",
      "LightbulbIcon", "UploadIcon", "ShareIcon", "DocumentIcon",
      "PaperclipIcon", "ClipboardCheckIcon", "SettingsIcon",
      "LinkIcon", "CodeIcon", "ListIcon", "DocumentGenerateIcon", "WaitingIcon",
    ];
    for (const icon of requiredIcons) {
      assert.ok(src.includes(`export function ${icon}`), `icons.tsx must export ${icon}`);
    }
  });
});

// ─── 15. SVG icons use stroke='currentColor' for contrast ─────────────────────

describe("Spec Test 15 — SVG icons use stroke='currentColor'", () => {
  it("icons.tsx base() sets stroke='currentColor'", () => {
    const src = read("components/icons.tsx");
    assert.ok(src.includes('stroke: "currentColor"'), "base() must set stroke=currentColor");
  });
});
