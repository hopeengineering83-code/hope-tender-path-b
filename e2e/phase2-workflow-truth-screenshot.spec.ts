import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";

import {
  cleanupTender,
  cleanupUser,
  seedComplianceRow,
  seedRequirement,
  seedTender,
  seedTenderFile,
} from "../tests/helpers/db-acceptance-harness";
import {
  buildSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
} from "../lib/vault-review-provenance";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "../lib/engine/tender-analysis-content";

const prisma = new PrismaClient();
const SUFFIX = "phase2-rendered-2-of-4";
const QUOTES = [
  "The Contractor shall provide a licensed Water Engineer with 10 years experience.",
  "The Contractor shall provide a licensed Structural Engineer with 12 years experience.",
  "The Bidder shall demonstrate three completed water supply projects.",
  "The Bidder shall demonstrate two completed sanitation projects.",
];
const FILLER = "The Employer requires a complete technical and financial submission supported only by genuine source evidence. ";
const SOURCE_TEXT = [
  "SECTION 1 - INSTRUCTIONS TO BIDDERS",
  FILLER.repeat(15),
  "SECTION 2 - MANDATORY REQUIREMENTS",
  ...QUOTES,
  "Submission shall be by email to submit@example.com before the stated deadline.",
  FILLER.repeat(15),
].join("\n");

