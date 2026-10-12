// Real gap found while auditing every source-of-truth-changing route
// (PR #1266's audit, H-02): app/api/tenders/[id]/re-extract-metadata/route.ts
// re-runs regex/NLP metadata inference over the tender's EXISTING extracted
// text and can correct a previously-empty or previously-corrupted scalar
// field (clientName, reference, deadline, submission details, ...) — but
// unlike the byte-level re-extraction/upload routes, it never called
// invalidateTenderForSourceRevision(). A GeneratedDocument or confirmed
// BuildPlan created BEFORE the correction would keep looking valid even
// though it baked in the OLD (empty/corrupted) value, and any queued/running
// AI job would keep operating on the stale assumption.
//
// This proves, against a real PostgreSQL database and the actual route
// handler, that a metadata correction now supersedes already-generated
// documents and the confirmed BuildPlan — exactly as a byte-level
// re-extraction already does — while a no-op call (nothing left to correct)
// leaves them untouched.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let cookieStore: Record<string, string> = {};
const nextHeadersMock = {
  cookies: async () => ({
    get: (name: string) => cookieStore[name] ? { name, value: cookieStore[name] } : undefined,
    set: (name: string, value: string) => { cookieStore[name] = value; },
    delete: (name: string) => { delete cookieStore[name]; },
    getAll: () => Object.entries(cookieStore).map(([name, value]) => ({ name, value })),
  }),
};
const Module = require("module");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "next/headers") {
    return (require.resolve as any).__reex_invalidation_next_headers_mock_path || "";
  }
  return originalResolve.call(this, request, ...args);
};
const mockModulePath = "__reex_invalidation_next_headers_mock__";
require.cache[mockModulePath] = { id: mockModulePath, filename: mockModulePath, loaded: true, exports: nextHeadersMock, paths: [], children: [], parent: null } as any;
(require.resolve as any).__reex_invalidation_next_headers_mock_path = mockModulePath;

