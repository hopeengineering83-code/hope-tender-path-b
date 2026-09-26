// The generation/export contract must be a PERSISTED, tenant-owned,
// hash-and-revision-bound plan that exists BEFORE generation and fails closed
// when it is missing, stale, corrupted or another tenant's.
//
// WHAT THE ORIGINAL OBSERVATION ACTUALLY FOUND
// ────────────────────────────────────────────
// Tender 5f333f5e-9ee9-43f4-b070-cbca395642aa had zero SubmissionPlanRevision
// and zero SubmissionPlanItem rows while generation proceeded. That is true,
// and it is true for EVERY tender on this head — those two tables are declared
// in prisma/schema.prisma and created by DDL in lib/prisma.ts, and no code
// anywhere reads or writes them. They are dead structures.
//
// The authority that actually governs generation and export is BuildPlan
// (status CONFIRMED, revision/contentHash bound), resolved by
// getCurrentConfirmedBuildPlan and enforced at generate, export, download,
// auto-finalize, reconcile and supersede. So the zero rows were not a missing
// authority — they were a second, permanently empty table that LOOKS like the
// authority, which is exactly why the observation was alarming.
//
// These tests pin both halves: the real authority behaves as a release
// contract must, and the dead tables grant nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { prisma } from "../lib/prisma";
import { getCurrentConfirmedBuildPlan, computeTenderBuildPlanHash } from "../lib/engine/build-plan";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

const ITEMS = JSON.stringify([
  { exactFileName: "Technical-Proposal.docx", documentType: "TECHNICAL_PROPOSAL", format: "DOCX", exactOrder: 1 },
]);

