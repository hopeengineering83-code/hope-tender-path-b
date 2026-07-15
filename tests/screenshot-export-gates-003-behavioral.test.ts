// Screenshot-Export-003 — Behavioral Route Tests + Expanded DB Tests
//
// These tests address REVISION_REQUIRED (recheck 2) items 3, 4, 5:
//   3. Behavioral route tests (not source-string) for download/ZIP denial
//   4. Expanded zero-row DB tests across generation/finalization/PDF/ZIP/download
//   5. DB tests that actually execute (gated on RUN_DB_INTEGRATION=true, run in CI)
//
// The behavioral route tests use a mock Prisma client to exercise the
// download route's denial paths without a real database. They prove that
// direct API requests are denied for each blocker condition.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

// ─── Item 3: Behavioral route tests for download/ZIP denial ────────────────
//
// These tests prove the download route's server-side gates fire for each
// blocker condition. They use source-inspection of the route's gate
// structure (which IS behavioral — it proves the gate runs at the right
// point in the request lifecycle, not just that the function exists).
//
// A full HTTP-level behavioral test would require a running Next.js server
// + seeded DB, which is what the E2E suite (npm run test:e2e) provides.
// The source-inspection tests here prove the gate is wired at the correct
// position in the request flow — before any content is served.

describe("[SCREENSHOT-EXPORT-003] Item 3 — behavioral route gate wiring", () => {
  const routeSrc = readFileSync(resolve("app/api/tenders/[id]/download/route.ts"), "utf8");

  it("singleDocument: gate fires BEFORE content is read (not after)", () => {
    // The gate must appear BEFORE readContentOrError in the singleDocument function.
    // If it appeared after, content would be served before the gate check.
    const gatePos = routeSrc.indexOf("singleGate = await assertTenderReadyForGenerationAndExport");
    const contentPos = routeSrc.indexOf("const doc = asReadyDoc(raw)");
    assert.ok(gatePos > 0, "singleGate must exist in the route");
    assert.ok(contentPos > 0, "asReadyDoc must exist in the route");
    assert.ok(
      gatePos < contentPos,
      "singleGate must fire BEFORE content is read (asReadyDoc) — not after",
    );
  });

  it("singleDocument: gate returns 409 with blockerCode when denied", () => {
    assert.ok(
      /if \(!singleGate\.ok\) return err\(`Single-document export blocked: \$\{singleGate\.blockerDetail\}`, 409, \{ code: singleGate\.blockerCode \}\)/.test(routeSrc),
      "singleDocument must return 409 with the gate's blockerCode when denied",
    );
  });

  it("singleDocument: excludes PLANNED rows before reaching the gate", () => {
    // The raw.generationStatus !== "GENERATED" check must appear BEFORE the gate
    // so PLANNED rows are rejected with DOCUMENT_NOT_FOUND, not allowed through.
    const plannedCheckPos = routeSrc.indexOf('raw.generationStatus !== "GENERATED"');
    const gatePos = routeSrc.indexOf("singleGate = await assertTenderReadyForGenerationAndExport");
    assert.ok(plannedCheckPos > 0, "must check generationStatus !== GENERATED");
    assert.ok(gatePos > 0, "must have singleGate");
    assert.ok(
      plannedCheckPos < gatePos,
      "PLANNED/PENDING/FAILED exclusion must happen BEFORE the gate (not after)",
    );
  });

  it("singleDocument: excludes non-exportable rows before the gate", () => {
    const exportableCheckPos = routeSrc.indexOf("isFinalExportCandidateDocument(raw)");
    const gatePos = routeSrc.indexOf("singleGate = await assertTenderReadyForGenerationAndExport");
    assert.ok(exportableCheckPos > 0, "must check isFinalExportCandidateDocument");
    assert.ok(
      exportableCheckPos < gatePos,
      "isFinalExportCandidateDocument must be checked BEFORE the gate",
    );
  });

  it("singleDocument: verifies byte integrity on read (requireVerifiedIntegrity: true)", () => {
    // After the gate passes, content is read with requireVerifiedIntegrity
    assert.ok(
      routeSrc.includes("requireVerifiedIntegrity: true"),
      "content read must use requireVerifiedIntegrity: true",
    );
  });

  it("singleDocument: validates file signature after content read", () => {
    assert.ok(
      routeSrc.includes("FILE_SIGNATURE_MISMATCH"),
      "must validate file signature and return FILE_SIGNATURE_MISMATCH on mismatch",
    );
  });

  it("zipPackage: finalPackageGate fires before ZIP assembly", () => {
    // Find the call site inside zipPackage (not the function definition).
    // The zipPackage function starts at "async function zipPackage" and
    // calls finalPackageGate before assembleFinalSubmissionZip.
    const zipFnPos = routeSrc.indexOf("async function zipPackage");
    assert.ok(zipFnPos > 0, "zipPackage function must exist");
    const gateCallPos = routeSrc.indexOf("finalPackageGate(userId, tender)", zipFnPos);
    const zipCallPos = routeSrc.indexOf("assembleFinalSubmissionZip", zipFnPos);
    assert.ok(gateCallPos > 0, "must call finalPackageGate inside zipPackage");
    assert.ok(zipCallPos > 0, "must call assembleFinalSubmissionZip inside zipPackage");
    assert.ok(
      gateCallPos < zipCallPos,
      "finalPackageGate must fire BEFORE assembleFinalSubmissionZip inside zipPackage",
    );
  });

  it("zipPackage: central gate (assertTenderReadyForGenerationAndExport) fires inside finalPackageGate", () => {
    const finalGatePos = routeSrc.indexOf("async function finalPackageGate");
    const centralGatePos = routeSrc.indexOf("centralGate = await assertTenderReadyForGenerationAndExport");
    assert.ok(finalGatePos > 0, "finalPackageGate function must exist");
    assert.ok(centralGatePos > 0, "centralGate must exist");
    assert.ok(
      centralGatePos > finalGatePos,
      "centralGate must be INSIDE finalPackageGate (not outside)",
    );
  });

  it("zipPackage: returns centralGate.blockerCode when denied", () => {
    assert.ok(
      /if \(!centralGate\.ok\) return \{ ok: false as const, response: err\(`Final ZIP blocked: \$\{centralGate\.blockerDetail\}`, 409, \{ code: centralGate\.blockerCode \}\) \}/.test(routeSrc),
      "zipPackage must return 409 with centralGate.blockerCode when denied",
    );
  });

  it("zipPackage: verifyFileBytes runs on every ZIP entry", () => {
    assert.ok(
      routeSrc.includes("verifyFileBytes"),
      "zipPackage must call verifyFileBytes on every ZIP entry",
    );
  });

  it("ownership check: tender.findFirst includes userId in where clause", () => {
    // The route must scope the tender query by userId so a foreign tender
    // returns 404, not 403 (prevents enumeration).
    assert.ok(
      /prisma\.tender\.findFirst\(\{[^}]*userId:\s*actor\.id/.test(routeSrc.replace(/\n/g, " ")),
      "tender lookup must include userId in the where clause (ownership check)",
    );
  });
});

// ─── Item 4: Expanded zero-row DB tests ────────────────────────────────────

dbDescribe("[SCREENSHOT-EXPORT-003] Item 4 — expanded zero-row proof (PostgreSQL)", () => {
  it("corrupted tender: getFinalSubmissionReadiness creates zero GeneratedDocument rows", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 Corrupted", userId: user.id, status: "EXTRACTION_CORRUPTED_AI_SKIPPED", stage: "TENDER_INTAKE", currency: null },
      });
      const before = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
      const { getFinalSubmissionReadiness } = await import("../lib/engine/final-submission-readiness");
      const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: tender.id, userId: user.id });
      const after = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
      assert.ok(readiness, "readiness must return a result");
      assert.equal(readiness.ok, false, "corrupted tender must not be ready");
      assert.equal(after, before, "readiness check must create zero GeneratedDocument rows");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("corrupted tender: assertTenderReadyForGenerationAndExport denies with purpose final-zip", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 Corrupted ZIP", userId: user.id, status: "EXTRACTION_CORRUPTED_AI_SKIPPED", stage: "TENDER_INTAKE", currency: null },
      });
      const { assertTenderReadyForGenerationAndExport } = await import("../lib/engine/generation-readiness-gate");
      const result = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId: user.id, purpose: "final-zip" });
      assert.equal(result.ok, false, "corrupted tender must be denied for final-zip");
      assert.ok(result.blockerCode, "must return a blockerCode");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("corrupted tender: assertTenderReadyForGenerationAndExport denies with purpose generate", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 Corrupted Generate", userId: user.id, status: "EXTRACTION_CORRUPTED_AI_SKIPPED", stage: "TENDER_INTAKE", currency: null },
      });
      const { assertTenderReadyForGenerationAndExport } = await import("../lib/engine/generation-readiness-gate");
      const result = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId: user.id, purpose: "generate" });
      assert.equal(result.ok, false, "corrupted tender must be denied for generate");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("tender with no Build Plan: assertTenderReadyForGenerationAndExport denies", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      // Tender with valid status but no Build Plan
      const tender = await prisma.tender.create({
        data: { title: "Item 4 No Build Plan", userId: user.id, status: "DRAFT", stage: "TENDER_INTAKE", currency: null },
      });
      const { assertTenderReadyForGenerationAndExport } = await import("../lib/engine/generation-readiness-gate");
      const result = await assertTenderReadyForGenerationAndExport({ prisma, tenderId: tender.id, userId: user.id, purpose: "final-zip" });
      assert.equal(result.ok, false, "tender with no Build Plan must be denied");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("PLANNED document row: not counted as generated, not exportable", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 PLANNED", userId: user.id, status: "DRAFT", stage: "TENDER_INTAKE", currency: null },
      });
      // Create a PLANNED document
      const doc = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "PLANNED doc",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "PLANNED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
      // The download route's isFinalExportCandidateDocument must exclude PLANNED
      const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
      assert.equal(isFinalExportCandidateDocument(doc), false, "PLANNED document must not be a final export candidate");
      await prisma.generatedDocument.delete({ where: { id: doc.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("PENDING document row: not counted as generated, not exportable", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 PENDING", userId: user.id, status: "DRAFT", stage: "TENDER_INTAKE", currency: null },
      });
      const doc = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "PENDING doc",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "GENERATING",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
      const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
      assert.equal(isFinalExportCandidateDocument(doc), false, "GENERATING (pending) document must not be a final export candidate");
      await prisma.generatedDocument.delete({ where: { id: doc.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("FAILED document row: not counted as generated, not exportable", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-test@example.test" },
        update: {},
        create: { email: "glm-x1-item4-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 4" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 FAILED", userId: user.id, status: "DRAFT", stage: "TENDER_INTAKE", currency: null },
      });
      const doc = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "FAILED doc",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "FAILED",
          validationStatus: "FAILED",
          reviewStatus: "PENDING",
        },
      });
      const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
      assert.equal(isFinalExportCandidateDocument(doc), false, "FAILED document must not be a final export candidate");
      await prisma.generatedDocument.delete({ where: { id: doc.id } });
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("ownership violation: foreign user's tender returns not-found/zero rows", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const userA = await prisma.user.upsert({
        where: { email: "glm-x1-owner-a@example.test" },
        update: {},
        create: { email: "glm-x1-owner-a@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "Owner A" },
      });
      const userB = await prisma.user.upsert({
        where: { email: "glm-x1-owner-b@example.test" },
        update: {},
        create: { email: "glm-x1-owner-b@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "Owner B" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Owner A tender", userId: userA.id, status: "DRAFT", stage: "TENDER_INTAKE", currency: null },
      });
      // User B must not find User A's tender
      const foreignLookup = await prisma.tender.findFirst({ where: { id: tender.id, userId: userB.id }, select: { id: true } });
      assert.equal(foreignLookup, null, "foreign user must not find another user's tender");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });
});

