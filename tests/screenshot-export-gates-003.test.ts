// Screenshot-Export-003 — Report, Document, and Export Gate Tests
//
// These tests prove the gaps identified in Issue #1136:
//   1. Tender.currency is nullable; corrupted tenders show "Not extracted" not "USD"
//   2. Report preview gates Print/Save-as-PDF behind canonical final-submission readiness
//   3. Export page derives readiness from canonical server authority, not local computation
//   4. Documents page filters planned/pending/FAILED rows from the "generated" count
//   5. No planned/pending row counts as generated, ready, downloadable, or ZIP-eligible
//   6. One canonical blocker model + one next action drives the UI

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Gap 1: Tender.currency is nullable (schema + migration) ──────────────

describe("[SCREENSHOT-EXPORT-003] Gap 1 — Tender.currency nullable", () => {
  it("schema declares Tender.currency as nullable (String?) with no @default", () => {
    const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
    // Find the Tender model block and check the currency field
    const tenderModelMatch = schema.match(/model Tender \{[\s\S]*?\}/);
    assert.ok(tenderModelMatch, "Tender model must exist in schema");
    const tenderModel = tenderModelMatch[0];
    // currency must be String? (nullable) and must NOT have @default
    assert.match(tenderModel, /currency\s+String\?/, "Tender.currency must be String? (nullable)");
    assert.doesNotMatch(
      tenderModel,
      /currency\s+String.*@default/,
      "Tender.currency must NOT have @default — the USD default caused corrupted tenders to show 'Currency: USD'",
    );
  });

  it("migration drops the USD default and NOT NULL constraint", () => {
    const migrationDir = resolve("prisma/migrations");
    const fs = require("node:fs");
    const dirs = fs.readdirSync(migrationDir).filter((d: string) => d.includes("tender_currency_nullable"));
    assert.ok(dirs.length >= 1, "migration directory for currency nullable must exist");
    const migrationSql = fs.readFileSync(
      resolve(migrationDir, dirs[0], "migration.sql"),
      "utf8",
    );
    assert.match(migrationSql, /ALTER COLUMN "currency" DROP DEFAULT/i, "migration must drop the USD default");
    assert.match(migrationSql, /ALTER COLUMN "currency" DROP NOT NULL/i, "migration must drop NOT NULL constraint");
  });

  it("migration does NOT clear any existing currency values (status is not proof of contamination)", () => {
    const migrationDir = resolve("prisma/migrations");
    const fs = require("node:fs");
    const dirs = fs.readdirSync(migrationDir).filter((d: string) => d.includes("tender_currency_nullable"));
    const migrationSql = fs.readFileSync(
      resolve(migrationDir, dirs[0], "migration.sql"),
      "utf8",
    );
    // Per REVISION_REQUIRED item 2: status is NOT proof that currency was
    // default-contaminated. The migration must NOT contain any UPDATE that
    // clears currency values. Legacy values are preserved; only the schema
    // default is removed for new writes.
    assert.doesNotMatch(
      migrationSql,
      /UPDATE "Tender" SET "currency" = NULL/i,
      "migration must NOT clear any existing currency values — status is not proof of contamination. Use a separate audited cleanup command for legacy data.",
    );
    assert.match(
      migrationSql,
      /ALTER COLUMN "currency" DROP DEFAULT/i,
      "migration must drop the USD default for new writes",
    );
    assert.match(
      migrationSql,
      /ALTER COLUMN "currency" DROP NOT NULL/i,
      "migration must drop NOT NULL constraint so NULL is valid",
    );
  });
});

// ─── Gap 2: Report page gates Print behind canonical readiness ────────────

