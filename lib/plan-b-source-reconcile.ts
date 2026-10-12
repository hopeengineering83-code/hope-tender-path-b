import type { PrismaClient } from "@prisma/client";
import {
  buildPartialSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
  type ReviewSourceDocument,
} from "./vault-review-provenance";
import type { PlanBFinalizePayload } from "./plan-b-vault-finalize";

function clean(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function fileStem(value: unknown): string {
  return clean(value)
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/\bdocuments?\b/g, "")
    .replace(/\breferences?\b/g, "reference")
    .replace(/\bcurriculum vitae\b/g, "cv")
    .replace(/\bcvs\b/g, "cv")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedText(value: unknown): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function reviewDocument(document: {
  id: string;
  companyId: string;
  extractedText: string | null;
  contentSha256: string | null;
  contentByteLength: number | null;
  integrityStatus: string;
}): ReviewSourceDocument {
  return document;
}

export async function reconcilePlanBSourcesByUniqueStem(
  prisma: PrismaClient,
  companyId: string,
  payload: PlanBFinalizePayload,
): Promise<{ linkedExperts: number; linkedProjects: number; ambiguousSourceStems: number }> {
  const documents = await prisma.companyDocument.findMany({
    where: { companyId, integrityStatus: "VERIFIED", extractedText: { not: null } },
    select: {
      id: true,
      companyId: true,
      fileName: true,
      originalFileName: true,
      extractedText: true,
      contentSha256: true,
      contentByteLength: true,
      integrityStatus: true,
    },
  });

  const candidates = new Map<string, typeof documents>();
  for (const document of documents) {
    for (const name of [document.originalFileName, document.fileName]) {
      const stem = fileStem(name);
      if (stem) candidates.set(stem, [...(candidates.get(stem) ?? []), document]);
    }
  }

  const uniqueDocuments = new Map<string, (typeof documents)[number]>();
  let ambiguousSourceStems = 0;
  for (const [stem, rows] of candidates) {
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    if (unique.length === 1) uniqueDocuments.set(stem, unique[0]);
    else ambiguousSourceStems += 1;
  }

  let linkedExperts = 0;
  let linkedProjects = 0;

  await prisma.$transaction(async (tx) => {
    for (const declared of payload.experts ?? []) {
      const name = clean(declared.fullName);
      const document = uniqueDocuments.get(fileStem(declared.sourceDocument));
      if (!name || !document?.extractedText) continue;
      if (!normalizedText(document.extractedText).includes(normalizedText(name))) continue;

      const row = await tx.expert.findFirst({ where: { companyId, fullName: { equals: name, mode: "insensitive" } } });
      if (!row) continue;
      const provenance = buildPartialSourceVerificationProvenance({
        recordType: "EXPERT",
        sourceDocument: reviewDocument(document),
        fields: expertReviewFields({
          fullName: name,
          title: clean(declared.title) || row.title,
          yearsExperience: typeof declared.yearsExperience === "number" ? declared.yearsExperience : row.yearsExperience,
          disciplines: Array.isArray(declared.disciplines) ? JSON.stringify(declared.disciplines) : row.disciplines,
          sectors: Array.isArray(declared.sectors) ? JSON.stringify(declared.sectors) : row.sectors,
          certifications: Array.isArray(declared.certifications) ? JSON.stringify(declared.certifications) : row.certifications,
        }),
        verificationMethod: "HYBRID",
      });
      await tx.expert.update({
        where: { id: row.id },
        data: {
          sourceDocumentId: document.id,
          trustLevel: provenance.ok ? "SOURCE_VERIFIED" : "AI_DRAFT",
          reviewNotes: provenance.ok ? provenance.serialized : row.reviewNotes,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
      linkedExperts += 1;
    }

    for (const declared of payload.projects ?? []) {
      const name = clean(declared.name);
      const document = uniqueDocuments.get(fileStem(declared.sourceDocument));
      if (!name || !document?.extractedText) continue;
      if (!normalizedText(document.extractedText).includes(normalizedText(name))) continue;

      const row = await tx.project.findFirst({ where: { companyId, name: { equals: name, mode: "insensitive" } } });
      if (!row) continue;
      const serviceAreas = declared.serviceAreas?.length ? declared.serviceAreas : declared.sectors;
      const provenance = buildPartialSourceVerificationProvenance({
        recordType: "PROJECT",
        sourceDocument: reviewDocument(document),
        fields: projectReviewFields({
          name,
          clientName: clean(declared.clientName) || row.clientName,
          country: clean(declared.country) || row.country,
          sector: clean(declared.sector || declared.sectors?.[0]) || row.sector,
          serviceAreas: Array.isArray(serviceAreas) ? JSON.stringify(serviceAreas) : row.serviceAreas,
        }),
        verificationMethod: "HYBRID",
      });
      await tx.project.update({
        where: { id: row.id },
        data: {
          sourceDocumentId: document.id,
          trustLevel: provenance.ok ? "SOURCE_VERIFIED" : "AI_DRAFT",
          reviewNotes: provenance.ok ? provenance.serialized : row.reviewNotes,
          reviewedBy: null,
          reviewedAt: null,
        },
      });
      linkedProjects += 1;
    }
  });

  return { linkedExperts, linkedProjects, ambiguousSourceStems };
}
