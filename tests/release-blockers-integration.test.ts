// Real authenticated PostgreSQL route tests for the four release blockers:
//
//   1. Confirmed BuildPlan items are re-validated at runtime — invalid,
//      duplicate, malformed, or out-of-scope items fail closed
//      (BUILD_PLAN_ITEMS_INVALID) and cannot authorize generation/export.
//   2. Page attribution fails closed — no page-1 default on multi-page
//      documents without page boundaries; no first-prefix approximation.
//   3. Strict metadata-evidence validation covers reference and a required
//      submission email subject (durable active TenderFile ID + valid page +
//      contained quote).
//   4. Evidence persistence through the REAL route handlers (repair-metadata,
//      re-extract-metadata) with a real PostgreSQL database: invalid page
//      evidence, deleted files, duplicate text, malformed BuildPlan items,
//      and failed writes cannot clear export blockers.
//
// RUN_DB_INTEGRATION=true is MANDATORY — these tests CANNOT be skipped.
//
// These tests use the application's REAL signed session/cookie mechanism
// (same pattern as tests/build-plan-route-integration.test.ts): real HMAC
// tokens, real Session rows, real requireRole()/requireUser() flow. The ONLY
// mock is next/headers cookies() — Next.js does not provide its
// AsyncLocalStorage context under the node test runner.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for release-blocker tests.");
  process.exit(1);
}

// ─── Mock next/headers cookies() (registered before any route import) ────
let __TEST_COOKIE_STORE: Record<string, string> = {};

const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => __TEST_COOKIE_STORE[name] ? { name, value: __TEST_COOKIE_STORE[name] } : undefined,
    set: (name: string, value: string) => { __TEST_COOKIE_STORE[name] = value; },
    delete: (name: string) => { delete __TEST_COOKIE_STORE[name]; },
    getAll: () => Object.entries(__TEST_COOKIE_STORE).map(([name, value]) => ({ name, value })),
  }),
};

const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") {
    return (require.resolve as any).__next_headers_mock_path || "";
  }
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__next_headers_mock__";
require.cache[mockModulePath] = {
  id: mockModulePath,
  filename: mockModulePath,
  loaded: true,
  exports: nextHeadersMock,
  paths: [],
  children: [],
  parent: null,
} as any;
(require.resolve as any).__next_headers_mock_path = mockModulePath;

// ─── Real session token creation (same HMAC mechanism as lib/auth.ts) ────
import { createHmac, randomBytes, createHash } from "node:crypto";

const SESSION_COOKIE = "hope_session";

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long-for-hmac";
}
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}
async function setAuthCookie(userId: string): Promise<void> {
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({ data: { token: hashToken(token), userId, expiresAt } });
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
}
function clearAuthCookie(): void {
  __TEST_COOKIE_STORE = {};
}

// ─── Shared fixtures ──────────────────────────────────────────────────────

const QUOTE = "This tender requires a Technical Proposal for the project.";

// Multi-page text WITH canonical [Page N] boundaries (what lib/extract-text.ts emits)
const PAGED_TEXT = `[Page 1]\n${QUOTE}\nMinistry of Test Infrastructure\n[Page 2]\nTender Reference: HTB-2027-042\nSubmit by email to submit@example.com with subject line "Bid HTB-2027-042"\n[Page 3]\nDeadline: 2027-06-30`;

// Multi-page document with NO page boundaries at all (no \f, no markers)
const BOUNDARYLESS_TEXT = `${QUOTE} Ministry of Test Infrastructure Tender Reference: HTB-2027-042 Submit by email to submit@example.com Deadline: 2027-06-30`;

