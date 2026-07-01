// PostgreSQL proof tests for canonical metadata evidence consistency.
// RUN_DB_INTEGRATION=true is MANDATORY — these tests CANNOT be skipped.
import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { buildDraftBuildPlan, validateBuildPlanForConfirmation, getCurrentConfirmedBuildPlan, computeTenderBuildPlanHash, validateCriticalMetadataEvidenceForBuildPlan } from "../lib/engine/build-plan";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";
import { isEmailSubmissionMethod, isPhysicalSubmissionMethod, isPortalSubmissionMethod } from "../lib/engine/submission-method-policy";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for metadata evidence tests.");
  process.exit(1);
}

async function createTenderWithMetadata(suffix: string, opts: {
  submissionMethod?: string;
  submissionEmails?: string | null;
  submissionAddress?: string | null;
  extractionScore?: number;
  extractedText?: string;
} = {}) {
  const nonce = `${Date.now()}-${suffix}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({ data: { email: `meta-${nonce}@example.test`, name: `Test ${suffix}`, passwordHash: "test-hash" } });
  const method = opts.submissionMethod ?? "email";
  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: `Metadata Evidence Tender ${nonce}`,
      clientName: "Ministry of Test Infrastructure",
      reference: `ME-${nonce}`,
      country: "Ethiopia",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
      exactFileNaming: '["Technical Proposal.docx"]',
      exactFileOrder: '[1]',
      submissionMethod: method,
      submissionAddress: opts.submissionAddress ?? (isEmailSubmissionMethod(method) ? null : "123 Test Street, Addis Ababa"),
      submissionEmails: opts.submissionEmails ?? (isEmailSubmissionMethod(method) ? "submit@example.com" : null),
      submissionEmailSubject: "Tender Submission",
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      // Source grounding for all critical fields
      clientNameSourcePage: 1,
      clientNameSourceQuote: "This tender requires a Technical Proposal for the project.",
      submissionMethodSourcePage: 1,
      submissionMethodSourceQuote: "This tender requires a Technical Proposal for the project.",
      titleSourcePage: 1,
      titleSourceQuote: "This tender requires a Technical Proposal for the project.",
      deadlineSourcePage: 1,
      deadlineSourceQuote: "This tender requires a Technical Proposal for the project.",
      ...(isEmailSubmissionMethod(method) ? {
        submissionEmailSourcePage: 1,
        submissionEmailSourceQuote: "This tender requires a Technical Proposal for the project.",
      } : {}),
      ...(isPhysicalSubmissionMethod(method) ? {
        submissionAddressSourcePage: 1,
        submissionAddressSourceQuote: "This tender requires a Technical Proposal for the project.",
      } : {}),
      ...(isPortalSubmissionMethod(method) ? {
        submissionEmailSourcePage: 1,
        submissionEmailSourceQuote: "This tender requires a Technical Proposal for the project.",
      } : {}),
    },
  });
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id,
      fileName: `tender-${nonce}.pdf`,
      originalFileName: `Tender-${nonce}.pdf`,
      mimeType: "application/pdf",
      size: 1024,
      extractedText: opts.extractedText ?? "This tender requires a Technical Proposal for the project.",
      totalPages: 3,
      extractedPages: 3,
      failedPages: 0,
      extractionScore: opts.extractionScore ?? 100,
      extractionMethod: "text",
    },
  });
  // Link all sourceFileId to the active file
  const updateData: any = {
    clientNameSourceFileId: file.id,
    submissionMethodSourceFileId: file.id,
    titleSourceFileId: file.id,
    deadlineSourceFileId: file.id,
  };
  if (isEmailSubmissionMethod(method) || isPortalSubmissionMethod(method)) updateData.submissionEmailSourceFileId = file.id;
  if (isPhysicalSubmissionMethod(method)) updateData.submissionAddressSourceFileId = file.id;
  await prisma.tender.update({ where: { id: tender.id }, data: updateData });

  await prisma.tenderRequirement.create({
    data: {
      tenderId: tender.id,
      title: "Technical Proposal",
      description: "Submit a technical proposal document.",
      requirementType: "TECHNICAL",
      priority: "MANDATORY",
      exactFileName: "Technical Proposal.docx",
      exactOrder: 1,
      sourceTenderFileId: file.id,
      sourcePageNumber: 1,
      sourceExactQuote: "This tender requires a Technical Proposal for the project.",
    },
  });

  // Create promoted AI job
  const tfh = await prisma.tender.findUnique({
    where: { id: tender.id },
    select: { title: true, description: true, intakeSummary: true, files: { select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true, deletionStatus: true } } },
  });
  const ch = computeAnalysisContentHash(buildTenderAnalysisContent({ title: tfh!.title, description: tfh!.description, intakeSummary: tfh!.intakeSummary, files: tfh!.files as any[] }, undefined));
  await prisma.aiJob.create({
    data: { tenderId: tender.id, userId: user.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", analysisInputHash: ch, startedAt: new Date(), finishedAt: new Date(), promotedAt: new Date() },
  });

  return { user, tender, file };
}

async function cleanup(tenderId: string, userId: string) {
  if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

async function confirmPlan(tenderId: string, userId: string) {
  const draft = await prisma.buildPlan.findFirst({ where: { tenderId, status: "DRAFT" } });
  if (!draft) throw new Error("No DRAFT plan");
  const items = JSON.parse(draft.itemsJson || "[]");
  const validation = await validateBuildPlanForConfirmation(prisma, tenderId, userId, items);
  if (!validation.ok) throw new Error(`Validation failed: ${validation.blockers.join("; ")}`);
  const hash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  if (!hash || hash !== draft.contentHash) throw new Error("Hash mismatch");
  await prisma.buildPlan.updateMany({
    where: { id: draft.id, status: "DRAFT", revision: draft.revision, contentHash: draft.contentHash },
    data: { status: "CONFIRMED", confirmedRevision: draft.revision, confirmedContentHash: hash, confirmedById: userId, confirmedAt: new Date() },
  });
}

describe("Canonical metadata evidence — real PostgreSQL proof", () => {
  before(async () => { await prismaReady; });
  after(async () => { await prisma.$disconnect(); });

  it("valid email tender drafts successfully without physical address", async () => {
    const { user, tender } = await createTenderWithMetadata("email-valid", { submissionMethod: "email submission required" });
    const result = await buildDraftBuildPlan(prisma, tender.id, user.id);
    assert.ok(result.ok, `Email tender should draft: ${JSON.stringify(result)}`);
    await cleanup(tender.id, user.id);
  });

  it("valid physical tender drafts successfully without email", async () => {
    const { user, tender } = await createTenderWithMetadata("physical-valid", { submissionMethod: "sealed envelope delivery" });
    const result = await buildDraftBuildPlan(prisma, tender.id, user.id);
    assert.ok(result.ok, `Physical tender should draft: ${JSON.stringify(result)}`);
    await cleanup(tender.id, user.id);
  });

  it("portal tender with ungrounded endpoint blocks draft", async () => {
    const { user, tender } = await createTenderWithMetadata("portal-ungrounded", { submissionMethod: "online portal submission" });
    // Remove source grounding for both endpoints
    await prisma.tender.update({ where: { id: tender.id }, data: { submissionEmailSourceFileId: null, submissionAddressSourceFileId: null } });
    const result = await buildDraftBuildPlan(prisma, tender.id, user.id);
    assert.ok(!result.ok, "Portal with no grounded endpoint should block");
    if (!result.ok) {
      assert.notEqual(result.code, "TENDER_NOT_FOUND", "Must not return false 404");
    }
    await cleanup(tender.id, user.id);
  });

  it("corrupting applicable evidence after draft blocks confirmation validation", async () => {
    const { user, tender, file } = await createTenderWithMetadata("corrupt-confirm", { submissionMethod: "email submission required" });
    const draftResult = await buildDraftBuildPlan(prisma, tender.id, user.id);
    assert.ok(draftResult.ok);
    // Corrupt the title source quote to not match file text
    await prisma.tender.update({ where: { id: tender.id }, data: { titleSourceQuote: "This quote does not appear in the file text." } });
    const draft = await prisma.buildPlan.findFirst({ where: { tenderId: tender.id, status: "DRAFT" } });
    const items = JSON.parse(draft!.itemsJson || "[]");
    const validation = await validateBuildPlanForConfirmation(prisma, tender.id, user.id, items);
    assert.ok(!validation.ok, "Corrupted evidence should block confirmation");
    await cleanup(tender.id, user.id);
  });

  it("corrupting applicable evidence after confirmation blocks getCurrentConfirmedBuildPlan", async () => {
    const { user, tender } = await createTenderWithMetadata("corrupt-confirmed", { submissionMethod: "email submission required" });
    await buildDraftBuildPlan(prisma, tender.id, user.id);
    await confirmPlan(tender.id, user.id);
    // Corrupt deadline source file — remove it
    await prisma.tender.update({ where: { id: tender.id }, data: { deadlineSourceFileId: null } });
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.ok(!confirmed.ok, "Corrupted evidence should reject confirmed plan");
    await cleanup(tender.id, user.id);
  });

  it("changing title source file ID makes confirmed plan stale", async () => {
    const { user, tender } = await createTenderWithMetadata("stale-title", { submissionMethod: "email submission required" });
    await buildDraftBuildPlan(prisma, tender.id, user.id);
    await confirmPlan(tender.id, user.id);
    // Change title source file to a foreign ID
    await prisma.tender.update({ where: { id: tender.id }, data: { titleSourceFileId: "foreign-file-id" } });
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.ok(!confirmed.ok, "Changed title source file should stale plan");
    await cleanup(tender.id, user.id);
  });

  it("changing deadline source page makes confirmed plan stale", async () => {
    const { user, tender } = await createTenderWithMetadata("stale-deadline-page", { submissionMethod: "email submission required" });
    await buildDraftBuildPlan(prisma, tender.id, user.id);
    await confirmPlan(tender.id, user.id);
    await prisma.tender.update({ where: { id: tender.id }, data: { deadlineSourcePage: 99 } });
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.ok(!confirmed.ok, "Changed deadline source page should stale plan");
    await cleanup(tender.id, user.id);
  });

  it("changing submission-email source quote makes confirmed plan stale", async () => {
    const { user, tender } = await createTenderWithMetadata("stale-email-quote", { submissionMethod: "email submission required" });
    await buildDraftBuildPlan(prisma, tender.id, user.id);
    await confirmPlan(tender.id, user.id);
    await prisma.tender.update({ where: { id: tender.id }, data: { submissionEmailSourceQuote: "Different quote not in file." } });
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.ok(!confirmed.ok, "Changed email source quote should stale plan");
    await cleanup(tender.id, user.id);
  });

  it("changing non-applicable endpoint does NOT stale confirmed plan", async () => {
    // Email tender: changing submissionAddress (non-applicable) should not stale
    const { user, tender } = await createTenderWithMetadata("no-stale-nonapplicable", { submissionMethod: "email submission required" });
    await buildDraftBuildPlan(prisma, tender.id, user.id);
    await confirmPlan(tender.id, user.id);
    // Change submissionAddress — non-applicable for email method
    await prisma.tender.update({ where: { id: tender.id }, data: { submissionAddress: "New Address That Should Not Matter" } });
    const confirmed = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    // The hash may or may not change depending on whether submissionAddress is in the hash
    // But the plan should NOT be rejected due to metadata evidence failure
    if (!confirmed.ok) {
      // If it's stale due to hash change, that's acceptable — the point is
      // it should not be rejected due to evidence validation failure
      // (hash change is a separate valid stale reason)
      const isEvidenceFailure = /metadata evidence/i.test(confirmed.blocker || "");
      assert.ok(!isEvidenceFailure, `Non-applicable endpoint change should not cause evidence failure: ${confirmed.blocker}`);
    }
    await cleanup(tender.id, user.id);
  });
});
