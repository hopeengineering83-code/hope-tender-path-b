import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";

const RUN = process.env.RUN_DB_INTEGRATION === "true";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("Company Vault strongest-source repair — real PostgreSQL", { skip: !RUN }, () => {
  let userId = "";
  let companyId = "";
  let profileId = "";
  let cvId = "";
  let projectReferenceId = "";
  let expertId = "";
  let projectId = "";

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random()}`;
    const user = await prisma.user.create({ data: { email: `strongest-source-${nonce}@example.test`, passwordHash: "test" } });
    userId = user.id;
    companyId = (await prisma.company.create({ data: { userId, name: `Strongest Source Company ${nonce}` } })).id;

    const profileText = [
      "COMPANY PROFILE AND SUMMARY OF KEY PERSONNEL AND PROJECT EXPERIENCE",
      "Dawit Bekele is listed as company personnel.",
      "Project Reference 1 is listed as previous experience.",
      "This summary intentionally proves identity only and not the richer structured fields.",
    ].join("\n");
    const cvText = [
      "DETAILED CURRICULUM VITAE AND PROFESSIONAL PERSONNEL",
      "BEKELE, Dawit (MSc) — Senior Engineer — proposed position Team Leader",
      "Detailed professional history and assignment record for the named expert.",
    ].join("\n");
    const projectText = [
      "COMPANY PROJECT REFERENCES AND CONTRACT EXPERIENCE",
      "Project Reference 1 — Ethiopia — similar assignment",
      "Detailed assignment record for the named project reference.",
    ].join("\n");

    const profile = await prisma.companyDocument.create({ data: {
      companyId, fileName: "company-profile.txt", originalFileName: "company-profile.txt", category: "COMPANY_PROFILE", mimeType: "text/plain",
      size: Buffer.byteLength(profileText), contentByteLength: Buffer.byteLength(profileText), contentSha256: hash(profileText), integrityStatus: "VERIFIED", extractedText: profileText,
    } });
    const cv = await prisma.companyDocument.create({ data: {
      companyId, fileName: "detailed-cvs.txt", originalFileName: "detailed-cvs.txt", category: "EXPERT_CV", mimeType: "text/plain",
      size: Buffer.byteLength(cvText), contentByteLength: Buffer.byteLength(cvText), contentSha256: hash(cvText), integrityStatus: "VERIFIED", extractedText: cvText,
    } });
    const reference = await prisma.companyDocument.create({ data: {
      companyId, fileName: "company-projects.txt", originalFileName: "company-projects.txt", category: "PROJECT_REFERENCE", mimeType: "text/plain",
      size: Buffer.byteLength(projectText), contentByteLength: Buffer.byteLength(projectText), contentSha256: hash(projectText), integrityStatus: "VERIFIED", extractedText: projectText,
    } });
    profileId = profile.id;
    cvId = cv.id;
    projectReferenceId = reference.id;

    // Deliberately reproduce an older/importer mistake: both drafts arrive
    // already bound to the shallow Company Profile. The preflight must not
    // treat that historical sourceDocumentId as stronger than current evidence.
    expertId = (await prisma.expert.create({ data: {
      companyId,
      fullName: "Dawit Bekele",
      title: "Senior Engineer",
      trustLevel: "AI_DRAFT",
      sourceDocumentId: profileId,
    } })).id;
    projectId = (await prisma.project.create({ data: {
      companyId,
      name: "Project Reference 1",
      country: "Ethiopia",
      trustLevel: "REGEX_DRAFT",
      sourceDocumentId: profileId,
    } })).id;
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rebinds weak historical sources to the strongest dedicated owned evidence and source-verifies automatically", async () => {
    const result = await prepareCompanyVaultForEngine(userId);
    assert.equal(result?.sourceRemap.expertsLinked, 1);
    assert.equal(result?.sourceRemap.projectsLinked, 1);
    assert.equal(result?.sourceVerification.expertsVerified, 1);
    assert.equal(result?.sourceVerification.projectsVerified, 1);

    const [expert, project] = await Promise.all([
      prisma.expert.findUniqueOrThrow({ where: { id: expertId } }),
      prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
    ]);
    assert.notEqual(expert.sourceDocumentId, profileId);
    assert.notEqual(project.sourceDocumentId, profileId);
    assert.equal(expert.sourceDocumentId, cvId);
    assert.equal(project.sourceDocumentId, projectReferenceId);
    assert.equal(expert.trustLevel, "SOURCE_VERIFIED");
    assert.equal(project.trustLevel, "SOURCE_VERIFIED");
    assert.equal(expert.reviewedBy, null);
    assert.equal(project.reviewedBy, null);
  });
});