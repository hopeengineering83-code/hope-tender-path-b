// Final gap closure — regression tests for file-byte-integrity and evidence quotes.
//
// Tests:
//   GAP F: file-byte-integrity (SHA-256 verification)
//   GAP J: Evidence quotes injected into generation prompt
//   Gaps M-S: No raw Unicode in remaining components

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── GAP F: file-byte-integrity ──────────────────────────────────────────────

describe("GAP F — file-byte-integrity", () => {
  it("lib/engine/file-byte-integrity.ts exists", () => {
    assert.ok(existsSync("lib/engine/file-byte-integrity.ts"), "file-byte-integrity.ts must exist");
  });

  it("exports sha256Buffer, verifyFileBytes, computeDigestFromBase64, buildManifestEntry", () => {
    const src = read("lib/engine/file-byte-integrity.ts");
    assert.match(src, /export function sha256Buffer/);
    assert.match(src, /export function verifyFileBytes/);
    assert.match(src, /export function computeDigestFromBase64/);
    assert.match(src, /export function buildManifestEntry/);
  });

  it("uses timingSafeEqual for hash comparison (prevents timing attacks)", () => {
    const src = read("lib/engine/file-byte-integrity.ts");
    assert.match(src, /timingSafeEqual/);
  });

  it("has structured blocker codes", () => {
    const src = read("lib/engine/file-byte-integrity.ts");
    assert.match(src, /FILE_DIGEST_MISSING/);
    assert.match(src, /FILE_INTEGRITY_HASH_MISMATCH/);
    assert.match(src, /FILE_SIZE_MISMATCH/);
    assert.match(src, /FILE_BYTES_MISSING/);
  });

  it("schema has sha256 + byteSize on GeneratedDocument", () => {
    const src = read("prisma/schema.prisma");
    assert.match(src, /sha256\s+String\?/);
    assert.match(src, /byteSize\s+Int\?/);
  });

  it("schema has sha256 + byteSize on TenderFile", () => {
    const src = read("prisma/schema.prisma");
    // Both models should have these columns
    const genDocSection = src.indexOf("model GeneratedDocument");
    const tenderFileSection = src.indexOf("model TenderFile");
    assert.ok(genDocSection > -1);
    assert.ok(tenderFileSection > -1);
    // Verify sha256 appears in both sections
    const genDocEnd = src.indexOf("}", genDocSection);
    const tenderFileEnd = src.indexOf("}", tenderFileSection);
    assert.ok(src.slice(genDocSection, genDocEnd).includes("sha256"), "GeneratedDocument must have sha256");
    assert.ok(src.slice(tenderFileSection, tenderFileEnd).includes("sha256"), "TenderFile must have sha256");
  });

  it("migration exists", () => {
    assert.ok(existsSync("prisma/migrations/20260712000000_add_file_digests/migration.sql"), "migration must exist");
    const sql = read("prisma/migrations/20260712000000_add_file_digests/migration.sql");
    assert.match(sql, /ALTER TABLE "GeneratedDocument" ADD COLUMN "sha256" TEXT/);
    assert.match(sql, /ALTER TABLE "GeneratedDocument" ADD COLUMN "byteSize" INTEGER/);
    assert.match(sql, /ALTER TABLE "TenderFile" ADD COLUMN "sha256" TEXT/);
    assert.match(sql, /ALTER TABLE "TenderFile" ADD COLUMN "byteSize" INTEGER/);
  });

  it("download route wires SHA-256 verification", () => {
    const src = read("app/api/tenders/[id]/download/route.ts");
    assert.match(src, /verifyFileBytes/);
    assert.match(src, /file-byte-integrity/);
    assert.match(src, /integrityResult\.ok/);
    // The route returns integrityResult.code which is one of the FileIntegrityBlockerCode values
    assert.match(src, /code: integrityResult\.code/);
  });
});

// ─── GAP J: Evidence quotes in generation ────────────────────────────────────

describe("GAP J — Evidence quotes injected into generation prompt", () => {
  it("generate-elite.ts passes sourceExactQuote to AI input", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.match(src, /sourceExactQuote/);
    assert.match(src, /sourcePageNumber/);
    assert.match(src, /sourceConfidence/);
  });

  it("formatRequirementLine includes sourceExactQuote in the formatted line", () => {
    const src = read("lib/engine/proposal-labels.ts");
    assert.match(src, /sourceExactQuote/);
    assert.match(src, /quoteTag/);
    assert.match(src, /quote:/);
  });
});

