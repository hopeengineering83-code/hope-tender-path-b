import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupTender,
  cleanupUser,
  dbDescribe,
  getPrisma,
  seedTender,
  seedTenderFile,
  seedUser,
  testSuffix,
} from "./helpers/db-acceptance-harness";
import { reconcileTitleSourceEvidence } from "../lib/engine/automatic-build-plan";
import { publicJobFailureMessage } from "../lib/prisma-schema-compatibility";

const prisma = getPrisma();
const created: Array<{ tenderId: string; userId: string }> = [];

dbDescribe("Preview 03b9c928 title provenance repair", () => {
  after(async () => {
    for (const row of created) {
      await cleanupTender(prisma, row.tenderId);
      await cleanupUser(prisma, row.userId);
    }
  });

  it("re-grounds a Pharo-shaped title from real page boundaries instead of relaxing validation", async () => {
    const suffix = testSuffix();
    const user = await seedUser(prisma, suffix);
    const title = "Supply and Installation of Laboratory Equipment for Pharo Secondary School";
    const tender = await seedTender(prisma, { userId: user.id, suffix, title });
    const file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      totalPages: 3,
      extractedPages: 3,
      extractedText: `[Page 1]\nInvitation to Bid\n[Page 2]\nTender Title: ${title}\nReference PHARO/LAB/2026/08\n[Page 3]\nEight requirements including six mandatory requirements.`,
    });
    const company = await prisma.company.create({
      data: { userId: user.id, name: `Pharo Fixture Company ${suffix}`, sectors: "[]" },
    });
    const expert = await prisma.expert.create({
      data: { companyId: company.id, fullName: "Fixture Laboratory Engineer", trustLevel: "REGEX_DRAFT" },
    });
    const project = await prisma.project.create({
      data: { companyId: company.id, name: "Fixture Laboratory Supply Project", trustLevel: "REGEX_DRAFT" },
    });
    await prisma.tenderExpertMatch.create({
      data: { tenderId: tender.id, expertId: expert.id, score: 88, isSelected: true, rationale: "Revision-bound fixture match" },
    });
    await prisma.tenderProjectMatch.create({
      data: { tenderId: tender.id, projectId: project.id, score: 86, isSelected: true, rationale: "Revision-bound fixture match" },
    });
    for (let index = 1; index <= 8; index += 1) {
      await prisma.tenderRequirement.create({
        data: {
          tenderId: tender.id,
          title: `Pharo requirement ${index}`,
          description: `Source-grounded fixture requirement ${index}`,
          requirementType: index <= 6 ? "MANDATORY" : "TECHNICAL",
          priority: index <= 6 ? "MANDATORY" : "OPTIONAL",
          sourceTenderFileId: file.id,
          sourcePageNumber: 3,
          sourceExactQuote: "Eight requirements including six mandatory requirements.",
        },
      });
    }
    created.push({ tenderId: tender.id, userId: user.id });
    await prisma.tender.update({
      where: { id: tender.id },
      data: {
        titleSourceFileId: file.id,
        titleSourcePage: 99,
        titleSourceQuote: `Tender Title: ${title}`,
      },
    });

    const result = await reconcileTitleSourceEvidence(prisma, tender.id, user.id);
    assert.deepEqual(result, { repaired: true, proven: true });
    const repaired = await prisma.tender.findUniqueOrThrow({
      where: { id: tender.id },
      select: { titleSourceFileId: true, titleSourcePage: true, titleSourceQuote: true },
    });
    assert.equal(repaired.titleSourceFileId, file.id);
    assert.equal(repaired.titleSourcePage, 2);
    assert.match(repaired.titleSourceQuote ?? "", /Pharo Secondary School/);
    const titleLedger = await prisma.tenderFactsLedger.findUniqueOrThrow({
      where: { tenderId_semanticKey: { tenderId: tender.id, semanticKey: "title" } },
      select: { sourceFileId: true, sourcePage: true, sourceQuote: true, authorityState: true },
    });
    assert.equal(titleLedger.sourceFileId, file.id);
    assert.equal(titleLedger.sourcePage, 2);
    assert.match(titleLedger.sourceQuote ?? "", /Pharo Secondary School/);
    assert.match(titleLedger.authorityState, /^SOURCE_GROUNDED_/);
    const fixtureState = await prisma.tender.findUniqueOrThrow({
      where: { id: tender.id },
      select: {
        requirements: { select: { priority: true } },
        expertMatches: { where: { isSelected: true }, select: { id: true } },
        projectMatches: { where: { isSelected: true }, select: { id: true } },
        buildPlan: { select: { id: true, status: true } },
      },
    });
    assert.equal(fixtureState.requirements.length, 8);
    assert.equal(fixtureState.requirements.filter((row) => row.priority === "MANDATORY").length, 6);
    assert.equal(fixtureState.expertMatches.length, 1);
    assert.equal(fixtureState.projectMatches.length, 1);
    assert.equal(fixtureState.buildPlan, null);
  });

  it("does not invent a page when neither the quote nor title is provable", async () => {
    const suffix = testSuffix();
    const user = await seedUser(prisma, suffix);
    const tender = await seedTender(prisma, { userId: user.id, suffix, title: "Unprovable Pharo Tender Title" });
    const file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      totalPages: 3,
      extractedPages: 3,
      extractedText: "Boundaryless unrelated extracted content with no tender title.",
    });
    created.push({ tenderId: tender.id, userId: user.id });
    await prisma.tender.update({
      where: { id: tender.id },
      data: { titleSourceFileId: file.id, titleSourcePage: 99, titleSourceQuote: "Unrelated invented quote" },
    });

    const result = await reconcileTitleSourceEvidence(prisma, tender.id, user.id);
    assert.deepEqual(result, { repaired: false, proven: false });
    const unchanged = await prisma.tender.findUniqueOrThrow({ where: { id: tender.id }, select: { titleSourcePage: true } });
    assert.equal(unchanged.titleSourcePage, 99, "strict Build Plan validation must still reject the invalid page");
  });

  it("rejects a contained but unrelated quote and re-proves the actual title", async () => {
    const suffix = testSuffix();
    const user = await seedUser(prisma, suffix);
    const title = "Supply and Installation of Laboratory Equipment for Pharo Secondary School";
    const tender = await seedTender(prisma, { userId: user.id, suffix, title });
    const file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      totalPages: 3,
      extractedPages: 3,
      extractedText: `[Page 1]\nInvitation to Bid\n[Page 2]\nTender Title: ${title}\n[Page 3]\nSubmission requirements.`,
    });
    created.push({ tenderId: tender.id, userId: user.id });
    await prisma.tender.update({
      where: { id: tender.id },
      data: {
        titleSourceFileId: file.id,
        titleSourcePage: 1,
        titleSourceQuote: "Invitation to Bid",
      },
    });

    const result = await reconcileTitleSourceEvidence(prisma, tender.id, user.id);
    assert.deepEqual(result, { repaired: true, proven: true });
    const repaired = await prisma.tender.findUniqueOrThrow({
      where: { id: tender.id },
      select: { titleSourceFileId: true, titleSourcePage: true, titleSourceQuote: true },
    });
    assert.equal(repaired.titleSourceFileId, file.id);
    assert.equal(repaired.titleSourcePage, 2);
    assert.match(repaired.titleSourceQuote ?? "", /Pharo Secondary School/);
    assert.doesNotMatch(repaired.titleSourceQuote ?? "", /^Invitation to Bid$/);
  });
});

