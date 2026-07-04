// Real authenticated PostgreSQL route tests for the page-provenance fix in
// re-extract-metadata.
// RUN_DB_INTEGRATION=true is MANDATORY — these tests CANNOT be skipped.
//
// These tests use the application's REAL signed session/cookie mechanism
// (same pattern as tests/build-plan-route-integration.test.ts) and exercise
// the POST /api/tenders/[id]/re-extract-metadata route against a real
// PostgreSQL database. They prove:
//
//   1. TenderFile.totalPages = 3, boundaryless text, matching new metadata:
//      no page 1 is persisted or retained; canonical resolver leaves the
//      field ungrounded; release/export remains blocked.
//   2. TenderFile.totalPages = 1, boundaryless text: page 1 may be persisted
//      only when quote containment is valid.
//   3. [Page 2] marker with totalPages = 3: page 2 is persisted.
//   4. Existing evidence for a different value cannot survive a changed
//      scalar value.
//   5. Deleted/inactive files cannot supply or preserve evidence.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for page-provenance route tests.");
  process.exit(1);
}

// ─── Mock next/headers cookies() for test mode (same as build-plan-route-integration) ──
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
(Module as any)._resolveFilename = function(request: string, ...args: any[]) {
  if (request === "next/headers") {
    return (require.resolve as any).__next_headers_mock_path_rp || "";
  }
  return originalResolve.call(this, request, ...args);
};

const mockModulePath = "__next_headers_mock_rp__";
require.cache[mockModulePath] = {
  id: mockModulePath,
  filename: mockModulePath,
  loaded: true,
  exports: nextHeadersMock,
  paths: [],
  children: [],
  parent: null,
} as any;
(require.resolve as any).__next_headers_mock_path_rp = mockModulePath;

// ─── Real session token creation (same HMAC mechanism as lib/auth.ts) ────
import { createHmac, randomBytes, createHash } from "node:crypto";

const SESSION_COOKIE = "hope_session";
const SESSION_TTL_DAYS = 14;

function getSecret(): string {
  return process.env.SESSION_SECRET || process.env.AUTH_SECRET || "test-session-secret-at-least-32-characters-long-for-hmac";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function makeToken(userId: string): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${sig}`, expiresAt };
}

async function createSessionCookie(userId: string): Promise<string> {
  const { token, expiresAt } = makeToken(userId);
  await prisma.session.create({
    data: { token: hashToken(token), userId, expiresAt },
  });
  return token;
}

async function setAuthCookie(userId: string): Promise<string> {
  const token = await createSessionCookie(userId);
  __TEST_COOKIE_STORE[SESSION_COOKIE] = token;
  return `${SESSION_COOKIE}=${token}`;
}

function clearAuthCookie(): void {
  __TEST_COOKIE_STORE = {};
}

// ─── Route handler is imported DYNAMICALLY in before() so the mock is registered first ──
let reExtractMetadata: any;
import { resolveCanonicalFieldState } from "../lib/engine/canonical-field-state";

// ─── Test helpers ───────────────────────────────────────────────────────

let userId = "";
let cleanupTenderIds: string[] = [];
let cleanupUserIds: string[] = [];

async function createTestUser(role: "ADMIN" | "PROPOSAL_MANAGER" | "USER" = "PROPOSAL_MANAGER") {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `pageprov-${nonce}@example.test`,
      passwordHash: "test-hash",
      role,
      name: `PageProv Test ${nonce}`,
    },
  });
  cleanupUserIds.push(user.id);
  return user;
}

async function createTenderWithFile(opts: {
  userId: string;
  extractedText: string;
  totalPages: number | null;
  // Pre-existing evidence to test stale-evidence clearing
  existingClientName?: string | null;
  existingClientNameSourceFileId?: string | null;
  existingClientNameSourcePage?: number | null;
  existingClientNameSourceQuote?: string | null;
  deletionStatus?: string;
}): Promise<{ tenderId: string; fileId: string }> {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tender = await prisma.tender.create({
    data: {
      userId: opts.userId,
      title: `PageProv Tender ${nonce}`,
      clientName: opts.existingClientName ?? null,
      reference: `PP-${nonce}`,
      country: "Ethiopia",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      submissionMethod: "email",
      deadline: new Date(Date.now() + 30 * 86400 * 1000),
      clientNameSourceFileId: opts.existingClientNameSourceFileId ?? null,
      clientNameSourcePage: opts.existingClientNameSourcePage ?? null,
      clientNameSourceQuote: opts.existingClientNameSourceQuote ?? null,
    },
  });
  cleanupTenderIds.push(tender.id);
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: `tender-${nonce}.pdf`,
      originalFileName: `Tender-${nonce}.pdf`,
      mimeType: "application/pdf",
      size: 1024,
      extractedText: opts.extractedText,
      totalPages: opts.totalPages,
      extractedPages: opts.totalPages ?? 0,
      failedPages: 0,
      extractionScore: 100,
      extractionMethod: "text",
      deletionStatus: opts.deletionStatus ?? "ACTIVE",
    },
  });
  return { tenderId: tender.id, fileId: file.id };
}

async function callReExtract(tenderId: string, userId: string): Promise<Response> {
  // Set the real signed token on the mock cookie store so requireUser can read it.
  // The mock next/headers cookies() reads from __TEST_COOKIE_STORE, NOT from the
  // Request's cookie header — this matches the build-plan-route-integration pattern.
  await setAuthCookie(userId);
  const req = new Request(`http://localhost/api/tenders/${tenderId}/re-extract-metadata`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return reExtractMetadata(req, { params: Promise.resolve({ id: tenderId }) });
}

