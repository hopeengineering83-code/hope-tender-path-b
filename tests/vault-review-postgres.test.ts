import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import {
  buildReviewProvenance,
  expertReviewFields,
  isDurablyReviewed,
  projectReviewFields,
  VAULT_REVIEW_CONSUMER_SELECT,
} from "../lib/vault-review-provenance";

const runPostgres = process.env.CI === "true";

describe("PostgreSQL vault provenance enforcement", { skip: !runPostgres }, () => {
  const suffix = randomUUID();
  let userId = "";
  let companyId = "";
  let documentId = "";
  let expertId = "";
  let projectId = "";
  const sourceText = [
    "Curriculum Vitae and Project Reference.",
    "Hana Provenance is a Structural Engineer with 20 years of experience in Buildings.",
    "Hana Provenance holds PMP certification.",
    "Project Alpha was delivered for Client One in Ethiopia in the Buildings sector.",
    "The service area was Structural Engineering and the contract value was 1000 ETB.",
  ].join(" ");
  const sourceHash = createHash("sha256").update(sourceText, "utf8").digest("hex");
  const reviewedAt = new Date("2026-07-15T19:00:00.000Z");

  before(async () => {
    await prismaReady;
    const user = await prisma.user.create({
      data: {
        name: "Vault provenance test",
        email: `vault-provenance-${suffix}@example.test`,
        passwordHash: "not-used",
        role: "ADMIN",
      },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: { name: "Vault provenance test company", userId },
    });
    companyId = company.id;
    const document = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "source.txt",
        originalFileName: "source.txt",
        mimeType: "text/plain",
        size: Buffer.byteLength(sourceText),
        category: "EXPERT_CV",
        extractedText: sourceText,
        aiExtractionStatus: "EXTRACTED",
        contentSha256: sourceHash,
        contentByteLength: Buffer.byteLength(sourceText),
        integrityStatus: "VERIFIED",
      },
    });
    documentId = document.id;

    const expert = await prisma.expert.create({
      data: {
        companyId,
        fullName: "Hana Provenance",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        certifications: JSON.stringify(["PMP"]),
        trustLevel: "REVIEWED",
        reviewedBy: userId,
        reviewedAt,
        reviewNotes: "Legacy review without source evidence.",
        sourceDocumentId: documentId,
      },
    });
    expertId = expert.id;

    const project = await prisma.project.create({
      data: {
        companyId,
        name: "Project Alpha",
        clientName: "Client One",
        country: "Ethiopia",
        sector: "Buildings",
        serviceAreas: JSON.stringify(["Structural Engineering"]),
        contractValue: 1000,
        currency: "ETB",
        trustLevel: "REVIEWED",
        reviewedBy: userId,
        reviewedAt,
        reviewNotes: "Legacy review without source evidence.",
        sourceDocumentId: documentId,
      },
    });
    projectId = project.id;
  });

  after(async () => {
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rejects stored REVIEWED expert and project rows without durable provenance", async () => {
    const [expert, project] = await Promise.all([
      prisma.expert.findUniqueOrThrow({
        where: { id: expertId },
        select: { companyId: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true, sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } } },
      }),
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { companyId: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, contractValue: true, currency: true, trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true, sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } } },
      }),
    ]);

    for (const record of [expert, project]) {
      assert.equal(isDurablyReviewed(record), false);
    }
  });

  it("accepts records only after per-field source evidence and reviewer audit are persisted", async () => {
    const sourceDocument = {
      id: documentId,
      companyId,
      extractedText: sourceText,
      contentSha256: sourceHash,
      contentByteLength: Buffer.byteLength(sourceText),
      integrityStatus: "VERIFIED",
    };
    const expertProvenance = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument,
      fields: expertReviewFields({
        fullName: "Hana Provenance",
        title: "Structural Engineer",
        yearsExperience: 20,
        disciplines: JSON.stringify(["Structural Engineering"]),
        sectors: JSON.stringify(["Buildings"]),
        certifications: JSON.stringify(["PMP"]),
      }),
      reviewerId: userId,
      reviewedAt,
    });
    const projectProvenance = buildReviewProvenance({
      recordType: "PROJECT",
      sourceDocument,
      fields: projectReviewFields({
        name: "Project Alpha",
        clientName: "Client One",
        country: "Ethiopia",
        sector: "Buildings",
        serviceAreas: JSON.stringify(["Structural Engineering"]),
        contractValue: 1000,
        currency: "ETB",
      }),
      reviewerId: userId,
      reviewedAt,
    });
    assert.equal(expertProvenance.ok, true);
    assert.equal(projectProvenance.ok, true);
    if (!expertProvenance.ok || !projectProvenance.ok) return;

    await prisma.$transaction([
      prisma.expert.update({ where: { id: expertId }, data: { reviewNotes: expertProvenance.serialized } }),
      prisma.project.update({ where: { id: projectId }, data: { reviewNotes: projectProvenance.serialized } }),
    ]);

    const [expert, project] = await Promise.all([
      prisma.expert.findUniqueOrThrow({
        where: { id: expertId },
        select: { companyId: true, fullName: true, title: true, yearsExperience: true, disciplines: true, sectors: true, certifications: true, trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true, sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } } },
      }),
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { companyId: true, name: true, clientName: true, country: true, sector: true, serviceAreas: true, contractValue: true, currency: true, trustLevel: true, reviewedBy: true, reviewedAt: true, reviewNotes: true, sourceDocumentId: true, sourceDocument: { select: { id: true, companyId: true, extractedText: true, contentSha256: true, contentByteLength: true, integrityStatus: true } } },
      }),
    ]);
    assert.equal(isDurablyReviewed(expert), true);
    assert.equal(isDurablyReviewed(project), true);

    await prisma.$transaction([
      prisma.expert.update({ where: { id: expertId }, data: { yearsExperience: 21 } }),
      prisma.project.update({ where: { id: projectId }, data: { currency: "USD" } }),
    ]);
    const [mutatedExpert, mutatedProject] = await Promise.all([
      prisma.expert.findUniqueOrThrow({
        where: { id: expertId },
        select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT,
      }),
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT,
      }),
    ]);
    assert.equal(isDurablyReviewed(mutatedExpert), false);
    assert.equal(isDurablyReviewed(mutatedProject), false);
  });
});
