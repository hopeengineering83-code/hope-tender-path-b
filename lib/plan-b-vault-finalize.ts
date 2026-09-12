import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import {
  buildPartialSourceVerificationProvenance,
  expertReviewFields,
  projectReviewFields,
  type ReviewSourceDocument,
} from "./vault-review-provenance";
import { materializeLegacyImportSources, legacySourceFileName } from "./company-vault-legacy-source-materialize";

export type PlanBFinalizeExpert = {
  fullName?: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[];
  sectors?: string[];
  certifications?: string[];
  sourceDocument?: string;
  sourceSha256?: string | null;
};

export type PlanBFinalizeProject = {
  name?: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  sectors?: string[];
  serviceAreas?: string[];
  sourceDocument?: string;
  sourceSha256?: string | null;
};

export type PlanBFinalizePayload = {
  sourceDocuments?: Array<{
    fileName?: string;
    title?: string;
    sha256?: string | null;
  }>;
  experts?: PlanBFinalizeExpert[];
  projects?: PlanBFinalizeProject[];
};

export type PlanBFinalizeResult = {
  restored: { experts: number; projects: number; total: number };
  linked: { experts: number; projects: number; total: number };
  sourceVerified: { experts: number; projects: number; total: number };
  activeCounts: { experts: number; projects: number };
  sourceDescriptorsStaged: number;
  missingOriginalSources: number;
  sourceBlocker: string | null;
  verificationBlocker: string | null;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizePlanBFileName(value: unknown): string {
  const normalized = clean(value).normalize("NFKC").replace(/\\/g, "/");
  return path.posix.basename(normalized).toLowerCase();
}

function normalizeRecordKey(value: unknown): string {
  return clean(value).normalize("NFKC").toLowerCase();
}

function declaredArrayJson(value: unknown, current: string): string {
  if (!Array.isArray(value)) return current;
  return JSON.stringify(value.map(clean).filter(Boolean));
}

function normalizedHash(value: unknown): string | null {
  const hash = clean(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

type OfficialDoc = {
  id: string;
  companyId: string;
  fileName: string;
  originalFileName: string;
  extractedText: string | null;
  contentSha256: string | null;
  contentByteLength: number | null;
  integrityStatus: string;
};

function reviewDoc(doc: OfficialDoc): ReviewSourceDocument {
  return {
    id: doc.id,
    companyId: doc.companyId,
    extractedText: doc.extractedText,
    contentSha256: doc.contentSha256,
    contentByteLength: doc.contentByteLength,
    integrityStatus: doc.integrityStatus,
  };
}

function resolveOfficialDocument(
  byHash: Map<string, OfficialDoc>,
  byFileName: Map<string, OfficialDoc>,
  sourceSha256: unknown,
  sourceDocument: unknown,
): OfficialDoc | null {
  const hash = normalizedHash(sourceSha256);
  if (hash) {
    const match = byHash.get(hash);
    if (match) return match;
  }
  const fileName = normalizePlanBFileName(sourceDocument);
  return fileName ? byFileName.get(fileName) ?? null : null;
}

function missingSourceKey(sourceSha256: unknown, sourceDocument: unknown): string | null {
  const hash = normalizedHash(sourceSha256);
  if (hash) return `sha256:${hash}`;
  const name = normalizePlanBFileName(sourceDocument);
  return name ? `filename:${name}` : null;
}

function displayMissingSource(sourceSha256: unknown, sourceDocument: unknown): string {
  const name = clean(sourceDocument);
  if (name) return name;
  const hash = normalizedHash(sourceSha256);
  return hash ? `SHA-256 ${hash.slice(0, 12)}…` : "unnamed source";
}

/**
 * Reconcile the legacy Plan B import with canonical Company Vault truth.
 *
 * The legacy route remains responsible for schema validation and structured
 * upserts. This service performs the durable post-import guarantees that the
 * Vault UI and Engine require:
 * - matched soft-deleted rows are restored;
 * - only tenant-owned VERIFIED CompanyDocuments may become official sources;
 * - SHA-256 wins, normalized filename is the fallback;
 * - one official source may verify any number of records;
 * - active counts are re-read after the transaction;
 * - genuinely absent originals are represented by one company-level blocker.
 */
export async function finalizePlanBCompanyVault(
  prisma: PrismaClient,
  input: { userId: string; companyId: string; payload: PlanBFinalizePayload },
): Promise<PlanBFinalizeResult> {
  const experts = Array.isArray(input.payload.experts) ? input.payload.experts : [];
  const projects = Array.isArray(input.payload.projects) ? input.payload.projects : [];

  // The text this import parsed is already owned company evidence. Persist it
  // as vault documents before resolving declared sources, so a record whose
  // source was read here resolves to it instead of being reported as an absent
  // original the owner is asked to upload again.
  await materializeLegacyImportSources(input.companyId);

  const officialDocs = await prisma.companyDocument.findMany({
    where: {
      companyId: input.companyId,
      integrityStatus: "VERIFIED",
    },
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

  const byHash = new Map<string, OfficialDoc>();
  const byFileName = new Map<string, OfficialDoc>();
  for (const doc of officialDocs) {
    const hash = normalizedHash(doc.contentSha256);
    if (hash && !byHash.has(hash)) byHash.set(hash, doc);

    for (const candidate of [doc.originalFileName, doc.fileName]) {
      const name = normalizePlanBFileName(candidate);
      if (name && !byFileName.has(name)) byFileName.set(name, doc);
    }
  }

  // A record declares its source by the original filename ("Expert CVS.pdf"),
  // but a source materialized from this import's own staged text is stored
  // under a text name, because that is what its bytes are. Alias the declared
  // name onto it so the declaration resolves to the evidence it actually came
  // from instead of being reported as an absent original.
  const stagedNames = await prisma.planBStaging.findMany({
    where: { companyId: input.companyId },
    select: { originalFileName: true },
  });
  for (const staged of stagedNames) {
    const declared = normalizePlanBFileName(staged.originalFileName);
    if (!declared || byFileName.has(declared)) continue;
    const stored = byFileName.get(normalizePlanBFileName(legacySourceFileName(staged.originalFileName)));
    if (stored) byFileName.set(declared, stored);
  }

  const currentExperts = await prisma.expert.findMany({
    where: { companyId: input.companyId },
    select: {
      id: true,
      fullName: true,
      title: true,
      yearsExperience: true,
      disciplines: true,
      sectors: true,
      certifications: true,
      deletedAt: true,
      isActive: true,
    },
  });
  const currentProjects = await prisma.project.findMany({
    where: { companyId: input.companyId },
    select: {
      id: true,
      name: true,
      clientName: true,
      country: true,
      sector: true,
      serviceAreas: true,
      deletedAt: true,
    },
  });

  const expertByName = new Map(currentExperts.map((row) => [normalizeRecordKey(row.fullName), row]));
  const projectByName = new Map(currentProjects.map((row) => [normalizeRecordKey(row.name), row]));

  let restoredExperts = 0;
  let restoredProjects = 0;
  let linkedExperts = 0;
  let linkedProjects = 0;
  let verifiedExperts = 0;
  let verifiedProjects = 0;
  let verificationFailures = 0;
  const missingSources = new Map<string, string>();

  await prisma.$transaction(async (tx) => {
    for (const declared of experts) {
      const row = expertByName.get(normalizeRecordKey(declared.fullName));
      if (!row) continue;
      const doc = resolveOfficialDocument(byHash, byFileName, declared.sourceSha256, declared.sourceDocument);
      const data: Record<string, unknown> = {};

      if (row.deletedAt || row.isActive === false) {
        data.deletedAt = null;
        data.deletedBy = null;
        data.isActive = true;
        restoredExperts += 1;
      }

      if (doc) {
        linkedExperts += 1;
        data.sourceDocumentId = doc.id;
        const provenance = buildPartialSourceVerificationProvenance({
          recordType: "EXPERT",
          sourceDocument: reviewDoc(doc),
          fields: expertReviewFields({
            fullName: clean(declared.fullName) || row.fullName,
            title: clean(declared.title) || row.title,
            yearsExperience: typeof declared.yearsExperience === "number" ? declared.yearsExperience : row.yearsExperience,
            disciplines: declaredArrayJson(declared.disciplines, row.disciplines),
            sectors: declaredArrayJson(declared.sectors, row.sectors),
            certifications: declaredArrayJson(declared.certifications, row.certifications),
          }),
          verificationMethod: "HYBRID",
        });
        if (provenance.ok) {
          data.trustLevel = "SOURCE_VERIFIED";
          data.reviewNotes = provenance.serialized;
          data.reviewedBy = null;
          data.reviewedAt = null;
          verifiedExperts += 1;
        } else {
          data.trustLevel = "AI_DRAFT";
          verificationFailures += 1;
        }
      } else {
        const key = missingSourceKey(declared.sourceSha256, declared.sourceDocument);
        if (key) missingSources.set(key, displayMissingSource(declared.sourceSha256, declared.sourceDocument));
      }

      if (Object.keys(data).length > 0) {
        await tx.expert.update({ where: { id: row.id }, data });
      }
    }

    for (const declared of projects) {
      const row = projectByName.get(normalizeRecordKey(declared.name));
      if (!row) continue;
      const doc = resolveOfficialDocument(byHash, byFileName, declared.sourceSha256, declared.sourceDocument);
      const data: Record<string, unknown> = {};

      if (row.deletedAt) {
        data.deletedAt = null;
        data.deletedBy = null;
        restoredProjects += 1;
      }

      if (doc) {
        linkedProjects += 1;
        data.sourceDocumentId = doc.id;
        const serviceAreas = declared.serviceAreas?.length ? declared.serviceAreas : declared.sectors;
        const provenance = buildPartialSourceVerificationProvenance({
          recordType: "PROJECT",
          sourceDocument: reviewDoc(doc),
          fields: projectReviewFields({
            name: clean(declared.name) || row.name,
            clientName: clean(declared.clientName) || row.clientName,
            country: clean(declared.country) || row.country,
            sector: clean(declared.sector || declared.sectors?.[0]) || row.sector,
            serviceAreas: declaredArrayJson(serviceAreas, row.serviceAreas),
          }),
          verificationMethod: "HYBRID",
        });
        if (provenance.ok) {
          data.trustLevel = "SOURCE_VERIFIED";
          data.reviewNotes = provenance.serialized;
          data.reviewedBy = null;
          data.reviewedAt = null;
          verifiedProjects += 1;
        } else {
          data.trustLevel = "AI_DRAFT";
          verificationFailures += 1;
        }
      } else {
        const key = missingSourceKey(declared.sourceSha256, declared.sourceDocument);
        if (key) missingSources.set(key, displayMissingSource(declared.sourceSha256, declared.sourceDocument));
      }

      if (Object.keys(data).length > 0) {
        await tx.project.update({ where: { id: row.id }, data });
      }
    }
  });

  const [activeExperts, activeProjects, sourceDescriptorsStaged] = await Promise.all([
    prisma.expert.count({ where: { companyId: input.companyId, deletedAt: null, isActive: true } }),
    prisma.project.count({ where: { companyId: input.companyId, deletedAt: null } }),
    prisma.planBStaging.count({ where: { companyId: input.companyId } }),
  ]);

  const missingNames = [...missingSources.values()];
  const missingSummary = missingNames.length > 0
    ? ` No readable content was imported for: ${missingNames.slice(0, 5).join(", ")}${missingNames.length > 5 ? ` and ${missingNames.length - 5} more` : ""}.`
    : "";

  return {
    restored: {
      experts: restoredExperts,
      projects: restoredProjects,
      total: restoredExperts + restoredProjects,
    },
    linked: {
      experts: linkedExperts,
      projects: linkedProjects,
      total: linkedExperts + linkedProjects,
    },
    sourceVerified: {
      experts: verifiedExperts,
      projects: verifiedProjects,
      total: verifiedExperts + verifiedProjects,
    },
    activeCounts: { experts: activeExperts, projects: activeProjects },
    sourceDescriptorsStaged,
    missingOriginalSources: missingSources.size,
    sourceBlocker: missingSources.size > 0
      ? `Original source evidence is absent for ${missingSources.size} declared source${missingSources.size === 1 ? "" : "s"}.${missingSummary}`
      : null,
    verificationBlocker: verificationFailures > 0
      ? `${verificationFailures} imported record${verificationFailures === 1 ? "" : "s"} linked to an official file but did not match the source text closely enough for SOURCE_VERIFIED status.`
      : null,
  };
}