async function getCanonicalState(tenderId: string) {
  const tender = await prisma.tender.findUniqueOrThrow({
    where: { id: tenderId },
    include: {
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true } },
      metadataOverrides: true,
      requirements: { select: { id: true } },
    },
  });
  const activeTenderFileIds = new Set(tender.files.map((f) => f.id));
  return resolveCanonicalFieldState({
    tender: tender as any,
    overrides: tender.metadataOverrides as any,
    hasExtractedRequirements: tender.requirements.length > 0,
    activeTenderFileIds,
  });
}

// ─── Test suite ─────────────────────────────────────────────────────────

describe("re-extract-metadata page-provenance (real PostgreSQL)", () => {
  before(async () => {
    await prismaReady;
    const user = await createTestUser("PROPOSAL_MANAGER");
    userId = user.id;
    // Dynamic import AFTER the mock is registered so next/headers is mocked
    const routeModule = await import("../app/api/tenders/[id]/re-extract-metadata/route");
    reExtractMetadata = routeModule.POST;
  });

  after(async () => {
    // Cleanup in dependency order
    for (const tid of cleanupTenderIds) {
      await prisma.tenderRequirement.deleteMany({ where: { tenderId: tid } }).catch(() => {});
      await prisma.tenderMetadataOverride.deleteMany({ where: { tenderId: tid } }).catch(() => {});
      await prisma.tenderFile.deleteMany({ where: { tenderId: tid } }).catch(() => {});
      await prisma.tender.delete({ where: { id: tid } }).catch(() => {});
    }
    for (const uid of cleanupUserIds) {
      await prisma.session.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    cleanupTenderIds = [];
    cleanupUserIds = [];
  });

  it("totalPages=3, boundaryless text, matching new metadata: no page 1 persisted, field ungrounded, release blocked", async () => {
    // Boundaryless text: no [Page N] markers, no form feeds.
    // The extracted text contains "Ministry of Health" which the extractor
    // should find as clientName. But with totalPages=3 and no boundary,
    // computeProvenPageNumber returns null (page 1 only allowed when totalPages===1).
    const extractedText = "Tender Notice. Procuring Entity: Ministry of Health. The deadline is 30 December 2026. Submit proposals by email to bids@health.gov. This tender calls for the supply of medical equipment to various health facilities across the region. The Ministry of Health is the sole procuring entity for this tender. All bids must be submitted in sealed envelopes. The evaluation will be based on technical and financial criteria. Interested bidders should submit their proposals before the deadline. Late submissions will not be accepted. The procuring entity reserves the right to reject any or all bids. Bids must be valid for 120 days from the submission deadline. All queries regarding this tender should be directed to the procuring entity's procurement office. The evaluation committee will assess technical proposals first, followed by financial proposals for bidders who pass the technical threshold. The contract will be awarded to the lowest evaluated responsive bidder.";
    const { tenderId, fileId } = await createTenderWithFile({
      userId,
      extractedText,
      totalPages: 3,
      existingClientName: null, // empty so tryFill will set it
    });

    const res = await callReExtract(tenderId, userId);
    assert.equal(res.status, 200, `expected 200, got ${res.status}`);
    const body = await res.json();

    // The scalar clientName should be set (the extractor found it)
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    assert.ok(tender.clientName, "clientName scalar should be populated");

    // The fileId + quote MAY be set (enrichment found the value in the file),
    // but the page MUST be null (totalPages=3, no boundary → page not provable).
    // The canonical resolver will leave the field UNGROUNDED because page is null.
    assert.equal(tender.clientNameSourcePage, null, "clientNameSourcePage must be null — page not provable with totalPages=3 and no boundary");

    // The canonical resolver must leave clientName UNGROUNDED
    const canonical = await getCanonicalState(tenderId);
    const clientNameField = canonical.fields.find((f) => f.fieldKey === "clientName");
    assert.ok(clientNameField, "clientName field must exist in canonical state");
    assert.notEqual(clientNameField!.status, "EXTRACTED_AND_GROUNDED",
      `clientName must NOT be EXTRACTED_AND_GROUNDED — got ${clientNameField!.status}`);
    assert.equal(clientNameField!.isGrounded, false, "clientName.isGrounded must be false");

    // Release/export must be blocked (clientName is always-critical)
    assert.equal(canonical.hasGenerationBlocker, true, "generation must be blocked by ungrounded clientName");
    assert.equal(canonical.hasExportBlocker, true, "export must be blocked by ungrounded clientName");
  });

  it("totalPages=1, boundaryless text: page 1 may be persisted only when quote containment is valid", async () => {
    // With totalPages=1 and no boundary, computeProvenPageNumber returns 1
    // (the single-page exception). The value must still be found in the file
    // text (quote containment). If the value IS found, evidence is proven.
    const extractedText = "Tender Notice. Procuring Entity: Ministry of Education. The deadline is 15 January 2027. This tender calls for the supply of textbooks to primary schools. The Ministry of Education is the procuring entity. All bids must be submitted by email. The evaluation criteria include technical compliance and financial competitiveness. Interested bidders must submit their proposals before the deadline. Late submissions will be rejected. The Ministry reserves the right to reject any bid without explanation. The procuring entity reserves the right to reject any or all bids. Bids must be valid for 120 days from the submission deadline. All queries regarding this tender should be directed to the procuring entity's procurement office. The evaluation committee will assess technical proposals first, followed by financial proposals for bidders who pass the technical threshold. The contract will be awarded to the lowest evaluated responsive bidder.";
    const { tenderId } = await createTenderWithFile({
      userId,
      extractedText,
      totalPages: 1,
      existingClientName: null,
    });

    const res = await callReExtract(tenderId, userId);
    assert.equal(res.status, 200);
    const body = await res.json();

    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    assert.ok(tender.clientName, "clientName scalar should be populated");

    // With totalPages=1 and the value found in the text, evidence SHOULD be proven.
    assert.ok(tender.clientNameSourceFileId, "clientNameSourceFileId should be set — totalPages=1 allows page 1");
    assert.equal(tender.clientNameSourcePage, 1, "clientNameSourcePage should be 1 — totalPages=1 single-page exception");
    assert.ok(tender.clientNameSourceQuote, "clientNameSourceQuote should be set — value found in text");

    // The canonical resolver should mark clientName as GROUNDED
    const canonical = await getCanonicalState(tenderId);
    const clientNameField = canonical.fields.find((f) => f.fieldKey === "clientName");
    assert.ok(clientNameField);
    // Note: may be EXTRACTED_AND_GROUNDED or another grounded status depending on override state
    assert.equal(clientNameField!.isGrounded, true, "clientName.isGrounded must be true with totalPages=1 + valid quote containment");
  });

  it("[Page 2] marker with totalPages=3: page 2 is persisted", async () => {
    // Text with an explicit [Page 2] marker before the value. totalPages=3
    // so page 2 is within 1..3. computeProvenPageNumber should return 2.
    const extractedText = "Some intro text that provides context for the tender document." + "\n" + "[Page 2]" + "\n" + "Tender Notice. Procuring Entity: Ministry of Water Resources. Deadline 20 February 2027. This tender calls for borehole drilling services. The Ministry of Water Resources is the procuring entity. All bids must be submitted in sealed envelopes. The evaluation will be based on technical capacity and financial proposal. Interested bidders should submit their proposals before the deadline.";
    const { tenderId } = await createTenderWithFile({
      userId,
      extractedText,
      totalPages: 3,
      existingClientName: null,
    });

    const res = await callReExtract(tenderId, userId);
    assert.equal(res.status, 200);

    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    assert.ok(tender.clientName, "clientName scalar should be populated");
    assert.ok(tender.clientNameSourceFileId, "clientNameSourceFileId should be set");
    assert.equal(tender.clientNameSourcePage, 2, "clientNameSourcePage must be 2 — [Page 2] marker with totalPages=3");
    assert.ok(tender.clientNameSourceQuote, "clientNameSourceQuote should be set");

    const canonical = await getCanonicalState(tenderId);
    const clientNameField = canonical.fields.find((f) => f.fieldKey === "clientName");
    assert.ok(clientNameField);
    assert.equal(clientNameField!.isGrounded, true, "clientName.isGrounded must be true with [Page 2] marker");
  });

  it("existing evidence for a different value cannot survive a changed scalar value", async () => {
    // Pre-existing evidence for clientName = "TBD" (a placeholder that fails
    // validation) with page=1 + fileId + quote. Re-extract finds a NEW value
    // "Ministry of Health" in a 3-page file with no boundary. The old evidence
    // (page=1, fileId, quote) must NOT survive — it would be stale evidence
    // for a different value. tryFill overwrites the placeholder scalar AND
    // clears the evidence tuple atomically.
    const extractedText = "Tender Notice. Procuring Entity: Ministry of Health. Deadline 30 December 2026. This tender calls for medical equipment supply. The Ministry of Health is the procuring entity. All bids must be submitted by email. The evaluation criteria include technical compliance and financial competitiveness. Interested bidders must submit their proposals before the deadline. Late submissions will be rejected. The Ministry reserves the right to reject any bid. The procuring entity reserves the right to reject any or all bids. Bids must be valid for 120 days from the submission deadline. All queries regarding this tender should be directed to the procuring entity's procurement office. The evaluation committee will assess technical proposals first, followed by financial proposals for bidders who pass the technical threshold. The contract will be awarded to the lowest evaluated responsive bidder.";
    const { tenderId, fileId } = await createTenderWithFile({
      userId,
      extractedText,
      totalPages: 3,
      existingClientName: "TBD", // placeholder — fails isValidClientName, so tryFill will overwrite
    });
    // Set the stale evidence pointing to the file (for the OLD "TBD" value)
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        clientNameSourceFileId: fileId,
        clientNameSourcePage: 1,
        clientNameSourceQuote: "Old stale quote for TBD that should not survive.",
      },
    });

    // Verify pre-existing evidence is there
    const before = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    assert.equal(before.clientName, "TBD");
    assert.equal(before.clientNameSourcePage, 1);
    assert.equal(before.clientNameSourceFileId, fileId);

    const res = await callReExtract(tenderId, userId);
    assert.equal(res.status, 200);

    const after = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    // The scalar changed from "TBD" to the new value (the extractor captures
    // "Ministry of Health" plus surrounding text up to 120 chars)
    assert.notEqual(after.clientName, "TBD", "clientName should have changed from TBD");
    assert.ok(after.clientName?.includes("Ministry of Health"), `clientName should contain 'Ministry of Health', got: ${after.clientName}`);
    // The old page must NOT survive — page=1 for the old value is stale.
    // The fileId + quote may be re-set by enrichment (found the new value),
    // but the page must be null (totalPages=3, no boundary).
    assert.equal(after.clientNameSourcePage, null, "old clientNameSourcePage=1 must NOT survive — stale evidence cleared, new page not provable");

    // The canonical resolver must NOT ground the field (totalPages=3, no boundary)
    const canonical = await getCanonicalState(tenderId);
    const clientNameField = canonical.fields.find((f) => f.fieldKey === "clientName");
    assert.ok(clientNameField);
    assert.equal(clientNameField!.isGrounded, false, "clientName must NOT be grounded — old evidence cleared, new evidence not provable");
  });

  it("deleted/inactive files cannot supply or preserve evidence", async () => {
    // Create a tender with a DELETED file. The file's text contains the value,
    // but because it's DELETED, the enrichment must NOT attribute evidence to it.
    // We need at least one ACTIVE file for the route to not 400, but the ACTIVE
    // file has no matching text so no evidence should be attributed.
    const deletedText = "Tender Notice. Procuring Entity: Ministry of Agriculture. Deadline 10 March 2027. This tender calls for fertilizer supply to support agricultural development. The Ministry of Agriculture is the procuring entity. All bids must be submitted in sealed envelopes. The evaluation will be based on technical specifications and pricing. Interested bidders should submit their proposals before the deadline. Late submissions will not be accepted. The procuring entity reserves the right to reject any or all bids. Bids must be valid for 120 days from the submission deadline. All queries regarding this tender should be directed to the procuring entity's procurement office. The evaluation committee will assess technical proposals first, followed by financial proposals for bidders who pass the technical threshold. The contract will be awarded to the lowest evaluated responsive bidder.";
    const { tenderId } = await createTenderWithFile({
      userId,
      extractedText: "Some generic tender text that does not contain any procuring entity label. Just filler text to pass the 100 char minimum.",
      totalPages: 1,
      existingClientName: null,
      deletionStatus: "ACTIVE",
    });
    // Add a DELETED file with the actual matching text
    await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: "deleted-tender.pdf",
        originalFileName: "Deleted-Tender.pdf",
        mimeType: "application/pdf",
        size: 1024,
        extractedText: deletedText,
        totalPages: 1,
        extractedPages: 1,
        failedPages: 0,
        extractionScore: 100,
        extractionMethod: "text",
        deletionStatus: "DELETED",
      },
    });

    const res = await callReExtract(tenderId, userId);
    assert.equal(res.status, 200);

    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId } });
    // The EVIDENCE must NOT be set — deleted files cannot supply evidence.
    // The enrichment must NOT attribute evidence from a DELETED file.
    // The re-extract route only selects ACTIVE files, so no evidence should be set.
    assert.equal(tender.clientNameSourceFileId, null, "clientNameSourceFileId must be null — deleted file cannot supply evidence");

    // The canonical resolver must NOT ground the field
    const canonical = await getCanonicalState(tenderId);
    const clientNameField = canonical.fields.find((f) => f.fieldKey === "clientName");
    assert.ok(clientNameField);
    assert.equal(clientNameField!.isGrounded, false, "clientName must NOT be grounded — deleted file evidence rejected");
  });
});
