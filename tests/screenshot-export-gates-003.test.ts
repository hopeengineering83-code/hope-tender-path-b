import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Gap 1: Tender.currency nullable ─────────────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 1 — Tender.currency nullable", () => {
  const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");

  it("schema makes Tender.currency nullable", () => {
    assert.match(schema, /currency\s+String\?/);
  });

  it("the canonical report treats absent currency as not extracted", () => {
    const report = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.match(report, /const isCurrencyAbsent = !tender\.currency/);
    assert.match(report, /"Not extracted"/);
  });

  it("Prisma zero-drift CI remains the migration-history authority", () => {
    const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
    assert.match(workflow, /Verify Prisma zero drift/);
    assert.match(workflow, /prisma migrate deploy/);
    assert.match(workflow, /--exit-code/);
  });
});

// ─── Gap 2: Report Print/Save-as-PDF gating ─────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 2 — Report page Print/Save-as-PDF gating", () => {
  const source = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");

  it("report page imports getTenderReleaseState (the canonical wrapper around getFinalSubmissionReadiness)", () => {
    assert.match(source, /getTenderReleaseState/);
  });

  it("report page renders PrintButton only in the authoritative ternary branch", () => {
    assert.match(source, /\{isAuthoritative \? \(/);
    assert.match(source, /<PrintButton \/>/);
    assert.match(source, /Print\/Save-as-PDF disabled/);
  });

  it("report page shows a print-visible non-authoritative preview watermark", () => {
    assert.match(source, /NON-AUTHORITATIVE PREVIEW — NOT FOR SUBMISSION/);
    assert.match(source, /This watermark is print-visible/);
  });

  it("report page renders 'Not extracted' when currency is absent", () => {
    assert.match(source, /Not extracted/);
  });
});

// ─── Gap 3: Export page canonical readiness ──────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Gap 3 — Export page canonical readiness", () => {
  const source = readFileSync(resolve("app/dashboard/export/page.tsx"), "utf8");

  it("export page imports and calls getFinalSubmissionReadiness per tender", () => {
    assert.match(source, /getFinalSubmissionReadiness/);
    assert.match(source, /for \(const tender of tenders\)/);
    assert.match(source, /getFinalSubmissionReadiness\(prisma/);
  });

  it("export page derives card readiness from canonical ok and blocker state", () => {
    assert.match(source, /const canonical = readinessByTenderId\.get\(tender\.id\) \?\? null/);
    assert.match(source, /const isCanonicalReady = canonical\?\.ok === true && canonicalBlockers\.length === 0/);
    assert.match(source, /const isReady = isCanonicalReady/);
    assert.match(source, /isReady=\{isReady\}/);
    assert.doesNotMatch(source, /const isReady = blockingGaps === 0 && generated\.length > 0/);
  });

  it("export page passes canonicalBlockerCodes and canonicalNextAction to the card", () => {
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