async function seedTenderWithPlan(planOverrides: Record<string, unknown> = {}) {
  const user = await prisma.user.create({
    data: { email: `plan-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  // A genuine confirmation also requires grounded critical metadata — every
  // field carries a source file, page and verbatim quote that must be
  // CONTAINED in that file's extracted text. This fixture supplies real ones;
  // the assertions below prove a tender that cannot satisfy them gets no
  // authority at all.
  const quotes = {
    title: "Water Supply Design for the Ministry of Water",
    client: "The procuring entity is the Ministry of Water.",
    reference: "Procurement reference number RFP-2026-001.",
    deadline: "Proposals must be received before 30 September 2026.",
    method: "Submission is by email.",
    address: "Submit to procurement@example.test.",
    emails: "Send proposals to procurement@example.test.",
  };
  const extractedText = `[Page 1] ${Object.values(quotes).join(" ")}`;
  const tender = await prisma.tender.create({
    data: {
      userId: user.id, status: "DRAFT",
      title: "Water Supply Design for the Ministry of Water",
      clientName: "Ministry of Water",
      procuringEntityName: "Ministry of Water",
      reference: "RFP-2026-001",
      deadline: new Date("2026-09-30T00:00:00Z"),
      submissionMethod: "email",
      submissionAddress: "procurement@example.test",
      submissionEmails: "procurement@example.test",
    },
  });
  const file = await prisma.tenderFile.create({
    data: {
      tenderId: tender.id, fileName: "rfp.pdf", originalFileName: "rfp.pdf",
      mimeType: "application/pdf", size: extractedText.length, storagePath: "",
      extractedText, totalPages: 1, extractedPages: 1, deletionStatus: "ACTIVE",
    },
  });
  await prisma.tender.update({
    where: { id: tender.id },
    data: {
      titleSourceFileId: file.id, titleSourcePage: 1, titleSourceQuote: quotes.title,
      clientNameSourceFileId: file.id, clientNameSourcePage: 1, clientNameSourceQuote: quotes.client,
      referenceSourceFileId: file.id, referenceSourcePage: 1, referenceSourceQuote: quotes.reference,
      deadlineSourceFileId: file.id, deadlineSourcePage: 1, deadlineSourceQuote: quotes.deadline,
      submissionMethodSourceFileId: file.id, submissionMethodSourcePage: 1, submissionMethodSourceQuote: quotes.method,
      submissionAddressSourceFileId: file.id, submissionAddressSourcePage: 1, submissionAddressSourceQuote: quotes.address,
      submissionEmailSourceFileId: file.id, submissionEmailSourcePage: 1, submissionEmailSourceQuote: quotes.emails,
    },
  });
  // The hash must be the REAL one computed over this tender's current content
  // and items. A fabricated hash is refused — which is the freshness control
  // doing its job, and is asserted directly further down.
  const realHash = await computeTenderBuildPlanHash(prisma, tender.id, user.id, JSON.parse(ITEMS));
  assert.ok(realHash, "the fixture needs a real content hash to represent a genuine confirmation");
  const plan = await prisma.buildPlan.create({
    data: {
      tenderId: tender.id,
      status: "CONFIRMED",
      revision: 1,
      contentHash: realHash!,
      confirmedRevision: 1,
      confirmedContentHash: realHash!,
      itemsJson: ITEMS,
      ...planOverrides,
    },
  });
  return { user, tender, plan, realHash: realHash! };
}

async function cleanup(userId: string, tenderId: string) {
  await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

test("a tender with no plan at all authorizes nothing", { skip: !RUN, timeout: 60_000 }, async () => {
  const user = await prisma.user.create({
    data: { email: `plan-none-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  const tender = await prisma.tender.create({ data: { userId: user.id, title: "No Plan", status: "DRAFT" } });
  try {
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /No source-verified Build Plan exists/);
  } finally {
    await cleanup(user.id, tender.id);
  }
});

test("the authority is tenant-owned: another user's id resolves nothing", { skip: !RUN, timeout: 60_000 }, async () => {
  const { user, tender } = await seedTenderWithPlan();
  const intruder = await prisma.user.create({
    data: { email: `intruder-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  try {
    const mine = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(mine.ok, true, mine.ok ? "" : (mine as { blocker: string }).blocker);

    const theirs = await getCurrentConfirmedBuildPlan(prisma, tender.id, intruder.id);
    assert.equal(theirs.ok, false, "a plan must never resolve for a user who does not own the tender");
    assert.match((theirs as { blocker: string }).blocker, /No source-verified Build Plan exists/);
  } finally {
    await cleanup(user.id, tender.id);
    await prisma.user.delete({ where: { id: intruder.id } }).catch(() => {});
  }
});

test("a DRAFT plan is not authority — only CONFIRMED is", { skip: !RUN, timeout: 60_000 }, async () => {
  const { user, tender } = await seedTenderWithPlan({ status: "DRAFT" });
  try {
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(result.ok, false);
  } finally {
    await cleanup(user.id, tender.id);
  }
});

test("a revision/hash mismatch fails closed — a fabricated confirmation is refused", { skip: !RUN, timeout: 60_000 }, async () => {
  // Exactly what a manual database patch would look like: status flipped to
  // CONFIRMED without the matching confirmed revision/hash.
  const { user, tender } = await seedTenderWithPlan({ confirmedRevision: 0, confirmedContentHash: "b".repeat(64) });
  // confirmedRevision 0 !== revision 1 and the confirmed hash is not the real
  // one: precisely the shape of a hand-edited "CONFIRMED" row.
  try {
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(result.ok, false, "a hand-confirmed plan must not authorize generation");
    assert.match((result as { blocker: string }).blocker, /stale or hash\/revision mismatched/);
  } finally {
    await cleanup(user.id, tender.id);
  }
});

test("corrupted plan items fail closed rather than authorizing an unreadable contract", { skip: !RUN, timeout: 60_000 }, async () => {
  const { user, tender } = await seedTenderWithPlan({ itemsJson: "{not json" });
  try {
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(result.ok, false);
    assert.match((result as { blocker: string }).blocker, /corrupted and cannot be read/);
  } finally {
    await cleanup(user.id, tender.id);
  }
});

test("the dead SubmissionPlanRevision tables grant no authority, however they are populated", { skip: !RUN, timeout: 60_000 }, async () => {
  const user = await prisma.user.create({
    data: { email: `dead-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  const tender = await prisma.tender.create({ data: { userId: user.id, title: "Dead Tables", status: "DRAFT" } });
  try {
    // Populate the table that LOOKS like the submission-plan authority, with a
    // fully "confirmed" revision and a real item...
    const revision = await prisma.submissionPlanRevision.create({
      data: {
        tenderId: tender.id, revision: 1, status: "CONFIRMED",
        sourceContentHash: "c".repeat(64), requirementsHash: "d".repeat(64),
        createdById: user.id, confirmedById: user.id,
        confirmedAt: new Date(), confirmationHash: "e".repeat(64),
      },
    });
    await prisma.submissionPlanItem.create({
      data: {
        submissionPlanId: revision.id, exactFileName: "Technical-Proposal.docx",
        exactOrder: 1, documentType: "TECHNICAL_PROPOSAL", format: "DOCX", envelope: "TECHNICAL",
      },
    });

    // ...and it still authorizes nothing, because nothing consults it.
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(
      result.ok,
      false,
      "SubmissionPlanRevision must not be mistaken for release authority — the real contract is BuildPlan",
    );

    // The converse of the original observation: zero rows here is the normal
    // state for every tender, so their absence proves nothing about generation.
    const otherTender = await prisma.tender.create({ data: { userId: user.id, title: "Normal", status: "DRAFT" } });
    assert.equal(await prisma.submissionPlanRevision.count({ where: { tenderId: otherTender.id } }), 0);
    await prisma.tender.delete({ where: { id: otherTender.id } }).catch(() => {});
  } finally {
    await cleanup(user.id, tender.id);
  }
});

test("a valid confirmed plan yields the items that become the generation contract", { skip: !RUN, timeout: 60_000 }, async () => {
  const { user, tender } = await seedTenderWithPlan();
  try {
    const result = await getCurrentConfirmedBuildPlan(prisma, tender.id, user.id);
    assert.equal(result.ok, true, result.ok ? "" : (result as { blocker: string }).blocker);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]!.exactFileName, "Technical-Proposal.docx");
    assert.equal(result.plan.status, "CONFIRMED");
    assert.equal(result.plan.confirmedRevision, result.plan.revision);
    assert.equal(result.plan.confirmedContentHash, result.plan.contentHash);
    // And the confirmed hash is the one genuinely computed from the tender's
    // current content — not any value that happens to be stored.
    const recomputed = await computeTenderBuildPlanHash(prisma, tender.id, user.id, result.items);
    assert.equal(result.plan.confirmedContentHash, recomputed);
  } finally {
    await cleanup(user.id, tender.id);
  }
});
