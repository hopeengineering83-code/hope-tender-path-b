import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";
import { canUseVaultRecordField, VAULT_REVIEW_CONSUMER_SELECT } from "../lib/vault-review-provenance";

const RUN = process.env.RUN_DB_INTEGRATION === "true";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("Company Vault zero-bureaucracy reconciliation — real PostgreSQL", { skip: !RUN }, () => {
  let userId = "";
  let companyId = "";
  let otherUserId = "";
  let otherCompanyId = "";

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random()}`;
    const user = await prisma.user.create({ data: { email: `zero-bureaucracy-${nonce}@example.test`, passwordHash: "test" } });
    userId = user.id;
    companyId = (await prisma.company.create({ data: { userId, name: `Evidence Company ${nonce}` } })).id;

    const otherUser = await prisma.user.create({ data: { email: `zero-bureaucracy-other-${nonce}@example.test`, passwordHash: "test" } });
    otherUserId = otherUser.id;
    otherCompanyId = (await prisma.company.create({ data: { userId: otherUserId, name: `Other Evidence Company ${nonce}` } })).id;

    const expertLines = Array.from({ length: 28 }, (_, index) => index === 0
      ? "BEKELE, Dawit (MSc) — Senior Engineer — proposed position Team Leader"
      : `Expert ${index + 1} Person — Senior Engineer — professional team member`);
    const projectLines = Array.from({ length: 112 }, (_, index) => `Project Reference ${index + 1} — Ethiopia — similar assignment`);
    const documents = [
      ["detailed-cvs.txt", "EXPERT_CV", `DETAILED CURRICULUM VITAE AND PROFESSIONAL PERSONNEL\n${expertLines.join("\n")}`],
      ["company-projects.txt", "PROJECT_REFERENCE", `COMPANY PROJECT REFERENCES AND CONTRACT EXPERIENCE\n${projectLines.join("\n")}`],
      ["company-vault.txt", "OTHER", "COMPANY VAULT SUMMARY. Dawit Bekele is company personnel. Project Reference 1 is listed in the portfolio. This authenticated summary intentionally carries only brief identities."],
      ["company-profile.txt", "COMPANY_PROFILE", "COMPANY PROFILE. Dawit Bekele is a professional team member. Project Reference 1 is prior experience. This authenticated profile intentionally contains summary identities only."],
    ] as const;
    for (const [fileName, category, extractedText] of documents) {
      await prisma.companyDocument.create({ data: {
        companyId, fileName, originalFileName: fileName, category, mimeType: "text/plain",
        size: Buffer.byteLength(extractedText), contentByteLength: Buffer.byteLength(extractedText),
        contentSha256: hash(extractedText), integrityStatus: "VERIFIED", extractedText,
      } });
    }
    await prisma.expert.createMany({ data: Array.from({ length: 28 }, (_, index) => ({
      companyId, fullName: index === 0 ? "Dawit Bekele" : `Expert ${index + 1} Person`,
      title: "Senior Engineer", yearsExperience: 99, trustLevel: index % 2 ? "AI_DRAFT" : "REGEX_DRAFT",
    })) });
    await prisma.project.createMany({ data: Array.from({ length: 112 }, (_, index) => ({
      companyId, name: `Project Reference ${index + 1}`, country: "Ethiopia",
      clientName: "Unsupported inferred client", trustLevel: index % 2 ? "AI_DRAFT" : "REGEX_DRAFT",
    })) });

    // Strong tenant-isolation falsification: the second tenant deliberately
    // uses the SAME filenames and field values that Tenant A's first Expert
    // and Project expose, but persists different authenticated bytes. If the
    // candidate-document query ever loses its companyId boundary, these
    // foreign documents become equally authoritative and the Tenant A preflight
    // will either become ambiguous or link foreign evidence, causing the test
    // below to fail instead of silently passing.
    const otherCv = [
      "DETAILED CURRICULUM VITAE AND PROFESSIONAL PERSONNEL",
      "BEKELE, Dawit (MSc) — Senior Engineer — proposed position Team Leader",
      "Tenant B authenticated byte marker: hydrogeology division.",
    ].join("\n");
    const otherProjects = [
      "COMPANY PROJECT REFERENCES AND CONTRACT EXPERIENCE",
      "Project Reference 1 — Ethiopia — similar assignment",
      "Tenant B authenticated byte marker: water resources portfolio.",
    ].join("\n");
    for (const [fileName, category, extractedText] of [
      ["detailed-cvs.txt", "EXPERT_CV", otherCv],
      ["company-projects.txt", "PROJECT_REFERENCE", otherProjects],
    ] as const) {
      await prisma.companyDocument.create({ data: {
        companyId: otherCompanyId, fileName, originalFileName: fileName, category, mimeType: "text/plain",
        size: Buffer.byteLength(extractedText), contentByteLength: Buffer.byteLength(extractedText),
        contentSha256: hash(extractedText), integrityStatus: "VERIFIED", extractedText,
      } });
    }
    await prisma.expert.create({ data: {
      companyId: otherCompanyId, fullName: "Dawit Bekele", title: "Senior Engineer", yearsExperience: 99, trustLevel: "AI_DRAFT",
    } });
    await prisma.project.create({ data: {
      companyId: otherCompanyId, name: "Project Reference 1", country: "Ethiopia",
      clientName: "Unsupported inferred client", trustLevel: "REGEX_DRAFT",
    } });
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.expert.deleteMany({ where: { companyId: otherCompanyId } });
    await prisma.project.deleteMany({ where: { companyId: otherCompanyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId: otherCompanyId } });
    await prisma.company.deleteMany({ where: { id: otherCompanyId } });
    await prisma.user.deleteMany({ where: { id: otherUserId } });
  });

  it("repairs and source-verifies 28 experts and 112 projects with no human approval and no cross-tenant evidence use", async () => {
    const result = await prepareCompanyVaultForEngine(userId);
    assert.equal(result?.sourceRemap.expertsLinked, 28);
    assert.equal(result?.sourceRemap.projectsLinked, 112);
    assert.equal(result?.sourceVerification.expertsVerified, 28);
    assert.equal(result?.sourceVerification.projectsVerified, 112);
    assert.deepEqual(result?.sourceRemap.blockers, [], "every uniquely provable record must reconcile without a human action");

    const [experts, projects] = await Promise.all([
      prisma.expert.findMany({ where: { companyId }, select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT }),
      prisma.project.findMany({ where: { companyId }, select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT }),
    ]);
    assert.equal(experts.filter((record) => record.trustLevel === "SOURCE_VERIFIED").length, 28);
    assert.equal(projects.filter((record) => record.trustLevel === "SOURCE_VERIFIED").length, 112);
    assert.ok(experts.every((record) => record.reviewedBy === null && record.reviewedAt === null));
    assert.ok(projects.every((record) => record.reviewedBy === null && record.reviewedAt === null));
    assert.equal(canUseVaultRecordField(experts[0], "yearsExperience"), false);
    assert.equal(canUseVaultRecordField(projects[0], "clientName"), false);
    assert.ok(experts.every((record) => /detailed-cvs/.test(record.sourceDocument?.fileName ?? "")),
      "one authoritative CV bundle may source all 28 experts");
    assert.ok(projects.every((record) => /company-projects/.test(record.sourceDocument?.fileName ?? "")),
      "one authoritative project-reference bundle may source all 112 projects");
    assert.ok(experts.every((record) => record.sourceDocument?.companyId === companyId));
    assert.ok(projects.every((record) => record.sourceDocument?.companyId === companyId));

    const [otherExperts, otherProjects] = await Promise.all([
      prisma.expert.findMany({ where: { companyId: otherCompanyId }, select: { trustLevel: true, sourceDocumentId: true } }),
      prisma.project.findMany({ where: { companyId: otherCompanyId }, select: { trustLevel: true, sourceDocumentId: true } }),
    ]);
    assert.deepEqual(otherExperts, [{ trustLevel: "AI_DRAFT", sourceDocumentId: null }]);
    assert.deepEqual(otherProjects, [{ trustLevel: "REGEX_DRAFT", sourceDocumentId: null }]);
  });

  it("fails closed when two owned CV sources have indistinguishable authority", async () => {
    const text = [
      "CURRICULUM VITAE AND DETAILED PROFESSIONAL PERSONNEL RECORD",
      "Tie Case Engineer — Senior Engineer",
      "Proposed position: Senior Engineer; professional team assignment and detailed experience record.",
    ].join("\n");
    const documents = await Promise.all(["tie-cv-a.txt", "tie-cv-b.txt"].map((fileName) =>
      prisma.companyDocument.create({ data: {
        companyId, fileName, originalFileName: fileName, category: "EXPERT_CV", mimeType: "text/plain",
        size: Buffer.byteLength(text), contentByteLength: Buffer.byteLength(text),
        contentSha256: hash(text), integrityStatus: "VERIFIED", extractedText: text,
      } }),
    ));
    const expert = await prisma.expert.create({ data: {
      companyId, fullName: "Tie Case Engineer", title: "Senior Engineer", trustLevel: "AI_DRAFT",
    } });

    const result = await prepareCompanyVaultForEngine(userId);
    assert.deepEqual(result?.sourceRemap.blockers, [{
      recordType: "EXPERT",
      recordId: expert.id,
      reason: "AMBIGUOUS_SOURCE_MATCH",
    }]);
    const unchanged = await prisma.expert.findUniqueOrThrow({ where: { id: expert.id } });
    assert.equal(unchanged.sourceDocumentId, null);
    assert.equal(unchanged.trustLevel, "AI_DRAFT");
    assert.ok(documents.every((document) => document.companyId === companyId));
  });
});