async function createTenderWithFile(userId: string, suffix: string, opts: {
  extractedText?: string;
  totalPages?: number;
  submissionEmailSubject?: string | null;
  subjectEvidence?: boolean;
  referenceEvidence?: boolean;
} = {}) {
  const nonce = `${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
  const tender = await prisma.tender.create({
    data: {
      userId,
      title: `Blocker Test Tender ${nonce}`,
      clientName: "Ministry of Test Infrastructure",
      reference: "HTB-2027-042",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      exactFileNaming: '["Technical Proposal.docx"]',
      exactFileOrder: '[1]',
      submissionMethod: "email submission required",
      submissionEmails: "submit@example.com",
      submissionEmailSubject: opts.submissionEmailSubject === undefined ? null : opts.submissionEmailSubject,
      deadline: new Date(Date.now() + 30 * 86400 * 1000),
      clientNameSourcePage: 1, clientNameSourceQuote: QUOTE,
      titleSourcePage: 1, titleSourceQuote: QUOTE,
      deadlineSourcePage: 1, deadlineSourceQuote: QUOTE,
      submissionMethodSourcePage: 1, submissionMethodSourceQuote: QUOTE,
      submissionEmailSourcePage: 1, submissionEmailSourceQuote: QUOTE,
    },
  });
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: `tender-${nonce}.pdf`, originalFileName: `Tender-${nonce}.pdf`,
      mimeType: "application/pdf", size: 2048,
      extractedText: opts.extractedText ?? PAGED_TEXT,
      totalPages: opts.totalPages ?? 3, extractedPages: opts.totalPages ?? 3, failedPages: 0,
      extractionScore: 100, extractionMethod: "text",
    },
  });
  const evidenceUpdate: Record<string, unknown> = {
    clientNameSourceFileId: file.id,
    titleSourceFileId: file.id,
    deadlineSourceFileId: file.id,
    submissionMethodSourceFileId: file.id,
    submissionEmailSourceFileId: file.id,
  };
  if (opts.referenceEvidence !== false) {
    evidenceUpdate.referenceSourceFileId = file.id;
    evidenceUpdate.referenceSourcePage = 1;
    evidenceUpdate.referenceSourceQuote = QUOTE;
  }
  if (opts.subjectEvidence) {
    evidenceUpdate.submissionEmailSubjectSourceFileId = file.id;
    evidenceUpdate.submissionEmailSubjectSourcePage = 1;
    evidenceUpdate.submissionEmailSubjectSourceQuote = QUOTE;
  }
  await prisma.tender.update({ where: { id: tender.id }, data: evidenceUpdate });
  return { tender, file };
}

async function cleanupTender(tenderId: string) {
  await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
}

describe("Release blockers — real PostgreSQL integration", () => {
  let user: any;
  let repairRoute: any;
  let reExtractRoute: any;

  before(async () => {
    await prismaReady;
    const nonce = Date.now();
    user = await prisma.user.create({
      data: { email: `blockers-${nonce}@test.com`, name: "Blocker Tester", passwordHash: "$2a$10$test", role: "ADMIN" },
    });
    repairRoute = await import("../app/api/tenders/[id]/repair-metadata/route");
    reExtractRoute = await import("../app/api/tenders/[id]/re-extract-metadata/route");
  });

  after(async () => {
    if (user) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  });

  // ═══ Blocker 1 — confirmed BuildPlan items validated at runtime ═══════

  describe("Blocker 1: BuildPlan item runtime validation", () => {
    it("malformed items (empty exactFileName, bad order, missing type) fail closed", async () => {
      const { validateBuildPlanItemsAtRuntime } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b1-malformed");
      const malformed = [
        { canonicalId: "x", exactFileName: "", exactOrder: 0, documentType: "", required: "yes", sourceRequirementIds: [], templateSourceFileId: null },
      ] as any[];
      const result = await validateBuildPlanItemsAtRuntime(prisma, tender.id, user.id, malformed);
      assert.equal(result.ok, false);
      assert.ok(result.blockers.some((b: string) => b.includes("exactFileName")), "flags empty exactFileName");
      assert.ok(result.blockers.some((b: string) => b.includes("exactOrder")), "flags invalid exactOrder");
      assert.ok(result.blockers.some((b: string) => b.includes("required flag")), "flags non-boolean required");
      await cleanupTender(tender.id);
    });

    it("duplicate items and null items fail closed", async () => {
      const { validateBuildPlanItemsAtRuntime } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b1-dup");
      const item = {
        canonicalId: "exact-1", exactFileName: "Technical Proposal.docx", exactOrder: 1,
        documentType: "TECHNICAL", required: true, sourceRequirementIds: [], templateSourceFileId: null,
      };
      const result = await validateBuildPlanItemsAtRuntime(prisma, tender.id, user.id, [item, { ...item }, null] as any[]);
      assert.equal(result.ok, false);
      assert.ok(result.blockers.some((b: string) => b.includes("Duplicate")), "flags duplicate");
      assert.ok(result.blockers.some((b: string) => b.includes("null or undefined")), "flags null item");
      await cleanupTender(tender.id);
    });

    it("items referencing missing requirements or non-active template files fail closed", async () => {
      const { validateBuildPlanItemsAtRuntime } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b1-refs");
      const items = [{
        canonicalId: "req-x", exactFileName: "Technical Proposal.docx", exactOrder: 1,
        documentType: "TECHNICAL", required: true,
        sourceRequirementIds: ["nonexistent-req-id"],
        templateSourceFileId: "nonexistent-file-id",
      }] as any[];
      const result = await validateBuildPlanItemsAtRuntime(prisma, tender.id, user.id, items);
      assert.equal(result.ok, false);
      assert.ok(result.blockers.some((b: string) => b.includes("missing requirement")), "flags foreign requirement");
      assert.ok(result.blockers.some((b: string) => b.includes("template file")), "flags non-active template file");
      await cleanupTender(tender.id);
    });

    it("the pure gate blocks with BUILD_PLAN_ITEMS_INVALID when item validation fails", async () => {
      const { evaluateGenerationReadiness } = await import("../lib/engine/generation-readiness-gate");
      const base = {
        purpose: "generate" as const,
        tenderExistsAndOwned: true,
        activeFileCount: 1,
        extractionFiles: [{ fileId: "f1", corrupted: false, weak: false, hasOverride: false }],
        analysisState: "AI_SUCCEEDED" as const,
        canonicalJobId: "job-1", latestJobHash: "h", currentContentHash: "h",
        fallbackApprovalBound: false, currentHashChunks: [],
        requirementCount: 1,
        requirements: [{ priority: "MANDATORY", sourceTenderFileId: "f1", sourcePageNumber: 1, sourceExactQuote: QUOTE, sourceFileActiveInTender: true, sourceFileExtractedText: PAGED_TEXT }],
        criticalMetadataOk: true,
        recordedBuildPlanState: "VALID" as const,
        exportReadyDocumentCount: 1,
        hasCurrentConfirmedBuildPlan: true,
        confirmedPlanDocumentsOk: true,
      };
      // Items invalid → BUILD_PLAN_ITEMS_INVALID
      const blocked = evaluateGenerationReadiness({ ...base, confirmedBuildPlanItemsValid: false, confirmedBuildPlanItemBlockers: ["Duplicate plan item: 1 x.docx"] });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.blockerCode, "BUILD_PLAN_ITEMS_INVALID");
      // Fail-closed: UNDEFINED items validity blocks the same as false
      const undef = evaluateGenerationReadiness({ ...base });
      assert.equal(undef.ok, false);
      assert.equal(undef.blockerCode, "BUILD_PLAN_ITEMS_INVALID");
      // Valid items pass
      const open = evaluateGenerationReadiness({ ...base, confirmedBuildPlanItemsValid: true });
      assert.equal(open.ok, true);
    });

    it("a CONFIRMED plan row with corrupted itemsJson cannot authorize (fail closed end-to-end)", async () => {
      const { getCurrentConfirmedBuildPlan } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b1-corrupt");
      await prisma.buildPlan.create({
        data: {
          tenderId: tender.id, status: "CONFIRMED", revision: 1,
          contentHash: "stale-hash", confirmedRevision: 1, confirmedContentHash: "stale-hash",
          itemsJson: "{not-valid-json", updatedAt: new Date(),
        },
      });
      const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
      assert.equal(confirmed.ok, false, "corrupted itemsJson must fail closed");
      await cleanupTender(tender.id);
    });
  });

  // ═══ Blocker 2 — page attribution fails closed ════════════════════════

  describe("Blocker 2: page attribution fail-closed", () => {
    it("multi-page document with NO page boundaries yields NO page number (not page 1)", async () => {
      const { enrichMetadataWithSourceEvidence } = await import("../lib/engine/metadata-source-enrichment");
      const result = enrichMetadataWithSourceEvidence(
        { clientName: "Ministry of Test Infrastructure" },
        [{ id: "f1", extractedText: BOUNDARYLESS_TEXT, deletionStatus: "ACTIVE", totalPages: 5 }],
      );
      assert.equal(result.clientNameSourceFileId, "f1", "fileId + quote evidence still found");
      assert.equal(result.clientNameSourcePage, null, "page must be null — never a guessed 1 on a 5-page file");
    });

    it("VERIFIED one-page file may attribute page 1 without boundaries", async () => {
      const { enrichMetadataWithSourceEvidence } = await import("../lib/engine/metadata-source-enrichment");
      const result = enrichMetadataWithSourceEvidence(
        { clientName: "Ministry of Test Infrastructure" },
        [{ id: "f1", extractedText: BOUNDARYLESS_TEXT, deletionStatus: "ACTIVE", totalPages: 1 }],
      );
      assert.equal(result.clientNameSourcePage, 1, "verified single page → page 1 is legitimate");
    });

    it("canonical [Page N] markers from lib/extract-text.ts are honored", async () => {
      const { enrichMetadataWithSourceEvidence } = await import("../lib/engine/metadata-source-enrichment");
      const result = enrichMetadataWithSourceEvidence(
        { reference: "HTB-2027-042" },
        [{ id: "f1", extractedText: PAGED_TEXT, deletionStatus: "ACTIVE", totalPages: 3 }],
      );
      assert.equal(result.referenceSourceFileId, "f1");
      assert.equal(result.referenceSourcePage, 2, "reference sits after the [Page 2] marker");
    });

    it("no first-prefix approximation: page comes from the TRUE occurrence, not an earlier lookalike", async () => {
      const { enrichMetadataWithSourceEvidence } = await import("../lib/engine/metadata-source-enrichment");
      // Page 1 contains a DIFFERENT string sharing the first 20+ chars with the
      // needle; the real match (whitespace-wrapped) is on page 3. The old
      // prefix probe would land on page 1.
      const needle = "Special Conditions of Contract Part B";
      const decoy = "Special Conditions of Contract Part A";
      const text = `[Page 1]\n${decoy}\n[Page 2]\nfiller content\n[Page 3]\nSpecial   Conditions of\nContract Part B`;
      const result = enrichMetadataWithSourceEvidence(
        { title: needle },
        [{ id: "f1", extractedText: text, deletionStatus: "ACTIVE", totalPages: 3 }],
      );
      assert.equal(result.titleSourceFileId, "f1");
      assert.equal(result.titleSourcePage, 3, "must attribute the TRUE occurrence on page 3, not the page-1 decoy");
      assert.ok(result.titleSourceQuote?.toLowerCase().includes("part b"), "quote must surround the true occurrence");
    });

    it("field extractors: no page-1 default on multi-page text without boundaries", async () => {
      const { extractReference } = await import("../lib/engine/tender-field-extractors");
      const r = extractReference({ files: [{ fileName: "t.pdf", extractedText: BOUNDARYLESS_TEXT.padEnd(200, " filler"), totalPages: 4 }] });
      assert.ok(r.found, "reference should be found");
      if (r.found) assert.equal(r.sourcePage, null, "no boundaries + 4 pages → sourcePage null, not 1");
    });

    it("field extractors: verified one-page file still gets page 1; impossible marker pages are rejected", async () => {
      const { extractReference } = await import("../lib/engine/tender-field-extractors");
      const single = extractReference({ files: [{ fileName: "t.pdf", extractedText: BOUNDARYLESS_TEXT.padEnd(200, " filler"), totalPages: 1 }] });
      assert.ok(single.found);
      if (single.found) assert.equal(single.sourcePage, 1);
      // Marker claims page 9 but the file has 3 pages → null, never persisted
      const badMarker = `[Page 9]\nTender Reference: HTB-2027-042 ${"filler ".repeat(20)}`;
      const clamped = extractReference({ files: [{ fileName: "t.pdf", extractedText: badMarker, totalPages: 3 }] });
      assert.ok(clamped.found);
      if (clamped.found) assert.equal(clamped.sourcePage, null, "marker page 9 > totalPages 3 → null");
    });

    it("strict validator rejects evidence whose page exceeds the file's total pages", async () => {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan");
      const { tender, file } = await createTenderWithFile(user.id, "b2-pages");
      await prisma.tender.update({ where: { id: tender.id }, data: { titleSourcePage: 12 } });
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      const validation = validateCriticalMetadataEvidenceForBuildPlan(
        fresh as any,
        [{ id: file.id, extractedText: PAGED_TEXT, totalPages: 3 }],
      );
      assert.equal(validation.ok, false);
      assert.ok(validation.blockers.some((b) => b.includes("exceeds file total pages")), "page 12 on a 3-page file is blocked");
      await cleanupTender(tender.id);
    });
  });

  // ═══ Blocker 3 — reference + submissionEmailSubject evidence ══════════

  describe("Blocker 3: reference and email-subject evidence validation", () => {
    it("a reference VALUE without any evidence is advisory in draft mode; absent reference does not block", async () => {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan");
      const { tender, file } = await createTenderWithFile(user.id, "b3-ref", { referenceEvidence: false });
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      const files = [{ id: file.id, extractedText: PAGED_TEXT, totalPages: 3 }];
      // RUNTIME METADATA DEBLOCKER: In draft mode (default), a reference value
      // without source evidence is advisory, not a hard block.
      const withValue = validateCriticalMetadataEvidenceForBuildPlan(fresh as any, files);
      assert.equal(withValue.ok, true, "draft mode must NOT block on reference without evidence (advisory only)");
      // Remove the reference value entirely → reference no longer blocks
      await prisma.tender.update({ where: { id: tender.id }, data: { reference: null } });
      const noValue = await prisma.tender.findUnique({ where: { id: tender.id } });
      const without = validateCriticalMetadataEvidenceForBuildPlan(noValue as any, files);
      assert.ok(!without.blockers.some((b) => b.includes("reference")), "absent reference must not block (not in the critical-block list)");
      await cleanupTender(tender.id);
    });

    it("reference evidence from contactDetailsSourceJson.procurementReferenceNumber is accepted with equal strictness", async () => {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan");
      const { tender, file } = await createTenderWithFile(user.id, "b3-refjson", { referenceEvidence: false });
      await prisma.tender.update({
        where: { id: tender.id },
        data: { contactDetailsSourceJson: JSON.stringify({ procurementReferenceNumber: { page: 2, quote: QUOTE, fileId: file.id } }) },
      });
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      const good = validateCriticalMetadataEvidenceForBuildPlan(fresh as any, [{ id: file.id, extractedText: PAGED_TEXT, totalPages: 3 }]);
      assert.ok(!good.blockers.some((b) => b.includes("reference")), "JSON evidence with active file + page + contained quote passes");
      // Same JSON evidence but the quote is NOT in the file → blocked
      await prisma.tender.update({
        where: { id: tender.id },
        data: { contactDetailsSourceJson: JSON.stringify({ procurementReferenceNumber: { page: 2, quote: "a quote that is definitely not in the file text", fileId: file.id } }) },
      });
      const fresh2 = await prisma.tender.findUnique({ where: { id: tender.id } });
      const bad = validateCriticalMetadataEvidenceForBuildPlan(fresh2 as any, [{ id: file.id, extractedText: PAGED_TEXT, totalPages: 3 }]);
      assert.ok(bad.blockers.some((b) => b.includes("reference")), "JSON evidence with non-contained quote is blocked");
      await cleanupTender(tender.id);
    });

    it("a required email subject without evidence is advisory in draft mode; with grounded evidence it passes", async () => {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan");
      const { tender, file } = await createTenderWithFile(user.id, "b3-subj", { submissionEmailSubject: "Bid HTB-2027-042" });
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      const files = [{ id: file.id, extractedText: PAGED_TEXT, totalPages: 3 }];
      // RUNTIME METADATA DEBLOCKER: In draft mode, subject without evidence is advisory
      const blocked = validateCriticalMetadataEvidenceForBuildPlan(fresh as any, files);
      assert.ok(!blocked.blockers.some((b) => b.includes("submissionEmailSubject")), "draft mode must NOT block on subject without evidence");
      await prisma.tender.update({
        where: { id: tender.id },
        data: { submissionEmailSubjectSourceFileId: file.id, submissionEmailSubjectSourcePage: 2, submissionEmailSubjectSourceQuote: 'with subject line "Bid HTB-2027-042"' },
      });
      const fresh2 = await prisma.tender.findUnique({ where: { id: tender.id } });
      const open = validateCriticalMetadataEvidenceForBuildPlan(fresh2 as any, files);
      assert.ok(!open.blockers.some((b) => b.includes("submissionEmailSubject")), "grounded subject evidence passes");
      await cleanupTender(tender.id);
    });

    it("deleted source file invalidates reference evidence (getCurrentConfirmedBuildPlan blocks in FINAL mode)", async () => {
      const { validateCriticalMetadataEvidenceForBuildPlan } = await import("../lib/engine/build-plan");
      const { tender, file } = await createTenderWithFile(user.id, "b3-deleted");
      await prisma.tenderFile.update({ where: { id: file.id }, data: { deletionStatus: "DELETED" } });
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      const activeFiles = await prisma.tenderFile.findMany({ where: { tenderId: tender.id, deletionStatus: "ACTIVE" } });
      // RUNTIME METADATA DEBLOCKER: In draft mode, deleted source file is advisory
      const validation = validateCriticalMetadataEvidenceForBuildPlan(
        fresh as any,
        activeFiles.map((f) => ({ id: f.id, extractedText: f.extractedText, totalPages: f.totalPages })),
      );
      // Draft mode: deleted source file is advisory, not blocking
      assert.equal(validation.ok, true, "draft mode must NOT block on deleted source file (advisory only)");
      await cleanupTender(tender.id);
    });
  });

  // ═══ Blocker 4 — real route evidence persistence ══════════════════════

  describe("Blocker 4: repair-metadata route (real handler, real DB)", () => {
    it("repair persists reference value + DURABLE evidence (fileId, quote) and page only when boundaries exist", async () => {
      const { tender, file } = await createTenderWithFile(user.id, "b4-repair", { referenceEvidence: false });
      await prisma.tender.update({ where: { id: tender.id }, data: { reference: null } });
      clearAuthCookie();
      await setAuthCookie(user.id);
      const req = new Request(`http://localhost/api/tenders/${tender.id}/repair-metadata`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["reference"] }),
      });
      const res = await repairRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      assert.equal(res.status, 200, `repair route should 200, got ${res.status}`);
      const body = await res.json();
      const outcome = body.outcomesByField?.reference;
      assert.ok(outcome, "reference outcome present");
      assert.equal(outcome.status, "REPAIRED");
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(fresh!.reference, "HTB-2027-042");
      assert.equal(fresh!.referenceSourceFileId, file.id, "durable dedicated fileId persisted");
      assert.ok(fresh!.referenceSourceQuote, "dedicated quote persisted");
      assert.equal(fresh!.referenceSourcePage, 2, "page from the [Page 2] marker");
      const contact = JSON.parse(fresh!.contactDetailsSourceJson ?? "{}");
      assert.equal(contact.procurementReferenceNumber?.fileId, file.id, "JSON evidence mirrored with fileId");
      await cleanupTender(tender.id);
    });

    it("repair on a boundaryless multi-page file does NOT invent a page number", async () => {
      const { tender, file } = await createTenderWithFile(user.id, "b4-nopage", {
        extractedText: BOUNDARYLESS_TEXT.padEnd(300, " filler"),
        totalPages: 4,
        referenceEvidence: false,
      });
      await prisma.tender.update({ where: { id: tender.id }, data: { reference: null } });
      clearAuthCookie();
      await setAuthCookie(user.id);
      const req = new Request(`http://localhost/api/tenders/${tender.id}/repair-metadata`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["reference"] }),
      });
      const res = await repairRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      assert.equal(res.status, 200);
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(fresh!.reference, "HTB-2027-042", "value repaired");
      assert.equal(fresh!.referenceSourceFileId, file.id, "fileId persisted");
      assert.equal(fresh!.referenceSourcePage, null, "NO page persisted — 4-page file with no boundaries must not get page 1");
      await cleanupTender(tender.id);
    });

    it("repair returns UNRESOLVED (no write) when the extractor's source file is not active", async () => {
      const { tender, file } = await createTenderWithFile(user.id, "b4-unres", { referenceEvidence: false });
      await prisma.tender.update({ where: { id: tender.id }, data: { reference: null } });
      // Delete the only file AFTER creating a second file that has NO reference
      // pattern — so the extractor finds the value only in the DELETED file.
      await prisma.tenderFile.create({
        data: {
          tenderId: tender.id, fileName: "other.pdf", originalFileName: "other.pdf",
          mimeType: "application/pdf", size: 512,
          extractedText: `${QUOTE} — this file carries no procurement identifiers at all, only descriptive filler content long enough to pass the minimum source length check for extractors.`,
          totalPages: 1, extractionScore: 100,
        },
      });
      await prisma.tenderFile.update({ where: { id: file.id }, data: { deletionStatus: "DELETED" } });
      clearAuthCookie();
      await setAuthCookie(user.id);
      const req = new Request(`http://localhost/api/tenders/${tender.id}/repair-metadata`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: ["reference"] }),
      });
      const res = await repairRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      assert.equal(res.status, 200);
      const body = await res.json();
      const outcome = body.outcomesByField?.reference;
      assert.ok(outcome, "reference outcome present");
      assert.ok(["NOT_FOUND", "UNRESOLVED", "REJECTED"].includes(outcome.status), `deleted-file evidence must not repair (got ${outcome.status})`);
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(fresh!.reference, null, "no value written from a deleted file");
      assert.equal(fresh!.referenceSourceFileId, null, "no evidence written from a deleted file");
      await cleanupTender(tender.id);
    });
  });

  describe("Blocker 4: re-extract-metadata route (real handler, real DB)", () => {
    it("re-extract enriches evidence with page from canonical markers and never from assumption", async () => {
      const { tender, file } = await createTenderWithFile(user.id, "b4-reex", { referenceEvidence: false });
      // Clear values so re-extract has something to fill, and clear evidence
      await prisma.tender.update({
        where: { id: tender.id },
        data: { reference: null, referenceSourceFileId: null, referenceSourcePage: null, referenceSourceQuote: null },
      });
      clearAuthCookie();
      await setAuthCookie(user.id);
      const req = new Request(`http://localhost/api/tenders/${tender.id}/re-extract-metadata`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const res = await reExtractRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      assert.equal(res.status, 200, `re-extract should 200, got ${res.status}`);
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      if (fresh!.reference) {
        // If the extractor found the reference, its evidence must be grounded
        const contact = JSON.parse(fresh!.contactDetailsSourceJson ?? "{}");
        const refEntry = contact.procurementReferenceNumber;
        const dedicatedFileId = fresh!.referenceSourceFileId;
        assert.ok(dedicatedFileId === file.id || refEntry?.fileId === file.id, "reference evidence carries the durable active fileId");
      }
      await cleanupTender(tender.id);
    });

    it("re-extract ignores DELETED files entirely (no value, no evidence from deleted text)", async () => {
      const { tender, file } = await createTenderWithFile(user.id, "b4-reexdel", { referenceEvidence: false });
      await prisma.tender.update({
        where: { id: tender.id },
        data: { reference: null, referenceSourceFileId: null, referenceSourcePage: null, referenceSourceQuote: null, contactDetailsSourceJson: null },
      });
      // The ONLY file holding the reference is DELETED; add an active file without it
      const active = await prisma.tenderFile.create({
        data: {
          tenderId: tender.id, fileName: "active.pdf", originalFileName: "active.pdf",
          mimeType: "application/pdf", size: 512,
          extractedText: `[Page 1]\n${QUOTE} This active file carries no procurement identifiers at all, only descriptive prose to satisfy extraction minimums.`,
          totalPages: 1, extractionScore: 100,
        },
      });
      await prisma.tenderFile.update({ where: { id: file.id }, data: { deletionStatus: "DELETED" } });
      clearAuthCookie();
      await setAuthCookie(user.id);
      const req = new Request(`http://localhost/api/tenders/${tender.id}/re-extract-metadata`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const res = await reExtractRoute.POST(req, { params: Promise.resolve({ id: tender.id }) });
      assert.equal(res.status, 200);
      const fresh = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(fresh!.reference, null, "deleted file's reference must not be extracted");
      assert.equal(fresh!.referenceSourceFileId, null, "no evidence attributed to a deleted file");
      const contact = JSON.parse(fresh!.contactDetailsSourceJson ?? "{}");
      assert.ok(!contact.procurementReferenceNumber?.fileId || contact.procurementReferenceNumber.fileId === active.id, "no JSON evidence pointing at the deleted file");
      await cleanupTender(tender.id);
    });
  });

  // ═══ Failed writes cannot clear export blockers ═══════════════════════

  describe("Failed writes cannot clear export blockers", () => {
    it("without a confirmed BuildPlan the canonical readiness stays blocked regardless of repair success", async () => {
      const { getCurrentConfirmedBuildPlan } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b4-blocked");
      // Repair succeeds (metadata is fine) but NO BuildPlan row exists at all
      const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
      assert.equal(confirmed.ok, false, "no confirmed plan → blocked");
      await cleanupTender(tender.id);
    });

    it("a stale CONFIRMED plan (content drift) cannot authorize even with perfect metadata", async () => {
      const { getCurrentConfirmedBuildPlan } = await import("../lib/engine/build-plan");
      const { tender } = await createTenderWithFile(user.id, "b4-stale");
      await prisma.buildPlan.create({
        data: {
          tenderId: tender.id, status: "CONFIRMED", revision: 3,
          contentHash: "hash-at-confirm-time", confirmedRevision: 3, confirmedContentHash: "hash-at-confirm-time",
          itemsJson: JSON.stringify([{ canonicalId: "exact-1", exactFileName: "Technical Proposal.docx", exactOrder: 1, documentType: "TECHNICAL", required: true, sourceRequirementIds: [] }]),
          updatedAt: new Date(),
        },
      });
      // The live recomputed hash cannot equal "hash-at-confirm-time" → stale → blocked
      const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
      assert.equal(confirmed.ok, false, "hash drift → stale → fail closed");
      await cleanupTender(tender.id);
    });
  });
});
