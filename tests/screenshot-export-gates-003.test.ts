import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Gap 1: Tender.currency nullable ─────────────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 1 — Tender.currency nullable", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
  const migration = readFileSync(resolve("prisma/migrations/20260714180000_make_tender_currency_nullable/migration.sql"), "utf8");

  it("schema makes Tender.currency nullable", () => {
    assert.match(schema, /currency\s+String\?/);
  });

  it("migration drops NOT NULL and the default", () => {
    assert.match(migration, /ALTER COLUMN "currency" DROP NOT NULL/);
    assert.match(migration, /ALTER COLUMN "currency" DROP DEFAULT/);
  });

  it("migration does NOT clear any existing currency values", () => {
    assert.doesNotMatch(migration, /UPDATE\s+"Tender"[\s\S]*"currency"\s*=\s*NULL/i);
  });
});

// ─── Gap 2: Report Print/Save-as-PDF gating ─────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 2 — Report page Print/Save-as-PDF gating", () => {
  const source = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");

  it("report page imports getFinalSubmissionReadiness", () => {
    assert.match(source, /getFinalSubmissionReadiness/);
  });

  it("report page renders PrintButton only when isAuthoritative is true", () => {
    assert.match(source, /\{isAuthoritative && <PrintButton/);
  });

  it("report page shows a non-authoritative preview banner when not ready", () => {
    assert.match(source, /Non-authoritative preview/);
  });

  it("report page renders 'Not extracted' when currency is null", () => {
    assert.match(source, /Not extracted/);
  });
});

// ─── Gap 3: Export page canonical readiness ──────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 3 — Export page canonical readiness", () => {
  it("export page imports getFinalSubmissionReadiness", () => {
    const source = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.match(source, /getFinalSubmissionReadiness/);
  });

  it("export page calls getFinalSubmissionReadiness per tender", () => {
    const source = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.match(source, /getFinalSubmissionReadiness\(/);
  });

  it("export page derives isReady from canonical authority, not local computation", () => {
    const source = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.match(source, /isReady.*readyForFinalExport|readyForFinalExport.*isReady/s);
    assert.doesNotMatch(source, /const isReady = blockingGaps === 0 && generated\.length > 0/);
  });

  it("export page passes canonicalBlockerCodes and canonicalNextAction to the card", () => {
    const source = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");
    assert.ok(source.includes("canonicalBlockerCodes="));
    assert.ok(source.includes("canonicalNextAction="));
  });
});

// ─── Gap 4: Documents page canonical readiness ─────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 4 — Documents page canonical readiness", () => {
  const source = readFileSync(resolve("app/dashboard/documents/page.tsx"), "utf8");

  it("documents page fetches export-readiness for every loaded tender", () => {
    assert.match(source, /tenderList\.map\(async \(tender\) =>/);
    assert.match(source, /fetch\(`\/api\/tenders\/\$\{tender\.id\}\/export-readiness`/);
    assert.match(source, /cache: "no-store"/);
  });

  it("documents page gates ZIP behind canonicalReady", () => {
    assert.match(source, /const canZip = canonicalReady && generated\.length > 0 && canonicalBlockerCodes\.length === 0/);
    assert.match(source, /\{canZip && \(/);
  });

  it("documents page shows 'ZIP locked' when canonical readiness is not met", () => {
    assert.ok(source.includes("ZIP locked"));
    assert.match(source, /READINESS_UNAVAILABLE/);
  });

  it("documents page gates each generated-document download behind canZip", () => {
    assert.match(source, /document\.generationStatus === "GENERATED" && canZip && \(/);
    assert.match(source, /document\.generationStatus === "GENERATED" && !canZip && \(/);
  });

  it("uses the same document-plus-readiness loader after review actions", () => {
    assert.match(source, /async function fetchDocumentsWithReadiness/);
    assert.match(source, /const tenderList = await fetchDocumentsWithReadiness\(\)/);
    assert.doesNotMatch(source, /setTenders\(await res\.json\(\)\)/);
  });
});

// ─── Gap 5: Planned/PENDING/FAILED never count as generated ─────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 5 — Planned/PENDING/FAILED exclusion", () => {
  it("export-tender-card filters documents to GENERATED only for download", () => {
    const source = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.match(source, /const canDownload = isGen && isReady && canonicalBlockerCodes\.length === 0/);
  });

  it("export-tender-card shows pending/failed status on non-generated rows", () => {
    const source = readFileSync(resolve("app/dashboard/export/export-tender-card.tsx"), "utf8");
    assert.match(source, /isPending = doc\.generationStatus === "PLANNED" \|\| doc\.generationStatus === "GENERATING" \|\| doc\.generationStatus === "QUEUED"/);
    assert.match(source, /isFailed = doc\.generationStatus === "FAILED"/);
  });
});
