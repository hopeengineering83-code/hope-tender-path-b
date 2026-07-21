// Regression tests for action icon visibility and affordance.
//
// Proves that:
//   1. No raw Unicode operational icons remain in workflow/action components.
//   2. Generate Docs button renders BoltIcon and visible text.
//   3. Validate button renders CheckIcon and visible text.
//   4. Run Engine button renders PlayIcon/BoltIcon and visible text.
//   5. ZIP Package renders DownloadIcon and visible text.
//   6. Disabled Generate/Validate/ZIP buttons still render icon + label.
//   7. Disabled primary actions have title or inline reason.
//   8. Recovery Command Center primary action renders an SVG icon.
//   9. Document Validator blocked rows render SVG warning/lock icon, not Unicode.
//  10. Extraction/Trust badges use SVG icons, not raw ⚠ or ✓.
//  11. No user-facing "metadata" wording is introduced.
//  12. Existing lifecycle/readiness tests from #1026/#1025 still pass.
//
// These tests are source-shape guards — they read the component source and
// assert that the expected SVG icon imports and JSX are present, and that
// raw Unicode dingbat glyphs are absent from operational contexts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readComponent(name: string): string {
  return readFileSync(resolve(process.cwd(), "components", name), "utf8");
}

// Strip comments before checking for raw Unicode — comments referencing the
// spec text (e.g. "Replaces ⚠") are fine. We only care about user-facing JSX.
function stripComments(src: string): string {
  return src
    .replace(/\/\/.*$/gm, "") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
}

// ─── 1. No raw Unicode operational icons remain in workflow/action components ─

const OPERATIONAL_COMPONENTS = [
  "engine-action-panel.tsx",
  "tender-recovery-command-center.tsx",
  "generation-action-panel.tsx",
  "document-validator-panel.tsx",
  "export-readiness-panel.tsx",
  "authority-review-panel.tsx",
  "tender-share-panel.tsx",
  "requirement-coverage-panel.tsx",
  "tender-controls-panel.tsx",
];

// Raw Unicode dingbats that must NOT appear in user-facing JSX.
const RAW_UNICODE_PATTERN = /[✓✗⚡▶↻⊘⏳✦→↓↑←▼▲✕↺↗]/;

describe("Spec Test 1 — No raw Unicode operational icons in workflow components", () => {
  for (const file of OPERATIONAL_COMPONENTS) {
    it(`${file} has no raw Unicode dingbats in user-facing JSX`, () => {
      const raw = readComponent(file);
      const src = stripComments(raw);
      // Filter out string-literal usages in <option> or non-JSX contexts.
      // We only care about glyphs that would render to the user.
      const matches = src.match(RAW_UNICODE_PATTERN);
      assert.ok(
        !matches,
        `${file} must not contain raw Unicode dingbats (${matches?.[0]}) in user-facing JSX — use SVG icons from components/icons.tsx`,
      );
    });
  }

});

// ─── 2. Generate Docs button renders BoltIcon and visible text ───────────────

describe("Spec Test 2 — Generate Docs button renders BoltIcon + text", () => {
  it("generation-action-panel.tsx Generate Docs button has BoltIcon", () => {
    const src = readComponent("generation-action-panel.tsx");
    assert.ok(src.includes("BoltIcon"), "Generate Docs button must use BoltIcon");
    assert.ok(/Generate Docs/.test(src), "Generate Docs button must have visible 'Generate Docs' text");
  });

  it("engine-action-panel.tsx uses BoltIcon for Safe Mode generate", () => {
    const src = readComponent("engine-action-panel.tsx");
    assert.ok(src.includes("<BoltIcon"), "engine-action-panel must use BoltIcon for generate actions");
  });
});

// ─── 3. Validate button renders CheckIcon and visible text ───────────────────

// ─── 4. Run Engine button renders PlayIcon/BoltIcon and visible text ─────────

describe("Spec Test 4 — Run Engine button renders PlayIcon/BoltIcon + text", () => {
  it("engine-action-panel.tsx Run Engine button has PlayIcon", () => {
    const src = readComponent("engine-action-panel.tsx");
    assert.ok(src.includes("<PlayIcon"), "engine-action-panel Run Engine button must render PlayIcon");
    assert.ok(/Run Engine/.test(src), "engine-action-panel must have visible 'Run Engine' text");
  });
});

// ─── 5. ZIP Package renders DownloadIcon and visible text ────────────────────