test.describe("Phase 2 rendered 2/4 evidence workflow truth", () => {
  let tenderId = "";
  let userId = "";
  const email = `phase2-rendered-${Date.now()}@example.test`;
  const password = "Phase2-Rendered-Workflow-A9!secure";
  const companyRecordIds: { experts: string[]; projects: string[]; documents: string[] } = {
    experts: [], projects: [], documents: [],
  };

  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: "ADMIN",
        name: "Phase 2 Rendered Fixture",
      },
      select: { id: true },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: {
        userId: user.id,
        name: "Phase 2 Rendered Fixture Company",
        legalName: "Phase 2 Rendered Fixture Company",
        country: "ET",
        sectors: "Engineering",
        setupCompletedAt: new Date(),
      },
      select: { id: true },
    });

    const tender = await seedTender(prisma, {
      userId: user.id,
      suffix: SUFFIX,
      title: "Phase 2 — Engine Complete, Source Evidence Required",
      status: "MATCHED",
      stage: "COMPLIANCE",
      exactFileNaming: JSON.stringify(["Technical Proposal.docx", "Financial Proposal.docx"]),
    });
    tenderId = tender.id;
    const file = await seedTenderFile(prisma, {
      tenderId,
      suffix: SUFFIX,
      extractedText: SOURCE_TEXT,
      extractionScore: 95,
      totalPages: 2,
      extractedPages: 2,
    });
    await prisma.tenderFile.update({
      where: { id: file.id },
      data: {
        pageStatusJson: JSON.stringify([
          { page: 1, status: "OK", charCount: 2000, hasContent: true },
          { page: 2, status: "OK", charCount: 2000, hasContent: true },
        ]),
      },
    });

    const requirements = [];
    for (let index = 0; index < QUOTES.length; index += 1) {
      requirements.push(await seedRequirement(prisma, {
        tenderId,
        title: `Mandatory requirement ${index + 1}`,
        description: QUOTES[index],
        requirementType: index < 2 ? "EXPERT" : "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
        sourceTenderFileId: file.id,
        sourcePageNumber: 1,
        sourceExactQuote: QUOTES[index],
        sourceConfidence: 95,
      }));
    }
    for (let index = 0; index < requirements.length; index += 1) {
      await seedComplianceRow(prisma, {
        tenderId,
        requirementId: requirements[index].id,
        supportLevel: index < 2 ? "FULL" : "PARTIAL",
        evidenceType: index < 2 ? "EXPERT" : "PROJECT",
      });
    }

    const seedVaultDocument = async (name: string, text: string, category: string) => {
      const document = await prisma.companyDocument.create({
        data: {
          companyId: company.id,
          fileName: name,
          originalFileName: name,
          mimeType: "application/pdf",
          size: Buffer.byteLength(text),
          category,
          extractedText: text,
          contentSha256: createHash("sha256").update(text).digest("hex"),
          contentByteLength: Buffer.byteLength(text),
          integrityStatus: "VERIFIED",
          metadata: JSON.stringify({ extractionRevision: 1 }),
        },
      });
      companyRecordIds.documents.push(document.id);
      return document;
    };

    for (const spec of [
      { fullName: "Amina Phase Two", title: "Water Engineer", yearsExperience: 12, disciplines: ["Water Engineering"] },
      { fullName: "Bekele Phase Two", title: "Structural Engineer", yearsExperience: 14, disciplines: ["Structural Engineering"] },
    ]) {
      const text = `CURRICULUM VITAE\nName: ${spec.fullName}\nTitle: ${spec.title}\n${spec.fullName} has ${spec.yearsExperience} years of ${spec.disciplines[0]} experience.`;
      const document = await seedVaultDocument(`${spec.fullName}.pdf`, text, "CV");
      const fields = { ...spec, disciplines: JSON.stringify(spec.disciplines) };
      const provenance = buildSourceVerificationProvenance({
        recordType: "EXPERT",
        sourceDocument: document,
        fields: expertReviewFields(fields),
        verificationMethod: "HYBRID",
      });
      if (!provenance.ok) throw new Error("Phase 2 expert provenance fixture is invalid");
      const expert = await prisma.expert.create({
        data: {
          companyId: company.id,
          ...fields,
          trustLevel: "SOURCE_VERIFIED",
          reviewNotes: provenance.serialized,
          sourceDocumentId: document.id,
        },
      });
      companyRecordIds.experts.push(expert.id);
      await prisma.tenderExpertMatch.create({
        data: { tenderId, expertId: expert.id, score: 0.88, rationale: "Source-verified discipline match.", isSelected: true },
      });
    }

    for (const spec of [
      { name: "Phase Two Water Project", clientName: "Water Utility", country: "ET", sector: "Water" },
      { name: "Phase Two Sanitation Project", clientName: "Municipality", country: "ET", sector: "Sanitation" },
    ]) {
      const text = `PROJECT COMPLETION CERTIFICATE\nProject: ${spec.name}\nClient: ${spec.clientName}\nCountry: ${spec.country}\nSector: ${spec.sector}\nThe works were completed and accepted.`;
      const document = await seedVaultDocument(`${spec.name}.pdf`, text, "PROJECT");
      const provenance = buildSourceVerificationProvenance({
        recordType: "PROJECT",
        sourceDocument: document,
        fields: projectReviewFields(spec),
        verificationMethod: "HYBRID",
      });
      if (!provenance.ok) throw new Error("Phase 2 project provenance fixture is invalid");
      const project = await prisma.project.create({
        data: {
          companyId: company.id,
          ...spec,
          trustLevel: "SOURCE_VERIFIED",
          reviewNotes: provenance.serialized,
          sourceDocumentId: document.id,
        },
      });
      companyRecordIds.projects.push(project.id);
      await prisma.tenderProjectMatch.create({
        data: { tenderId, projectId: project.id, score: 0.86, rationale: "Source-verified sector match.", isSelected: true },
      });
    }

    const tenderRow = await prisma.tender.findUniqueOrThrow({
      where: { id: tenderId },
      select: { title: true, description: true, intakeSummary: true },
    });
    const analysisInputHash = computeAnalysisContentHash(buildTenderAnalysisContent({
      ...tenderRow,
      files: [{ id: file.id, extractedText: SOURCE_TEXT, originalFileName: `Tender Document ${SUFFIX}.pdf` }],
    } as never));
    await prisma.aiJob.create({
      data: {
        userId: user.id,
        tenderId,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash,
        promotedAt: new Date(),
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(Date.now() - 30_000),
      },
    });

  });

  test.afterAll(async () => {
    if (tenderId) await cleanupTender(prisma, tenderId);
    await prisma.expert.deleteMany({ where: { id: { in: companyRecordIds.experts } } });
    await prisma.project.deleteMany({ where: { id: { in: companyRecordIds.projects } } });
    await prisma.companyDocument.deleteMany({ where: { id: { in: companyRecordIds.documents } } });
    if (userId) await cleanupUser(prisma, userId);
    await prisma.$disconnect();
  });

  test("all rendered panels agree that Engine completed and source evidence is required", async ({ page }, testInfo) => {
    await page.goto("/login");
    const login = await page.context().request.post("/api/auth/login", { data: { email, password } });
    expect(login.status(), await login.text()).toBe(200);
    const sessionHeader = login.headersArray().find(
      (header) => header.name.toLowerCase() === "set-cookie" && header.value.startsWith("hope_session="),
    );
    expect(sessionHeader, "fixture login must return a session cookie").toBeTruthy();
    const sessionValue = sessionHeader!.value.split(";")[0].split("=").slice(1).join("=");
    await page.context().addCookies([{
      name: "hope_session",
      value: sessionValue,
      url: new URL(page.url()).origin,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }]);

    // Exercise the real server-side automatic Build Plan service instead of
    // importing server modules through Playwright's CommonJS transform.
    const planResponse = await page.request.post(`/api/tenders/${tenderId}/build-plan`);
    const planBody = await planResponse.text();
    expect(planResponse.status(), planBody).toBe(200);
    const engineReadiness = await page.request.get(`/api/tenders/${tenderId}/engine-readiness`);
    const engineText = await engineReadiness.text();
    expect(engineReadiness.status(), engineText).toBe(200);
    const engineBody = JSON.parse(engineText) as { sourceRevision?: string | null };
    expect(engineBody.sourceRevision, "fixture requires the authoritative current Engine revision").toBeTruthy();
    await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "ENGINE_RUN",
        status: "SUCCEEDED",
        analysisInputHash: engineBody.sourceRevision!,
        startedAt: new Date(Date.now() - 20_000),
        finishedAt: new Date(Date.now() - 10_000),
      },
    });
    await page.goto(`/dashboard/tenders/${tenderId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Source evidence required" })).toBeVisible({ timeout: 30_000 });

    for (const stage of ["Analysis and engine", "Evidence and matching", "Generation and review"]) {
      await page.getByText(stage, { exact: true }).click();
    }

    await expect(page.getByText("AI Analysis is complete and current.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const matchingStatus = page.getByText(/Engine complete\. Downstream processing is paused — source evidence required\./);
    await expect(matchingStatus).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Blocked — source evidence required", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Engine complete. Downstream processing continues automatically.", { exact: true })).toHaveCount(0);

    const screenshot = await page.screenshot({
      path: "browser-results/phase2-engine-complete-source-evidence-required.png",
      fullPage: true,
      animations: "disabled",
    });
    await testInfo.attach("phase2-engine-complete-source-evidence-required", {
      body: screenshot,
      contentType: "image/png",
    });
  });
});