describe("[SCREENSHOT-EXPORT-003] Gap 2 — Report page Print/Save-as-PDF gating", () => {
  it("report page imports getFinalSubmissionReadiness (canonical authority)", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("getFinalSubmissionReadiness"),
      "report page must import getFinalSubmissionReadiness from final-submission-readiness",
    );
  });

  it("report page renders PrintButton only when isAuthoritative is true", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      /isAuthoritative \? \(\s*<PrintButton/.test(src),
      "report page must conditionally render PrintButton only when isAuthoritative is true",
    );
  });

  it("report page shows a non-authoritative preview banner when not ready", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("Non-authoritative"),
      "report page must show a non-authoritative preview banner when not ready",
    );
    assert.ok(
      /does not create a GeneratedDocument/i.test(src),
      "banner must state it creates zero GeneratedDocument/PDF/ZIP rows",
    );
  });

  it("report page renders 'Not extracted' when currency is null", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    // The currencyDisplay helper must produce "Not extracted" when currency is null
    assert.ok(
      src.includes("Not extracted"),
      "report page must render 'Not extracted' when tender.currency is null",
    );
    // The currencyDisplay variable must be used in the header
    assert.ok(
      src.includes("currencyDisplay"),
      "report page must use the currencyDisplay variable (not raw tender.currency)",
    );
  });
});

// ─── Gap 3: Export page uses canonical server authority ────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 3 — Export page canonical readiness", () => {
  it("export page imports getFinalSubmissionReadiness", () => {
    const src = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.ok(
      src.includes("getFinalSubmissionReadiness"),
      "export page must import getFinalSubmissionReadiness (canonical server authority)",
    );
  });

  it("export page calls getFinalSubmissionReadiness per tender", () => {
    const src = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.ok(
      /getFinalSubmissionReadiness\(prisma,/.test(src),
      "export page must call getFinalSubmissionReadiness for each tender",
    );
  });

  it("export page derives isReady from canonical authority, not local computation", () => {
    const src = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    // The old local computation was: const isReady = blockingGaps === 0 && generated.length > 0;
    // The new derivation must use isCanonicalReady
    assert.ok(
      /const isReady = isCanonicalReady/.test(src),
      "export page must derive isReady from isCanonicalReady (canonical authority), not local computation",
    );
    // Must NOT use the old local-only pattern
    assert.doesNotMatch(
      src,
      /const isReady = blockingGaps === 0 && generated\.length > 0/,
      "export page must NOT use the old local isReady computation",
    );
  });

  it("export page passes canonicalBlockerCodes and canonicalNextAction to the card", () => {
    const src = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.ok(
      src.includes("canonicalBlockerCodes="),
      "export page must pass canonicalBlockerCodes to ExportTenderCard",
    );
    assert.ok(
      src.includes("canonicalNextAction="),
      "export page must pass canonicalNextAction to ExportTenderCard",
    );
  });
});

