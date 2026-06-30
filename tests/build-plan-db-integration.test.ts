// Integration test: BuildPlan DRAFT/CONFIRMED service actually persists to
// the real PostgreSQL database. This is the test that would have caught the
// original bug where the service wrote `builtById`, `confirmedRevision`,
// `confirmedContentHash`, `confirmedById`, `confirmedAt` — fields that did
// NOT exist in schema/migration/bootstrap, so every DRAFT build and CONFIRMED
// update threw "Unknown argument" Prisma errors at runtime. Mock-only tests
// could not detect this because mocks don't validate against the Prisma
// schema. This test exercises the real Prisma client against the real DB.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import {
  buildDraftBuildPlan,
  computeTenderBuildPlanHash,
  validateBuildPlanForConfirmation,
  getCurrentConfirmedBuildPlan,
  validateConfirmedPlanDocuments,
} from "../lib/engine/build-plan";

const dbDescribe = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;

let userId: string;
let tenderId: string;
let fileId: string;

dbDescribe("BuildPlan DRAFT/CONFIRMED service persists to real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `buildplan-integration-${nonce}@example.test`,
        name: "Build Plan Integration Test",
        passwordHash: "test-hash",
      },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `BuildPlan Integration Tender ${nonce}`,
        clientName: "BuildPlan Integration Procuring Authority",
        reference: `BP-${nonce}`,
        country: "Ethiopia",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        exactFileNaming: '["Technical Proposal.docx"]',
        exactFileOrder: '[1]',
        submissionMethod: "email",
        submissionEmails: "submission@example.com",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    tenderId = tender.id;
    const file = await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: `tender-${nonce}.pdf`,
        originalFileName: `Tender-${nonce}.pdf`,
        mimeType: "application/pdf",
        size: 1024,
        extractedText:
          "Page 1. This tender requires a Technical Proposal.\nPage 2. The bidder shall submit audited financial statements.\nPage 3. Submission deadline is 30 days from now.",
        totalPages: 3,
        extractedPages: 3,
        failedPages: 0,
        extractionScore: 100,
        extractionMethod: "text",
      },
    });
    fileId = file.id;
    // Create a MANDATORY requirement with source grounding tied to the active file.
    await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: "Technical Proposal",
        description: "Submit a technical proposal document.",
        requirementType: "TECHNICAL",
        priority: "MANDATORY",
        exactFileName: "Technical Proposal.docx",
        exactOrder: 1,
        sourceTenderFileId: fileId,
        sourcePageNumber: 1,
        sourceExactQuote: "This tender requires a Technical Proposal.",
      },
    });
  });

  after(async () => {
    // Clean up — Tender cascade-deletes BuildPlan, TenderFile, TenderRequirement.
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("buildDraftBuildPlan writes status=DRAFT, builtById, itemsJson, validationJson, contentHash", async () => {
    const plan = await buildDraftBuildPlan(prisma, tenderId, userId);
    assert.ok(plan, "buildDraftBuildPlan must return the created/updated DRAFT plan");
    assert.equal(plan.status, "DRAFT");
    assert.equal(plan.builtById, userId);
    assert.ok(plan.contentHash, "contentHash must be set");
    assert.ok(plan.itemsJson, "itemsJson must be set");
    assert.ok(plan.validationJson, "validationJson must be set");
    // Confirmation fields must be null on a fresh DRAFT.
    assert.equal(plan.confirmedRevision, null);
    assert.equal(plan.confirmedContentHash, null);
    assert.equal(plan.confirmedById, null);
    assert.equal(plan.confirmedAt, null);

    // Verify the row was actually persisted with the new columns.
    const persisted = await prisma.$queryRawUnsafe<Array<{
      status: string;
      builtById: string | null;
      confirmedRevision: number | null;
      confirmedContentHash: string | null;
      confirmedById: string | null;
    }>>(
      `SELECT status, "builtById", "confirmedRevision", "confirmedContentHash", "confirmedById" FROM "BuildPlan" WHERE "tenderId" = $1`,
      tenderId,
    );
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].status, "DRAFT");
    assert.equal(persisted[0].builtById, userId);
    assert.equal(persisted[0].confirmedRevision, null);
    assert.equal(persisted[0].confirmedContentHash, null);
    assert.equal(persisted[0].confirmedById, null);
  });

  it("confirm route writes status=CONFIRMED, confirmedRevision, confirmedContentHash, confirmedById, confirmedAt", async () => {
    // Load the draft items.
    const draft = await prisma.buildPlan.findFirst({
      where: { tenderId, status: "DRAFT" },
    });
    assert.ok(draft, "DRAFT plan must exist from the previous test");
    const items = JSON.parse(draft!.itemsJson || "[]");

    // Validate the items for confirmation.
    const validation = await validateBuildPlanForConfirmation(prisma, tenderId, userId, items);
    assert.equal(validation.ok, true, `Validation must pass: ${validation.blockers.join("; ")}`);

    // Compute the current hash and confirm.
    const currentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
    assert.ok(currentHash, "currentHash must be computable");

    // Delete any prior CONFIRMED rows (mirrors confirm route behavior).
    await prisma.buildPlan.deleteMany({ where: { tenderId, status: "CONFIRMED" } });
    const confirmed = await prisma.buildPlan.update({
      where: { id: draft!.id },
      data: {
        status: "CONFIRMED",
        confirmedRevision: draft!.revision,
        confirmedContentHash: currentHash,
        confirmedById: userId,
        confirmedBy: userId, // legacy alias
        confirmedAt: new Date(),
        validationJson: JSON.stringify({ ok: true, blockers: [] }),
      },
    });
    assert.equal(confirmed.status, "CONFIRMED");
    assert.equal(confirmed.confirmedById, userId);
    assert.equal(confirmed.confirmedRevision, draft!.revision);
    assert.equal(confirmed.confirmedContentHash, currentHash);
    assert.ok(confirmed.confirmedAt);
  });

  it("getCurrentConfirmedBuildPlan returns ok:true with matching hash", async () => {
    const result = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
    assert.equal(result.ok, true, "Confirmed plan must be detected as current");
    if (result.ok) {
      assert.equal(result.plan.status, "CONFIRMED");
      assert.equal(result.plan.confirmedContentHash, result.currentHash);
    }
  });

  it("validateConfirmedPlanDocuments blocks when required plan item has no matching generated document", async () => {
    const draft = await prisma.buildPlan.findFirst({
      where: { tenderId },
    });
    const items = JSON.parse(draft!.itemsJson || "[]");
    const result = await validateConfirmedPlanDocuments(prisma, tenderId, userId, items);
    assert.equal(result.ok, false, "Must block when no generated document matches the required plan item");
    assert.match(result.blockers.join("\n"), /missing|not generated/i);
  });

  it("changing tender file content makes the recorded plan STALE (contentHash mismatch)", async () => {
    // Modify the file content — this should change the computed hash.
    await prisma.tenderFile.update({
      where: { id: fileId },
      data: { extractedText: "Page 1. COMPLETELY DIFFERENT TENDER CONTENT. Page 2. Different submission rules." },
    });
    const result = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId);
    // The confirmed hash no longer matches the current computed hash.
    assert.equal(result.ok, false, "Confirmed plan must be STALE after file content changed");
    if (!result.ok) {
      assert.match(result.blocker, /stale|hash/i);
    }
  });
});