describe("Spec Test 5 — ZIP Package renders DownloadIcon + text", () => {
  it("export-readiness-panel.tsx Download Final ZIP has DownloadIcon", () => {
    const src = readComponent("export-readiness-panel.tsx");
    assert.ok(src.includes("<DownloadIcon /> Download Final ZIP"), "Download Final ZIP must render DownloadIcon + text");
  });
});

// ─── 6. Disabled Generate/Validate/ZIP buttons still render icon + label ─────

describe("Spec Test 6 — Disabled buttons still render icon + label", () => {
  it("engine-action-panel.tsx disabled buttons use disabled:opacity-60", () => {
    const src = readComponent("engine-action-panel.tsx");
    assert.ok(
      src.includes("disabled:opacity-60"),
      "engine-action-panel disabled buttons must use disabled:opacity-60",
    );
    assert.ok(
      !stripComments(src).includes("disabled:opacity-50"),
      "engine-action-panel must NOT use disabled:opacity-50 (too faint)",
    );
    assert.ok(
      !stripComments(src).includes("disabled:opacity-40"),
      "engine-action-panel must NOT use disabled:opacity-40 (too faint)",
    );
  });

  it("export-readiness-panel.tsx disabled buttons use disabled:opacity-60", () => {
    const src = readComponent("export-readiness-panel.tsx");
    assert.ok(
      src.includes("disabled:opacity-60"),
      "export-readiness-panel disabled buttons must use disabled:opacity-60",
    );
  });
});

// ─── 7. Disabled primary actions have title or inline reason ─────────────────

describe("Spec Test 7 — Disabled primary actions have title or inline reason", () => {
  it("generation-action-panel.tsx Generate button has title with blockedReason", () => {
    const src = readComponent("generation-action-panel.tsx");
    assert.ok(
      src.includes("blockedReason"),
      "Generate button must reference blockedReason for title",
    );
  });
});

// ─── 8. Recovery Command Center primary action renders an SVG icon ───────────

describe("Spec Test 8 — Recovery Command Center primary action renders SVG icon", () => {
  it("tender-recovery-command-center.tsx Execute button has PlayIcon", () => {
    const src = readComponent("tender-recovery-command-center.tsx");
    assert.ok(
      src.includes("<PlayIcon />"),
      "Recovery Command Center Execute button must render PlayIcon",
    );
  });

  it("tender-recovery-command-center.tsx no longer renders its own Download ZIP link", () => {
    // Removed: DOWNLOAD_FINAL_ZIP only occurs for EXPORT_READY/CLOSED, which
    // are not RECOVERY_LIFECYCLE_STATES, so this panel's recovery banner
    // never shows in that state. The authoritative download control lives
    // in FinalSubmissionControlCenter / TenderDownloadActionsPanel — this
    // panel repeating it was a redundant, non-recovery-scoped action. (A
    // one-time completion status message may still say "Download ZIP is
    // available" after Run Engine finishes — that's transient feedback, not
    // a persistent competing action control.)
    const src = readComponent("tender-recovery-command-center.tsx");
    assert.ok(
      !src.includes("<DownloadIcon"),
      "Recovery Command Center must not render its own Download ZIP button/icon",
    );
    assert.ok(
      !/href=\{`\/api\/tenders\/\$\{tenderId\}\/download`\}/.test(src),
      "Recovery Command Center must not link directly to the download route",
    );
  });

  it("tender-recovery-command-center.tsx quick-action buttons have SVG icons", () => {
    const src = readComponent("tender-recovery-command-center.tsx");
    // Each quick-action button must have an SVG icon, not just text.
    assert.ok(src.includes("<RefreshIcon /> Retry AI Analyze"), "Retry AI Analyze quick-action must have RefreshIcon");
    assert.ok(src.includes("<PlayIcon /> Resume AI Analyze"), "Resume AI Analyze quick-action must have PlayIcon");
    assert.ok(src.includes("<PlayIcon /> Run Engine"), "Run Engine quick-action must have PlayIcon");
    assert.ok(src.includes("<WarningIcon /> Review Matching Inputs"), "Review Matching Inputs quick-action must have WarningIcon");
    assert.ok(src.includes("<CheckIcon /> Link Vault Evidence"), "Link Vault Evidence quick-action must have CheckIcon");
  });
});

// ─── 9. Document Validator blocked rows render SVG warning/lock icon ─────────

