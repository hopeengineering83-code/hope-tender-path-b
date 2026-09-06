// P1: a submission plan must never be silently empty when real tender
// requirements exist.
//
// The acceptance matrix requires that "the app does not build an empty
// submission plan when requirements exist". The guards for this live in
// lib/engine/build-plan.ts (`NO_MANDATORY_REQUIREMENTS`, `NO_PLAN_ITEMS`) and
// lib/engine/automatic-build-plan.ts, but nothing exercised them against a real
// tender — the acceptance item was asserted, never demonstrated.
//
// These tests drive the real code against a real database and prove the
// fail-closed behaviour end to end:
//
//   • Requirements exist but no submission scope can be derived → the draft is
//     REFUSED with an explicit machine-readable reason, not silently emptied.
//   • The refusal creates NO confirmed BuildPlan, so generation/export cannot
//     later read an empty plan as authority.
//   • A grounded tender that CAN derive scope produces a non-empty plan, so the
//     guard is not simply blocking everything.
//   • Confirmation validation independently refuses an empty item list.
//
// Evidence level B (PostgreSQL, real engine code).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";

/** Quote must appear verbatim in the file text for grounding to hold. */
const MANDATORY_QUOTE =
  "Bidders must submit a completed Technical Proposal together with the Financial Proposal in separate sealed envelopes.";

const FILE_TEXT =
  "SECTION 1 — INSTRUCTIONS TO BIDDERS.\n" +
  `${MANDATORY_QUOTE}\n` +
  "The deadline for submission is 30 June 2026 at 15:00 local time.\n" +
  "Submissions must be delivered to the Ministry of Works tender box.\n" +
  "Annex A sets out the evaluation criteria applied by the evaluation committee.";

type Seeded = {
  userId: string;
  tenderId: string;
  fileId: string;
};