describe("generation and workflow panels consume canonical current truth", () => {
  it("pins current Engine failure authority and suppresses a green independent readiness claim", async () => {
    const { readFileSync } = await import("node:fs");
    const canonical = readFileSync("lib/engine/canonical-workflow-decision.ts", "utf8");
    const panel = readFileSync("components/generation-readiness-panel.tsx", "utf8");
    assert.match(canonical, /currentBlockingStage:\s*"ENGINE_RUN_FAILED"/);
    assert.match(canonical, /TITLE_SOURCE_PROVENANCE_INVALID/);
    assert.match(canonical, /steps\.find\(\(step\) => step\.stepName === "build-plan\.blocked"\)/);
    assert.match(panel, /getCanonicalTenderWorkflowDecision/);
    assert.match(panel, /canonicalUpstreamBlocked/);
    assert.match(panel, /fullProposalReady && !canonicalUpstreamBlocked/);
    const exportRoute = readFileSync("app/api/tenders/[id]/export-readiness/route.ts", "utf8");
    assert.match(exportRoute, /canonicalBlocker\.length === 0\s*&& readiness\.ok/);
    assert.match(exportRoute, /visibleTenderBlockerCount = suppressDownstream \? canonicalBlocker\.length/);
  });

  it("makes the latest current-revision Engine attempt authoritative everywhere", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("app/api/tenders/[id]/engine-readiness/route.ts", "utf8");
    assert.match(route, /latestJob\?\.status === "SUCCEEDED"/);
    assert.doesNotMatch(route, /Boolean\(succeededJob\)/);
    assert.match(route, /publicJobFailureMessage\(latestJob\.errorMessage/);
    assert.doesNotMatch(route, /errorMessage:\s*latestJob\.errorMessage\?\.slice/);
  });

  it("surfaces the precise title recovery with a safe reference and no raw exception", () => {
    const message = publicJobFailureMessage(
      new Error("Automatic Build Plan verification blocked (TENDER_FACTS_INVALID): Critical metadata field title has invalid source page."),
      "03b9c928",
    );
    assert.match(message, /^TITLE_SOURCE_PROVENANCE_INVALID:/);
    assert.match(message, /title source file, page, and quote/i);
    assert.match(message, /Reference: 03b9c928/);
    assert.doesNotMatch(message, /Prisma|stack|\/workspace\//i);
  });

  it("updates title scalars and the canonical ledger atomically", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/engine/automatic-build-plan.ts", "utf8");
    assert.match(source, /syncPersistedTenderFactsToLedger\(prisma, tenderId, userId, \{/);
    assert.match(source, /beforeRead: async \(tx\)/);
    assert.match(source, /TITLE_SOURCE_RECONCILIATION_SCOPE_LOST/);
    assert.match(source, /quoteProvesTitle\(tender\.title, tender\.titleSourceQuote\)/);
  });
});