// ─── Gaps M-S: No raw Unicode in remaining components ────────────────────────

describe("Gaps M-S — No raw Unicode in remaining components", () => {
  it("tender-notifications-banner.tsx has no raw Unicode", () => {
    const src = read("components/tender-notifications-banner.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.ok(!codeOnly.includes("⏰"), "must not contain ⏰");
    assert.ok(!codeOnly.includes("⚠"), "must not contain ⚠");
    assert.ok(!codeOnly.includes("→"), "must not contain → (user-facing)");
  });

  it("final-package-manifest-panel.tsx has no raw Unicode check/cross marks", () => {
    const src = read("components/final-package-manifest-panel.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("✓"), "must not contain ✓");
    assert.ok(!codeOnly.includes("✗"), "must not contain ✗");
  });

  it("score-breakdown-panel.tsx has no raw Unicode", () => {
    const src = read("components/score-breakdown-panel.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("▲"), "must not contain ▲");
    assert.ok(!codeOnly.includes("▼"), "must not contain ▼");
    assert.ok(!codeOnly.includes("↻"), "must not contain ↻");
    assert.ok(!codeOnly.includes("⚠"), "must not contain ⚠");
  });

  it("ai-rematch-button.tsx has no raw Unicode", () => {
    const src = read("components/ai-rematch-button.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("✓"), "must not contain ✓");
    assert.ok(!codeOnly.includes("⚠"), "must not contain ⚠");
  });

  it("snapshot-consistency-badge.tsx has no raw Unicode", () => {
    const src = read("components/snapshot-consistency-badge.tsx");
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("⚠"), "must not contain ⚠");
  });

  it("ai-copilot-suggestions-panel.tsx has no emoji icons", () => {
    const src = read("components/ai-copilot-suggestions-panel.tsx");
    // Must NOT contain emoji in icon values
    assert.ok(!/icon:\s*"[^\x00-\x7F]/.test(src), "must not contain emoji in icon values");
    // Must use ICON_MAP with SVG components
    assert.match(src, /ICON_MAP/);
    assert.match(src, /SearchIcon/);
  });

  it("icons.tsx exports SearchIcon", () => {
    const src = read("components/icons.tsx");
    assert.match(src, /export function SearchIcon/);
  });
});

// ─── Gaps T-Z: No raw Unicode in icon-audit round 2 ───────────────────────────

describe("Gaps T-Z — No raw Unicode in icon-audit round 2", () => {
  const strip = (src: string) => src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');

  it("dashboard/analysis/page.tsx has no raw Unicode provisional marker", () => {
    const src = strip(read("app/dashboard/analysis/page.tsx"));
    assert.ok(!src.includes("◐"), "must not contain ◐");
  });

  it("tenders/[id]/command-center/page.tsx has no raw Unicode check/cross marks", () => {
    const src = strip(read("app/dashboard/tenders/[id]/command-center/page.tsx"));
    assert.ok(!src.includes("✓"), "must not contain ✓");
    assert.ok(!src.includes("✗"), "must not contain ✗");
  });

  it("tenders/[id]/report/page.tsx has no raw Unicode warning mark", () => {
    const src = strip(read("app/dashboard/tenders/[id]/report/page.tsx"));
    assert.ok(!src.includes("⚠"), "must not contain ⚠");
  });

  it("matching-dashboard.tsx has no raw Unicode marks", () => {
    const src = strip(read("app/dashboard/matching/matching-dashboard.tsx"));
    assert.ok(!src.includes("✓"), "must not contain ✓");
    assert.ok(!src.includes("▲"), "must not contain ▲");
    assert.ok(!src.includes("▼"), "must not contain ▼");
  });

  it("compliance-dashboard.tsx has no raw Unicode check mark", () => {
    const src = strip(read("app/dashboard/compliance/compliance-dashboard.tsx"));
    assert.ok(!src.includes("✓"), "must not contain ✓");
  });

  it("export-tender-card.tsx has no raw Unicode marks", () => {
    const src = strip(read("app/dashboard/export/export-tender-card.tsx"));
    assert.ok(!src.includes("✕"), "must not contain ✕");
    assert.ok(!src.includes("✓"), "must not contain ✓");
    assert.ok(!src.includes("⋯"), "must not contain ⋯");
    assert.ok(!src.includes("↓"), "must not contain ↓");
  });

  it("company/page.tsx has no raw Unicode marks or emoji", () => {
    const src = strip(read("app/dashboard/company/page.tsx"));
    assert.ok(!src.includes("✓"), "must not contain ✓");
    assert.ok(!src.includes("✕"), "must not contain ✕");
    assert.ok(!src.includes("👤"), "must not contain 👤");
    assert.ok(!src.includes("📁"), "must not contain 📁");
    assert.ok(!src.includes("▼"), "must not contain ▼");
  });

  it("setup/page.tsx has no raw Unicode marks", () => {
    const src = strip(read("app/dashboard/setup/page.tsx"));
    assert.ok(!src.includes("✓"), "must not contain ✓");
    assert.ok(!src.includes("✕"), "must not contain ✕");
  });

  it("documents/page.tsx has no raw Unicode/emoji marks", () => {
    const src = strip(read("app/dashboard/documents/page.tsx"));
    assert.ok(!src.includes("💬"), "must not contain 💬");
    assert.ok(!src.includes("↓"), "must not contain ↓");
  });

  it("vault-evidence-search-panel.tsx has no raw Unicode selection dot", () => {
    const src = strip(read("components/vault-evidence-search-panel.tsx"));
    assert.ok(!src.includes("○"), "must not contain ○");
  });

  it("tender-controls-panel.tsx has no emoji TYPE_CONFIG icons", () => {
    const src = strip(read("components/tender-controls-panel.tsx"));
    for (const glyph of ["📄", "💬", "❓", "🏁", "✅", "💰"]) {
      assert.ok(!src.includes(glyph), `must not contain ${glyph}`);
    }
  });

  it("tender-chat-panel.tsx has no raw Unicode typing-indicator dots", () => {
    const src = strip(read("components/tender-chat-panel.tsx"));
    assert.ok(!src.includes("●"), "must not contain ●");
  });

  it("command-center/version-actions.tsx has no raw Unicode dismiss marks", () => {
    const src = strip(read("app/dashboard/tenders/[id]/command-center/version-actions.tsx"));
    assert.ok(!src.includes("✕"), "must not contain ✕");
  });

  it("evidence-coverage-panel.tsx heading uses ArrowRightIcon, not raw →", () => {
    const src = strip(read("components/evidence-coverage-panel.tsx"));
    assert.ok(!src.includes("→"), "must not contain raw →");
    assert.match(src, /ArrowRightIcon/);
  });

  it("reset-password/page.tsx has no raw Unicode arrow", () => {
    const src = strip(read("app/reset-password/page.tsx"));
    assert.ok(!src.includes("→"), "must not contain →");
  });

  it("tenders/[id]/page.tsx disclosure uses ChevronDownIcon, not raw ⌄", () => {
    const src = strip(read("app/dashboard/tenders/[id]/page.tsx"));
    assert.ok(!src.includes("⌄"), "must not contain ⌄");
  });

  it("tenders/[id]/executive-snapshot.tsx has no raw Unicode arrow", () => {
    const src = strip(read("app/dashboard/tenders/[id]/executive-snapshot.tsx"));
    assert.ok(!src.includes("↗"), "must not contain ↗");
  });

  it("calendar-client.tsx month nav uses chevron icons, not raw triangles", () => {
    const src = strip(read("app/dashboard/calendar/calendar-client.tsx"));
    assert.ok(!src.includes("◀"), "must not contain ◀");
    assert.ok(!src.includes("▶"), "must not contain ▶");
  });

  it("vault-evidence-lists.tsx show-all toggles use chevron icons, not raw triangles", () => {
    const src = strip(read("components/vault-evidence-lists.tsx"));
    assert.ok(!src.includes("▲"), "must not contain ▲");
    assert.ok(!src.includes("▼"), "must not contain ▼");
  });

  it("icons.tsx exports the new icon components used by this round", () => {
    const src = read("components/icons.tsx");
    for (const name of [
      "PersonIcon", "FolderIcon", "ChatIcon", "QuestionIcon", "FlagIcon", "CoinIcon",
      "ChevronUpIcon", "ChevronLeftIcon", "ChevronRightIcon",
    ]) {
      assert.match(src, new RegExp(`export function ${name}`), `must export ${name}`);
    }
  });
});