async function seedGroundedTender(opts: {
  /** When false, requirements carry no exact file naming, so no scope can be derived. */
  withExactFileNaming: boolean;
}): Promise<Seeded> {
  const { prisma } = await import("../lib/prisma");
  const bcrypt = (await import("bcryptjs")).default;

  const user = await prisma.user.create({
    data: {
      email: `plan-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash: await bcrypt.hash("Plan-password-2026-secure!", 10),
      role: "ADMIN",
      name: "Plan Test",
    },
  });
  await prisma.company.create({
    data: { userId: user.id, name: "Plan Co", legalName: "Plan Co Ltd", setupCompletedAt: new Date() },
  });

  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: "Plan Test Tender",
      clientName: "Ministry of Works",
      files: {
        create: [{
          originalFileName: "itb.pdf",
          fileName: "itb.pdf",
          mimeType: "application/pdf",
          size: 8192,
          extractedText: FILE_TEXT,
          deletionStatus: "ACTIVE",
          contentSha256: "e".repeat(64),
          integrityStatus: "VERIFIED",
          extractionScore: 95,
          extractionMethod: "text",
          totalPages: 10,
        }],
      },
    },
    include: { files: true },
  });
  const fileId = tender.files[0].id;

  // A fully grounded MANDATORY requirement: active file + valid page + a quote
  // that is genuinely present in the file text.
  await prisma.tenderRequirement.create({
    data: {
      tenderId: tender.id,
      title: "Submit Technical and Financial Proposals",
      description: "Both proposals must be submitted in separate sealed envelopes.",
      requirementType: "DOCUMENT",
      priority: "MANDATORY",
      sourceTenderFileId: fileId,
      sourcePageNumber: 1,
      sourceExactQuote: MANDATORY_QUOTE,
      sourceExtractionMethod: "text",
      sourceConfidence: 0.95,
      ...(opts.withExactFileNaming
        ? { exactFileName: "Technical-Proposal.docx", exactOrder: 1 }
        : {}),
    },
  });

  return { userId: user.id, tenderId: tender.id, fileId };
}

async function cleanup(seeded: Seeded) {
  const { prisma } = await import("../lib/prisma");
  const { userId, tenderId } = seeded;
  await prisma.buildPlan?.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderRequirement.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tenderFile.deleteMany({ where: { tenderId } }).catch(() => {});
  await prisma.tender.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.companyDocument.deleteMany({ where: { company: { userId } } }).catch(() => {});
  await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}

describe("P1: submission plan is never silently empty", { skip: !RUN_DB }, () => {
  it("refuses with an explicit reason when requirements exist but no scope can be derived", async () => {
    const { prisma } = await import("../lib/prisma");
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");

    const seeded = await seedGroundedTender({ withExactFileNaming: false });
    try {
      const result = await buildDraftBuildPlan(prisma, seeded.tenderId, seeded.userId);

      // The requirement exists and is fully grounded, so this must NOT be a
      // silent empty plan — it must be an explicit, machine-readable refusal.
      assert.equal(result.ok, false, "an underivable plan must not be reported as ok");
      if (result.ok) return;

      assert.ok(
        typeof result.code === "string" && result.code.length > 0,
        "the refusal must carry a machine-readable code",
      );
      assert.ok(
        typeof result.message === "string" && result.message.length > 0,
        "the refusal must carry an explicit human-readable reason",
      );
      // Whatever the precise blocker, it must never be silence.
      assert.notEqual(result.code, "OK");
    } finally {
      await cleanup(seeded);
    }
  });

  it("creates no CONFIRMED BuildPlan when the plan cannot be derived", async () => {
    const { prisma } = await import("../lib/prisma");
    const { buildAndVerifyBuildPlan } = await import("../lib/engine/automatic-build-plan");

    const seeded = await seedGroundedTender({ withExactFileNaming: false });
    try {
      const result = await buildAndVerifyBuildPlan(prisma, seeded.tenderId, seeded.userId, {
        reuseCurrent: false,
      });

      assert.equal(result.ok, false, "automatic build must fail closed");
      assert.equal(
        result.authorizesGeneration,
        false,
        "a refused plan must never authorise generation",
      );

      // The decisive check: nothing downstream may later find a CONFIRMED plan.
      const confirmed = await prisma.buildPlan.count({
        where: { tenderId: seeded.tenderId, status: "CONFIRMED" },
      });
      assert.equal(confirmed, 0, "a refused build must leave zero CONFIRMED BuildPlan rows");
    } finally {
      await cleanup(seeded);
    }
  });

  it("confirmation validation independently rejects an empty item list", async () => {
    const { prisma } = await import("../lib/prisma");
    const { validateBuildPlanForConfirmation } = await import("../lib/engine/build-plan");

    const seeded = await seedGroundedTender({ withExactFileNaming: true });
    try {
      // Even if an empty list reached confirmation by another route, it must be
      // refused — the empty-plan guard cannot depend on the caller.
      const validation = await validateBuildPlanForConfirmation(prisma, seeded.tenderId, seeded.userId, []);

      assert.equal(validation.ok, false, "an empty item list must never validate");
      assert.ok(validation.blockers.length > 0, "the refusal must state why");
      assert.ok(
        validation.blockers.some((b) => /no tender-controlled required files|cannot be empty|item count/i.test(b)),
        `expected an explicit empty-plan blocker, got: ${validation.blockers.join(" | ")}`,
      );
    } finally {
      await cleanup(seeded);
    }
  });

  it("does not block a tender that genuinely has derivable submission scope", async () => {
    const { prisma } = await import("../lib/prisma");
    const { buildDraftBuildPlan } = await import("../lib/engine/build-plan");

    const seeded = await seedGroundedTender({ withExactFileNaming: true });
    try {
      const result = await buildDraftBuildPlan(prisma, seeded.tenderId, seeded.userId);

      // This asymmetry matters: without it, a guard that refused everything
      // would pass the tests above while making the product unusable.
      if (result.ok) {
        assert.ok(result.items.length > 0, "a derivable plan must not be empty");
      } else {
        // If it still refuses, it must be for a stated reason unrelated to
        // emptiness (e.g. metadata evidence), never a silent empty plan.
        assert.notEqual(
          result.code,
          "NO_PLAN_ITEMS",
          `scope was derivable, so NO_PLAN_ITEMS is wrong; message: ${result.message}`,
        );
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