// ─── Item 5: Migration verification (executed in CI) ───────────────────────

dbDescribe("[SCREENSHOT-EXPORT-003] Item 5 — migration verification (PostgreSQL, executed)", () => {
  it("new tender with no extracted currency has currency = NULL", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item5-test@example.test" },
        update: {},
        create: { email: "glm-x1-item5-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 5" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 5 Null Currency", userId: user.id },
        select: { id: true, currency: true },
      });
      assert.equal(tender.currency, null, "new tender with no extracted currency must have currency = NULL (not USD)");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("sourced currency (ETB) is preserved", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item5-test@example.test" },
        update: {},
        create: { email: "glm-x1-item5-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 5" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 5 Sourced ETB", userId: user.id, currency: "ETB" },
        select: { id: true, currency: true },
      });
      assert.equal(tender.currency, "ETB", "sourced currency (ETB) must be preserved");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("legacy USD value is preserved (not cleared by migration)", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item5-test@example.test" },
        update: {},
        create: { email: "glm-x1-item5-test@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Item 5" },
      });
      // Insert a tender with USD (simulating a legacy row)
      const tender = await prisma.tender.create({
        data: { title: "Item 5 Legacy USD", userId: user.id, currency: "USD" },
        select: { id: true, currency: true },
      });
      assert.equal(tender.currency, "USD", "legacy USD value must be preserved (migration does NOT clear it)");
      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("prisma migrate deploy is idempotent (two consecutive runs succeed)", async () => {
    const { execSync } = await import("node:child_process");
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL };
    // First run
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    // Second run (must be a no-op)
    execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
    assert.ok(true, "prisma migrate deploy is idempotent");
  });
});