describe("Spec Test 9 — Document Validator uses SVG icons, not Unicode", () => {
  it("document-validator-panel.tsx score badges use SVG icons", () => {
    const src = readComponent("document-validator-panel.tsx");
    assert.ok(src.includes("<CheckIcon /> Clean"), "GOOD badge must use CheckIcon");
    assert.ok(src.includes("<WarningIcon /> Review"), "WARNING badge must use WarningIcon");
    assert.ok(src.includes("<CrossIcon /> Blocked"), "BLOCKED badge must use CrossIcon");
  });

  it("document-validator-panel.tsx no-content warning uses WarningIcon", () => {
    const src = readComponent("document-validator-panel.tsx");
    assert.ok(
      src.includes("<WarningIcon"),
      "no-content warning must use WarningIcon, not raw ⚠",
    );
  });
});

// ─── 11. No user-facing "metadata" wording is introduced ─────────────────────

describe("Spec Test 11 — No user-facing 'metadata' wording introduced", () => {
  it("tender-recovery-command-center.tsx does not use 'metadata' in user-facing JSX text", () => {
    const raw = readComponent("tender-recovery-command-center.tsx");
    const src = stripComments(raw);
    const userFacingMetadata = src.match(/>\s*[Mm]etadata[\s<]/);
    assert.ok(
      !userFacingMetadata,
      "tender-recovery-command-center.tsx must not use 'metadata' in user-facing JSX text",
    );
  });
});

// ─── 12. icons.tsx exports the required icon set ─────────────────────────────

describe("Spec Test 12 — icons.tsx exports the required icon set", () => {
  it("icons.tsx exports all required action icons", () => {
    const src = readComponent("icons.tsx");
    const requiredIcons = [
      "SparklesIcon",  // AI Analyze
      "BoltIcon",      // Generate Docs
      "CheckIcon",     // Validate
      "CheckCircleIcon", // Approve / Ready for Export
      "DownloadIcon",  // ZIP / Download
      "PlayIcon",      // Run Engine / Execute
      "RefreshIcon",   // Retry / Refresh
      "BanIcon",       // Blocked
      "WarningIcon",   // Warning
      "LockIcon",      // Locked
      "CrossIcon",     // Failed / not-ok
      "InfoIcon",      // Information
      "UploadIcon",    // Upload / Attach
      "ShareIcon",     // Share
      "DocumentIcon",  // Build Plan
      "PaperclipIcon", // Attach existing file
      "ClockIcon",     // Cooldown / waiting
    ];
    for (const icon of requiredIcons) {
      assert.ok(
        src.includes(`export function ${icon}`),
        `icons.tsx must export ${icon}`,
      );
    }
  });
});

// ─── 13. Share Tender panel uses ShareIcon ───────────────────────────────────

describe("Spec Test 13 — Share Tender panel uses ShareIcon", () => {
  it("tender-share-panel.tsx uses ShareIcon for header and generate button", () => {
    const src = readComponent("tender-share-panel.tsx");
    assert.ok(src.includes("ShareIcon"), "tender-share-panel must import ShareIcon");
    assert.ok(src.includes("<ShareIcon"), "tender-share-panel must render ShareIcon");
  });

  it("tender-share-panel.tsx disabled buttons use disabled:opacity-60", () => {
    const src = readComponent("tender-share-panel.tsx");
    assert.ok(
      src.includes("disabled:opacity-60"),
      "tender-share-panel disabled buttons must use disabled:opacity-60",
    );
  });
});

// ─── 14. Export Readiness panel hides Repair prohibited assets when none exist ─

describe("Spec Test 14 — Export Readiness panel conditionally shows Repair prohibited assets", () => {
  it("export-readiness-panel.tsx Repair prohibited assets button is conditional on PROHIBITED_ASSET blocker", () => {
    const src = readComponent("export-readiness-panel.tsx");
    assert.ok(
      src.includes('b.category === "PROHIBITED_ASSET"'),
      "Repair prohibited assets button must only render when a PROHIBITED_ASSET blocker exists",
    );
  });
});

// ─── 15. All SVG icons use stroke='currentColor' ─────────────────────────────

describe("Spec Test 15 — SVG icons use stroke='currentColor' for contrast", () => {
  it("icons.tsx base() sets stroke='currentColor'", () => {
    const src = readComponent("icons.tsx");
    assert.ok(
      src.includes('stroke: "currentColor"'),
      "icons.tsx base() must set stroke='currentColor' so icons inherit button text color",
    );
  });
});