// ─── Gap 4: Documents page canonical readiness ─────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 4 — Documents page canonical readiness", () => {
  it("documents page fetches export-readiness per tender", () => {
    const src = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");
    assert.ok(
      /\/api\/tenders\/\$\{t\.id\}\/export-readiness/.test(src),
      "documents page must fetch /api/tenders/[id]/export-readiness per tender",
    );
  });

  it("documents page gates ZIP behind canonicalReady", () => {
    const src = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");
    // The old pattern was: {generated.length > 0 && (<button onClick={downloadZip}>)}
    // The new pattern must use canZip which includes canonicalReady
    assert.ok(
      /const canZip = canonicalReady && generated\.length > 0 && canonicalBlockerCodes\.length === 0/.test(src),
      "documents page must gate ZIP behind canZip (canonicalReady AND generated AND no blockers)",
    );
    assert.ok(
      /\{canZip && \(/.test(src),
      "documents page must render ZIP button only when canZip is true",
    );
  });

  it("documents page shows 'ZIP locked' when canonical readiness not met", () => {
    const src = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");
    assert.ok(
      src.includes("ZIP locked"),
      "documents page must show 'ZIP locked' when canonical readiness not met",
    );
  });

  it("documents page gates per-document download behind canZip", () => {
    const src = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");
    // The old pattern was: {doc.generationStatus === "GENERATED" && (<button onClick={downloadDoc}>)}
    // The new pattern must use canZip
    assert.ok(
      /doc\.generationStatus === "GENERATED" && canZip && \(/.test(src),
      "documents page must gate per-document download behind canZip (not just generationStatus === GENERATED)",
    );
  });
});

// ─── Gap 5: Planned/PENDING/FAILED never count as generated ────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 5 — Planned/PENDING/FAILED exclusion", () => {
  it("export-tender-card filters documents to GENERATED only for download", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    // The canDownload check must require isGen (GENERATED) AND isReady AND no canonical blockers
    assert.ok(
      /const canDownload = isGen && isReady && canonicalBlockerCodes\.length === 0/.test(src),
      "export-tender-card must gate download on isGen AND isReady AND no canonical blockers",
    );
  });

  it("export-tender-card shows pending/failed status on non-generated rows", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.ok(
      /isPending = doc\.generationStatus === "PLANNED" \|\| doc\.generationStatus === "GENERATING" \|\| doc\.generationStatus === "QUEUED"/.test(src),
      "export-tender-card must classify PLANNED/GENERATING/QUEUED as pending",
    );
    assert.ok(
      /isFailed = doc\.generationStatus === "FAILED"/.test(src),
      "export-tender-card must classify FAILED separately",
    );
  });

  it("export-tender-card document checklist label says 'generated — planned/pending excluded'", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.ok(
      src.includes("planned/pending excluded"),
      "document checklist label must clarify planned/pending are excluded from the count",
    );
  });

  it("export page filters generated to GENERATEd only (not PLANNED/PENDING)", () => {
    const src = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.ok(
      /const generated = tender\.generatedDocuments\.filter\(\(d\) => d\.generationStatus === "GENERATED"\)/.test(src),
      "export page must filter generatedDocuments to GENERATED status only",
    );
  });
});

// ─── Gap 6: One canonical blocker model + one next action ──────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 6 — One canonical blocker model", () => {
  it("export-tender-card shows canonical blocker codes as a list", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.ok(
      /Canonical export blockers/.test(src),
      "export-tender-card must show a 'Canonical export blockers' section",
    );
    assert.ok(
      /canonicalBlockerCodes\.map\(\(code\) =>/.test(src),
      "export-tender-card must render each canonical blocker code",
    );
  });

  it("export-tender-card shows one next action derived from the server result", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.ok(
      /Next action:/.test(src),
      "export-tender-card must show 'Next action:' label",
    );
    assert.ok(
      /canonicalNextAction/.test(src),
      "export-tender-card must render canonicalNextAction from the server result",
    );
  });

  it("export-tender-card does NOT show a vague 'Not ready' without a reason", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    // The 'Not ready' badge may still exist, but there must be a canonical
    // blocker section that explains WHY — not just a bare "Not ready".
    assert.ok(
      /canonicalBlockerCodes\.length > 0/.test(src),
      "export-tender-card must check canonicalBlockerCodes.length to decide whether to show the blocker section",
    );
  });
});

// ─── Responsive: export card works at 390/1024/1440 ────────────────────────

describe("[SCREENSHOT-EXPORT-003] Responsive — export card viewports", () => {
  it("export-tender-card uses responsive classes (flex-wrap, shrink-0)", () => {
    const src = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.ok(
      src.includes("flex-wrap"),
      "export-tender-card must use flex-wrap for responsive button layout",
    );
    assert.ok(
      src.includes("shrink-0"),
      "export-tender-card must use shrink-0 to prevent button compression",
    );
  });

  it("documents page table uses table-scroll wrapper for mobile", () => {
    const src = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");
    assert.ok(
      src.includes("table-scroll"),
      "documents page must use table-scroll wrapper for horizontal scrolling on mobile",
    );
  });

  it("report page uses max-w-4xl with responsive print styles", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("max-w-4xl"),
      "report page must use max-w-4xl for desktop readability",
    );
    assert.ok(
      src.includes("print:max-w-none"),
      "report page must use print:max-w-none for full-width printing",
    );
  });
});
