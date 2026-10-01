import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupUser,
  dbDescribe,
  getPrisma,
  seedCompany,
  seedUser,
  testSuffix,
} from "./helpers/db-acceptance-harness";
import { finalizePlanBCompanyVault } from "../lib/plan-b-vault-finalize";

const EXPERT_COUNT = 28;
const PROJECT_COUNT = 114;
const EXPERT_SHA = "a".repeat(64);
const PROJECT_SHA = "b".repeat(64);

dbDescribe("Plan B Company Vault finalization", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let primaryUserId = "";
  let primaryCompanyId = "";
  let secondUserId = "";
  let secondCompanyId = "";
  let expertDocumentId = "";
  let projectDocumentId = "";

  const experts = Array.from({ length: EXPERT_COUNT }, (_, index) => ({
    fullName: `Plan B Expert ${String(index + 1).padStart(2, "0")} ${suffix}`,
    title: "Senior Engineer",
    yearsExperience: 10 + (index % 15),
    disciplines: ["Engineering"],
    sectors: ["Infrastructure"],
    certifications: [],
    sourceDocument: index % 2 === 0 ? "WRONG-NAME.pdf" : "EXPERT CVS.PDF",
    sourceSha256: index % 2 === 0 ? EXPERT_SHA : null,
  }));

  const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => ({
    name: `Plan B Project ${String(index + 1).padStart(3, "0")} ${suffix}`,
    clientName: "Public Infrastructure Client",
    country: "Ethiopia",
    sector: "Infrastructure",
    serviceAreas: ["Design", "Supervision"],
    sourceDocument: index % 2 === 0 ? "WRONG-PROJECT-NAME.pdf" : "project references.pdf",
    sourceSha256: index % 2 === 0 ? PROJECT_SHA : null,
  }));

  before(async () => {
    const primary = await seedUser(prisma, `${suffix}-primary`, "PROPOSAL_MANAGER");
    primaryUserId = primary.id;
    primaryCompanyId = (await seedCompany(prisma, primaryUserId, `${suffix}-primary`)).id;

    const second = await seedUser(prisma, `${suffix}-second`, "PROPOSAL_MANAGER");
    secondUserId = second.id;
    secondCompanyId = (await seedCompany(prisma, secondUserId, `${suffix}-second`)).id;

    const expertSourceText = experts
      .map((expert) => `${expert.fullName} Senior Engineer Engineering Infrastructure ${expert.yearsExperience} years`)
      .join("\n");
    const projectSourceText = projects
      .map((project) => `${project.name} Public Infrastructure Client Ethiopia Infrastructure Design Supervision`)
      .join("\n");

    const expertDocument = await prisma.companyDocument.create({
      data: {
        companyId: primaryCompanyId,
        fileName: "expert-cvs.pdf",
        originalFileName: "Expert CVs.pdf",
        mimeType: "application/pdf",
        size: Buffer.byteLength(expertSourceText),
        storagePath: `tests/${suffix}/expert-cvs.pdf`,
        contentSha256: EXPERT_SHA,
        contentByteLength: Buffer.byteLength(expertSourceText),
        contentMimeType: "application/pdf",
        detectedFormat: "PDF",
        integrityStatus: "VERIFIED",
        integrityVerifiedAt: new Date(),
        category: "EXPERT_CV",
        extractedText: expertSourceText,
        aiExtractionStatus: "EXTRACTED",
        aiExtractedAt: new Date(),
      },
    });
    expertDocumentId = expertDocument.id;

    const projectDocument = await prisma.companyDocument.create({
      data: {
        companyId: primaryCompanyId,
        fileName: "project-references.pdf",
        originalFileName: "Project References.pdf",
        mimeType: "application/pdf",
        size: Buffer.byteLength(projectSourceText),
        storagePath: `tests/${suffix}/project-references.pdf`,
        contentSha256: PROJECT_SHA,
        contentByteLength: Buffer.byteLength(projectSourceText),
        contentMimeType: "application/pdf",
        detectedFormat: "PDF",
        integrityStatus: "VERIFIED",
        integrityVerifiedAt: new Date(),
        category: "PROJECT_REFERENCE",
        extractedText: projectSourceText,
        aiExtractionStatus: "EXTRACTED",
        aiExtractedAt: new Date(),
      },
    });
    projectDocumentId = projectDocument.id;

    await prisma.planBStaging.createMany({
      data: [
        {
          companyId: primaryCompanyId,
          originalFileName: "Expert CVs.pdf",
          sourceType: "Expert CV library",
          normalizedCategory: "EXPERT_CV",
          parsedExperts: EXPERT_COUNT,
          suppliedSha256: EXPERT_SHA,
        },
        {
          companyId: primaryCompanyId,
          originalFileName: "Project References.pdf",
          sourceType: "Project portfolio",
          normalizedCategory: "PROJECT_REFERENCE",
          parsedProjects: PROJECT_COUNT,
          suppliedSha256: PROJECT_SHA,
        },
      ],
    });

    await prisma.expert.createMany({
      data: experts.map((expert) => ({
        companyId: primaryCompanyId,
        fullName: expert.fullName,
        title: expert.title,
        yearsExperience: expert.yearsExperience,
        disciplines: JSON.stringify(expert.disciplines),
        sectors: JSON.stringify(expert.sectors),
        certifications: JSON.stringify(expert.certifications),
        profile: `${expert.fullName} source profile`,
        isActive: false,
        trustLevel: "AI_DRAFT",
        deletedAt: new Date(),
        deletedBy: primaryUserId,
      })),
    });

    await prisma.project.createMany({
      data: projects.map((project) => ({
        companyId: primaryCompanyId,
        name: project.name,
        clientName: project.clientName,
        country: project.country,
        sector: project.sector,
        serviceAreas: JSON.stringify(project.serviceAreas),
        summary: `${project.name} source summary`,
        trustLevel: "AI_DRAFT",
        deletedAt: new Date(),
        deletedBy: primaryUserId,
      })),
    });

    // Same normalized names in another tenant must remain untouched.
    await prisma.expert.create({
      data: {
        companyId: secondCompanyId,
        fullName: experts[0].fullName,
        title: "Other Tenant Expert",
        trustLevel: "AI_DRAFT",
        isActive: false,
        deletedAt: new Date(),
        deletedBy: secondUserId,
      },
    });
    await prisma.project.create({
      data: {
        companyId: secondCompanyId,
        name: projects[0].name,
        clientName: "Other Tenant Client",
        trustLevel: "AI_DRAFT",
        deletedAt: new Date(),
        deletedBy: secondUserId,
      },
    });
  });

  after(async () => {
    await cleanupUser(prisma, primaryUserId);
    await cleanupUser(prisma, secondUserId);
  });

  it("restores 28 experts and 114 projects, links official files, and creates no fake CompanyDocuments", async () => {
    const companyDocumentCountBefore = await prisma.companyDocument.count({
      where: { companyId: primaryCompanyId },
    });

    const result = await finalizePlanBCompanyVault(prisma, {
      userId: primaryUserId,
      companyId: primaryCompanyId,
      payload: {
        sourceDocuments: [
          { fileName: "Expert CVs.pdf", sha256: EXPERT_SHA },
          { fileName: "Project References.pdf", sha256: PROJECT_SHA },
        ],
        experts,
        projects,
      },
    });

    assert.deepEqual(result.restored, {
      experts: EXPERT_COUNT,
      projects: PROJECT_COUNT,
      total: EXPERT_COUNT + PROJECT_COUNT,
    });
    assert.deepEqual(result.activeCounts, {
      experts: EXPERT_COUNT,
      projects: PROJECT_COUNT,
    });
    assert.equal(result.linked.experts, EXPERT_COUNT);
    assert.equal(result.linked.projects, PROJECT_COUNT);
    assert.equal(result.sourceVerified.experts, EXPERT_COUNT);
    assert.equal(result.sourceVerified.projects, PROJECT_COUNT);
    assert.equal(result.sourceDescriptorsStaged, 2);
    assert.equal(result.sourceBlocker, null);
    assert.equal(result.verificationBlocker, null);

    const [activeExperts, activeProjects, companyDocumentCountAfter] = await Promise.all([
      prisma.expert.findMany({
        where: { companyId: primaryCompanyId, deletedAt: null, isActive: true },
        select: { sourceDocumentId: true, trustLevel: true, deletedBy: true },
      }),
      prisma.project.findMany({
        where: { companyId: primaryCompanyId, deletedAt: null },
        select: { sourceDocumentId: true, trustLevel: true, deletedBy: true },
      }),
      prisma.companyDocument.count({ where: { companyId: primaryCompanyId } }),
    ]);

    assert.equal(activeExperts.length, EXPERT_COUNT);
    assert.equal(activeProjects.length, PROJECT_COUNT);
    assert.ok(activeExperts.every((row) => row.sourceDocumentId === expertDocumentId));
    assert.ok(activeProjects.every((row) => row.sourceDocumentId === projectDocumentId));
    assert.ok(activeExperts.every((row) => row.trustLevel === "SOURCE_VERIFIED" && row.deletedBy === null));
    assert.ok(activeProjects.every((row) => row.trustLevel === "SOURCE_VERIFIED" && row.deletedBy === null));
    assert.equal(companyDocumentCountBefore, 2);
    assert.equal(companyDocumentCountAfter, 2, "Plan B finalization must not create CompanyDocument rows");
  });

  it("does not restore or link matching records owned by another tenant", async () => {
    const [otherExpert, otherProject] = await Promise.all([
      prisma.expert.findFirstOrThrow({
        where: { companyId: secondCompanyId, fullName: experts[0].fullName },
        select: { deletedAt: true, sourceDocumentId: true, trustLevel: true },
      }),
      prisma.project.findFirstOrThrow({
        where: { companyId: secondCompanyId, name: projects[0].name },
        select: { deletedAt: true, sourceDocumentId: true, trustLevel: true },
      }),
    ]);

    assert.ok(otherExpert.deletedAt instanceof Date);
    assert.equal(otherExpert.sourceDocumentId, null);
    assert.equal(otherExpert.trustLevel, "AI_DRAFT");
    assert.ok(otherProject.deletedAt instanceof Date);
    assert.equal(otherProject.sourceDocumentId, null);
    assert.equal(otherProject.trustLevel, "AI_DRAFT");
  });
});