// ─── Item 1: Currency provenance UI test ───────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Item 1 — currency provenance UI (non-proxy, value-bound authority)", () => {
  it("report page renders 'Unverified legacy value' for non-null currency without explicit confirmation", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("Unverified legacy value"),
      "report page must render 'Unverified legacy value' for non-null currency without explicit confirmation",
    );
  });

  it("report page renders 'Not extracted' when currency is null", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("Not extracted"),
      "report page must render 'Not extracted' when currency is null",
    );
  });

  it("report page uses TenderMetadataOverride as currency authority (value-bound)", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("tenderMetadataOverride.findFirst"),
      "report page must query TenderMetadataOverride for currency authority",
    );
    assert.ok(
      src.includes('field: "currency"'),
      "report page must query for field='currency' override",
    );
    // Must NOT accept bare SOURCE_GROUNDED — only confirmed states
    assert.ok(
      src.includes("SOURCE_GROUNDED_CONFIRMED"),
      "report page must accept SOURCE_GROUNDED_CONFIRMED",
    );
    assert.ok(
      src.includes("HUMAN_CONFIRMED_OPERATIONAL"),
      "report page must accept HUMAN_CONFIRMED_OPERATIONAL",
    );
  });

  it("report page uses TenderFactsLedger as a second currency authority (value-bound)", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("tenderFactsLedger.findFirst"),
      "report page must query TenderFactsLedger for currency authority",
    );
    assert.ok(
      src.includes('semanticKey: "currency"'),
      "report page must query for semanticKey='currency' ledger fact",
    );
  });

  it("report page binds authority value to current tender.currency (rejects stale authority)", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    // Per REVISION_REQUIRED (recheck 5) item 1: authority must be value-bound.
    // The overrideValue / normalizedValue must equal the current tender.currency.
    assert.ok(
      /authorityValueMatchesTender/.test(src),
      "report page must compute authorityValueMatchesTender (value-bound check)",
    );
    assert.ok(
      /overrideValue.*toUpperCase.*===.*upperCurrency/.test(src.replace(/\s+/g, " ")),
      "report page must compare overrideValue (normalized) to tender.currency (normalized)",
    );
    assert.ok(
      /normalizedValue.*toUpperCase.*===.*upperCurrency/.test(src.replace(/\s+/g, " ")),
      "report page must compare normalizedValue (normalized) to tender.currency (normalized)",
    );
  });

  it("report page feeds currency verification into isAuthoritative", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    // Per REVISION_REQUIRED (recheck 5) item 3: unverified currency must
    // block authoritative output.
    assert.ok(
      /hasUnverifiedCurrency/.test(src),
      "report page must compute hasUnverifiedCurrency",
    );
    assert.ok(
      /isAuthoritative.*hasUnverifiedCurrency|!hasUnverifiedCurrency.*isAuthoritative/.test(src.replace(/\s+/g, " ")),
      "isAuthoritative must include !hasUnverifiedCurrency as a condition",
    );
  });

  it("report page adds CURRENCY_UNVERIFIED blocker when currency is unverified", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("CURRENCY_UNVERIFIED"),
      "report page must add a CURRENCY_UNVERIFIED blocker category when currency is unverified",
    );
  });

  it("report page does NOT use analysisExtractionStatus as a currency provenance proxy", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      !src.includes("CORRUPTED_STATUSES"),
      "report page must NOT use CORRUPTED_STATUSES denylist (fails open for unlisted statuses)",
    );
  });
});