const SESSION_COOKIE = "hope_session";
function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("A test session secret of at least 32 characters is required");
  return secret;
}
function makeToken(userId: string): { token: string } {
  const expiresAt = new Date(Date.now() + 14 * 86400 * 1000);
  const payload = { userId, exp: Math.floor(expiresAt.getTime() / 1000), nonce: randomBytes(24).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return { token: `${encoded}.${signature}` };
}
async function authenticate(userId: string): Promise<void> {
  cookieStore = {};
  const { token } = makeToken(userId);
  await prisma.session.create({ data: { token: createHash("sha256").update(token).digest("hex"), userId, expiresAt: new Date(Date.now() + 86400_000) } });
  cookieStore[SESSION_COOKIE] = token;
}

const QUOTE_TEXT = "This tender requires a Technical Proposal for the Ministry of Sample Works project delivery.";
const SOURCE_TEXT = `[Page 1]\n${QUOTE_TEXT}\nProcuring Entity: Ministry of Sample Works\nTender Reference: SAMPLE-2027-777\n[Page 2]\nSubmission deadline: 2027-09-30`;

describe("re-extract-metadata invalidates stale generated artifacts on a real correction — real PostgreSQL", () => {
  let route: { POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> };
  let userId: string;

  before(async () => {
    await prismaReady;
    route = await import("../app/api/tenders/[id]/re-extract-metadata/route");
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `reex-invalidate-${nonce}@example.test`, name: "Re-extract Invalidation Test", passwordHash: "test-hash", role: "ADMIN" },
    });
    userId = user.id;
  });

  after(async () => {
    cookieStore = {};
    // GeneratedDocument has an AFTER DELETE trigger that refreshes
    // SubmissionPlanState for the owning tenderId; deleting the Tender
    // directly can cascade-delete GeneratedDocument first and have that
    // trigger try to upsert SubmissionPlanState for a tenderId whose parent
    // row is (mid-cascade) already gone, tripping
    // SubmissionPlanState_tenderId_fkey. Deleting GeneratedDocument
    // explicitly first (while the Tender row still exists) avoids the
    // ordering issue — a pre-existing DB trigger quirk, not something this
    // test or the H-02 fix introduces.
    const tenders = await prisma.tender.findMany({ where: { userId }, select: { id: true } });
    const tenderIds = tenders.map((t) => t.id);
    if (tenderIds.length > 0) {
      await prisma.generatedDocument.deleteMany({ where: { tenderId: { in: tenderIds } } });
    }
    await prisma.tender.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function makeTender(suffix: string, referenceValue: string | null, extractedText: string, opts: { description?: string; intakeSummary?: string } = {}) {
    const nonce = `${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `Reex Invalidation Tender ${nonce}`,
        reference: referenceValue,
        status: "DOCUMENTS_READY",
        stage: "EXPORT",
        readinessScore: 90,
        description: opts.description ?? null,
        intakeSummary: opts.intakeSummary ?? null,
      },
    });
    await prisma.tenderFile.create({
      data: {
        tenderId: tender.id,
        fileName: `${nonce}.pdf`, originalFileName: `${nonce}.pdf`,
        mimeType: "application/pdf", size: 2048,
        extractedText,
        totalPages: 2, extractedPages: 2, failedPages: 0,
        extractionScore: 100, extractionMethod: "text",
      },
    });
    const doc = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id,
        name: "Technical Proposal.docx",
        documentType: "PROPOSAL",
        generationStatus: "GENERATED",
        validationStatus: "VALID",
        reviewStatus: "APPROVED",
      },
    });
    const plan = await prisma.buildPlan.create({
      data: {
        tenderId: tender.id,
        status: "CONFIRMED",
        contentHash: "fixture-hash",
        confirmedAt: new Date(),
        confirmedBy: "tester@example.test",
      },
    });
    return { tender, doc, plan };
  }

  async function callRoute(tenderId: string) {
    await authenticate(userId);
    const req = new Request(`http://localhost/api/tenders/${tenderId}/re-extract-metadata`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    });
    return route.POST(req, { params: Promise.resolve({ id: tenderId }) });
  }

  it("supersedes an already-generated document and confirmed BuildPlan when a correction actually happens", async () => {
    const { tender, doc, plan } = await makeTender("corrected", null, SOURCE_TEXT); // reference empty -> extractor will fill it
    const res = await callRoute(tender.id);
    assert.equal(res.status, 200);
    const body = await res.json() as { updated: number };
    assert.ok(body.updated > 0, "the extractor must have found and filled at least one field for this to be a meaningful test");

    const freshDoc = await prisma.generatedDocument.findUnique({ where: { id: doc.id } });
    assert.equal(freshDoc?.generationStatus, "SUPERSEDED", "a document generated before the correction must be superseded");

    const freshPlan = await prisma.buildPlan.findUnique({ where: { id: plan.id } });
    assert.equal(freshPlan?.status, "SUPERSEDED", "a BuildPlan confirmed before the correction must be superseded");

    const freshTender = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.equal(freshTender?.status, "ANALYSIS_REQUIRED", "the tender must fall back into analysis after a metadata correction");
    assert.equal(freshTender?.readinessScore, 0);
  });

  it("leaves generated documents and the confirmed BuildPlan untouched when nothing needed correcting", async () => {
    // Filler text with no title/reference/deadline/client/submission patterns
    // at all — the extractor finds nothing new for any of those. description
    // and intakeSummary are catch-all fields the extractor always derives
    // from whatever text exists, so the fixture pre-populates them (any
    // non-empty value is preserved as a valid stored value, same as a real
    // manual edit) to make this a genuine no-op rather than a first-fill.
    const fillerText = "This paragraph intentionally repeats generic prose without any dates, reference codes, contact details, or named entities, purely to satisfy the minimum extractable text length required by this route for testing purposes only, many times over so the extractor treats it as a real body of text rather than a too-short fragment needing OCR.";
    const { tender, doc, plan } = await makeTender("noop", "SAMPLE-2027-777", fillerText, {
      description: "Pre-existing manually written description that must be preserved untouched.",
      intakeSummary: "Pre-existing manually written intake summary that must be preserved untouched.",
    });
    const res = await callRoute(tender.id);
    assert.equal(res.status, 200);
    const body = await res.json() as { updated: number };
    assert.equal(body.updated, 0, "the filler text contains nothing extractable, so no field should change");

    const freshDoc = await prisma.generatedDocument.findUnique({ where: { id: doc.id } });
    assert.equal(freshDoc?.generationStatus, "GENERATED", "no correction happened, so nothing should be invalidated");

    const freshPlan = await prisma.buildPlan.findUnique({ where: { id: plan.id } });
    assert.equal(freshPlan?.status, "CONFIRMED");

    const freshTender = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.equal(freshTender?.status, "DOCUMENTS_READY", "tender status must be untouched when nothing was corrected");
  });
});