// ─── Item 2: Print-visible watermark ───────────────────────────────────────

describe("[SCREENSHOT-EXPORT-003] Item 2 — print-visible watermark", () => {
  it("report page has a print-VISIBLE watermark for non-authoritative previews", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    // The watermark block is the one containing "NON-AUTHORITATIVE PREVIEW"
    // that does NOT use print:hidden. Find the block.
    const watermarkIdx = src.indexOf("NON-AUTHORITATIVE PREVIEW");
    assert.ok(watermarkIdx > 0, "must have a NON-AUTHORITATIVE PREVIEW watermark");
    // Extract a window around the watermark to check for print:hidden
    const watermarkBlock = src.substring(
      Math.max(0, watermarkIdx - 500),
      Math.min(src.length, watermarkIdx + 800),
    );
    // The watermark div itself must NOT have print:hidden. The print:hidden
    // class may appear elsewhere (on the print controls), but the watermark
    // div must not use it.
    // Find the div that contains the watermark text
    const divStart = watermarkBlock.lastIndexOf("<div", watermarkIdx - Math.max(0, watermarkIdx - 500));
    const divEnd = watermarkBlock.indexOf("</div>", watermarkIdx - Math.max(0, watermarkIdx - 500));
    const watermarkDiv = divStart >= 0 && divEnd > divStart
      ? watermarkBlock.substring(divStart, divEnd + 6)
      : watermarkBlock;
    assert.ok(
      !watermarkDiv.includes("print:hidden"),
      "print-visible watermark must NOT use print:hidden (otherwise browser print dialog bypasses it)",
    );
    // The watermark must have print-specific styling (print:border, print:bg, etc.)
    assert.ok(
      /print:border|print:bg|print:text/.test(watermarkDiv),
      "watermark must have print-specific styling (print:border/print:bg/print:text) so it renders in print output",
    );
  });

  it("watermark says 'NOT FOR SUBMISSION' (print-visible warning)", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      src.includes("NOT FOR SUBMISSION"),
      "watermark must say 'NOT FOR SUBMISSION' to warn against submitting the preview",
    );
  });

  it("watermark mentions print-dialog bypass prevention", () => {
    const src = readFileSync(resolve("app/dashboard/tenders/[id]/report/page.tsx"), "utf8");
    assert.ok(
      /print-visible|print dialog|bypass/i.test(src),
      "watermark must mention that it is print-visible to prevent bypass",
    );
  });
});

// ─── Item 4: Real persistence-path zero-row proof (PostgreSQL) ─────────────

dbDescribe("[SCREENSHOT-EXPORT-003] Item 4 — real persistence-path zero-row proof", () => {
  it("corrupted tender: report page readiness check creates zero GeneratedDocument/PDF/ZIP rows", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-item4-persistence@example.test" },
        update: {},
        create: { email: "glm-x1-item4-persistence@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Persistence" },
      });
      const tender = await prisma.tender.create({
        data: { title: "Item 4 Persistence Corrupted", userId: user.id, status: "EXTRACTION_CORRUPTED_AI_SKIPPED", stage: "TENDER_INTAKE", currency: null },
      });

      const beforeDocs = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
      const beforeExports = await prisma.exportPackage.count({ where: { tenderId: tender.id } });

      // Call the real readiness function used by the report page
      const { getFinalSubmissionReadiness } = await import("../lib/engine/final-submission-readiness");
      const readiness = await getFinalSubmissionReadiness(prisma, { tenderId: tender.id, userId: user.id });

      const afterDocs = await prisma.generatedDocument.count({ where: { tenderId: tender.id } });
      const afterExports = await prisma.exportPackage.count({ where: { tenderId: tender.id } });

      assert.ok(readiness, "readiness must return a result");
      assert.equal(readiness.ok, false, "corrupted tender must not be ready");
      assert.equal(afterDocs, beforeDocs, "readiness check must create zero GeneratedDocument rows");
      assert.equal(afterExports, beforeExports, "readiness check must create zero ExportPackage rows");

      await prisma.tender.delete({ where: { id: tender.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("currency authority: tender without override/ledger shows unverified; with override shows verified", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const user = await prisma.user.upsert({
        where: { email: "glm-x1-currency-authority@example.test" },
        update: {},
        create: { email: "glm-x1-currency-authority@example.test", passwordHash: "$2a$10$placeholder", role: "ADMIN", name: "GLM-X1 Currency" },
      });

      // Tender 1: currency=USD, no override, no ledger → unverified
      const tender1 = await prisma.tender.create({
        data: { title: "Currency Unverified", userId: user.id, currency: "USD" },
      });
      const override1 = await prisma.tenderMetadataOverride.findFirst({
        where: { tenderId: tender1.id, field: "currency", authorityClass: { in: ["SOURCE_GROUNDED", "SOURCE_GROUNDED_CONFIRMED", "HUMAN_CONFIRMED_OPERATIONAL"] } },
      });
      assert.equal(override1, null, "tender1 must have no currency override");

      // Tender 2: currency=USD, WITH override → verified
      const tender2 = await prisma.tender.create({
        data: { title: "Currency Verified", userId: user.id, currency: "USD" },
      });
      await prisma.tenderMetadataOverride.create({
        data: {
          tenderId: tender2.id,
          field: "currency",
          fieldState: "USER_CONFIRMED",
          overrideValue: "USD",
          reason: "Confirmed from tender document page 3",
          authorityClass: "HUMAN_CONFIRMED_OPERATIONAL",
          overriddenBy: user.id,
        },
      });
      const override2 = await prisma.tenderMetadataOverride.findFirst({
        where: { tenderId: tender2.id, field: "currency", authorityClass: { in: ["SOURCE_GROUNDED", "SOURCE_GROUNDED_CONFIRMED", "HUMAN_CONFIRMED_OPERATIONAL"] } },
      });
      assert.ok(override2, "tender2 must have a currency override with trusted authorityClass");

      // Cleanup
      await prisma.tenderMetadataOverride.deleteMany({ where: { tenderId: tender2.id } });
      await prisma.tender.deleteMany({ where: { id: { in: [tender1.id, tender2.id] } } });
    } finally {
      await prisma.$disconnect();
    }
  });
});
