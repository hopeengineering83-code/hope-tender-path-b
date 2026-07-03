import { createHash } from "node:crypto";
import { prisma } from "../prisma";

export type PlanRevisionStatus = "DRAFT" | "REVIEW_REQUIRED" | "CONFIRMED" | "SUPERSEDED";
export type PlanItemEnvelope = "TECHNICAL" | "FINANCIAL" | "ADMIN";

export type PlannedFileForPersistence = {
  exactFileName: string;
  exactOrder: number;
  documentType: string;
  format: string;
  envelope: PlanItemEnvelope;
  sourceRequirementIds?: string[];
  sourceFileCitations?: Array<{ tenderFileId: string; pageNumber: number; exactQuote: string }>;
  requiresOriginalUpload?: boolean;
};

export type PersistedPlanStaleCode = "PLAN_STALE_REBUILD_REQUIRED";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const SERIALIZATION_CODES = new Set(["P2034", "40001", "40P01"]);
const MEANINGFUL_QUOTE_MIN = 12;

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isTransientTxError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return SERIALIZATION_CODES.has(code) || /could not serialize|deadlock detected|write conflict/i.test(message);
}

export async function withSerializableRetry<T>(fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await prisma.$transaction(async (tx) => fn(tx), { isolationLevel: "Serializable" });
    } catch (error) {
      last = error;
      if (!isTransientTxError(error) || index === attempts - 1) throw error;
    }
  }
  throw last;
}

export function citationHash(input: { tenderFileId: string; pageNumber: number; exactQuote: string; sourceContentHash: string }): string {
  return sha256(stableJson(input));
}

export async function computeSourceContentHash(tenderId: string, client: Pick<Tx, "tenderFile"> = prisma): Promise<string> {
  const files = await (client as any).tenderFile.findMany({
    where: { tenderId, deletionStatus: "ACTIVE" },
    select: {
      id: true,
      originalFileName: true,
      fileName: true,
      fileContent: true,
      storagePath: true,
      classification: true,
      extractionMethod: true,
      extractionScore: true,
      totalPages: true,
      extractedPages: true,
      ocrPages: true,
      failedPages: true,
      pageStatusJson: true,
      updatedAt: true,
      deletedAt: true,
      deletionStatus: true,
    },
    orderBy: [{ id: "asc" }],
  });
  return sha256(stableJson(files.map((file: any) => ({
    id: file.id,
    originalFileName: file.originalFileName,
    fileName: file.fileName,
    contentSha256: sha256(`${file.fileContent ?? ""}|${file.storagePath ?? ""}`),
    classification: file.classification,
    extractionMethod: file.extractionMethod,
    extractionScore: file.extractionScore,
    totalPages: file.totalPages,
    extractedPages: file.extractedPages,
    ocrPages: file.ocrPages,
    failedPages: file.failedPages,
    pageStatusHash: sha256(file.pageStatusJson ?? ""),
    updatedAt: file.updatedAt?.toISOString?.() ?? String(file.updatedAt ?? ""),
    deletionStatus: file.deletionStatus,
    deletedAt: file.deletedAt?.toISOString?.() ?? null,
  }))));
}

export async function computeRequirementsHash(tenderId: string, client: Pick<Tx, "tenderRequirement"> = prisma): Promise<string> {
  const requirements = await (client as any).tenderRequirement.findMany({
    where: { tenderId },
    select: {
      id: true,
      code: true,
      title: true,
      description: true,
      requirementType: true,
      priority: true,
      sectionReference: true,
      sourceTenderFileId: true,
      sourcePageNumber: true,
      sourceExactQuote: true,
      sourceExtractionMethod: true,
      sourceConfidence: true,
      exactFileName: true,
      exactOrder: true,
      restrictions: true,
      updatedAt: true,
    },
    orderBy: [{ id: "asc" }],
  });
  return sha256(stableJson(requirements));
}

function validatePlannedFiles(files: PlannedFileForPersistence[]): void {
  if (files.length === 0) throw new Error("PLAN_EMPTY");
  const names = new Set<string>();
  const orders = new Set<number>();
  for (const file of files) {
    if (!file.exactFileName?.trim()) throw new Error("PLAN_ITEM_FILENAME_REQUIRED");
    if (!Number.isInteger(file.exactOrder) || file.exactOrder < 1) throw new Error("PLAN_ITEM_ORDER_INVALID");
    if (!file.documentType?.trim()) throw new Error("PLAN_ITEM_TYPE_REQUIRED");
    if (!file.format?.trim()) throw new Error("PLAN_ITEM_FORMAT_REQUIRED");
    if (!/^(TECHNICAL|FINANCIAL|ADMIN)$/.test(file.envelope)) throw new Error("PLAN_ITEM_ENVELOPE_INVALID");
    const nameKey = file.exactFileName.trim().toLowerCase();
    if (names.has(nameKey)) throw new Error("PLAN_DUPLICATE_FILENAME");
    if (orders.has(file.exactOrder)) throw new Error("PLAN_DUPLICATE_ORDER");
    names.add(nameKey);
    orders.add(file.exactOrder);
    for (const citation of file.sourceFileCitations ?? []) {
      if (!citation.tenderFileId) throw new Error("PLAN_CITATION_FILE_REQUIRED");
      if (!Number.isInteger(citation.pageNumber) || citation.pageNumber < 1) throw new Error("PLAN_CITATION_PAGE_INVALID");
      if ((citation.exactQuote ?? "").trim().length < MEANINGFUL_QUOTE_MIN) throw new Error("PLAN_CITATION_QUOTE_TOO_SHORT");
    }
  }
}

export async function buildPersistedSubmissionPlan(tenderId: string, createdById: string, plannedFiles: PlannedFileForPersistence[]) {
  validatePlannedFiles(plannedFiles);
  return withSerializableRetry(async (tx) => {
    const sourceContentHash = await computeSourceContentHash(tenderId, tx as any);
    const requirementsHash = await computeRequirementsHash(tenderId, tx as any);

    await (tx as any).$queryRawUnsafe('SELECT id FROM "Tender" WHERE id = $1 FOR UPDATE', tenderId);

    const previous = await (tx as any).submissionPlanRevision.findMany({
      where: { tenderId },
      select: { revision: true },
      orderBy: { revision: "desc" },
      take: 1,
    });
    const nextRevision = (previous[0]?.revision ?? 0) + 1;

    await (tx as any).submissionPlanRevision.updateMany({
      where: { tenderId, status: { in: ["DRAFT", "REVIEW_REQUIRED"] } },
      data: { status: "SUPERSEDED", supersededAt: new Date() },
    });

    const revision = await (tx as any).submissionPlanRevision.create({
      data: { tenderId, revision: nextRevision, status: "DRAFT", sourceContentHash, requirementsHash, createdById },
    });

    for (const file of plannedFiles) {
      const item = await (tx as any).submissionPlanItem.create({
        data: {
          submissionPlanId: revision.id,
          exactFileName: file.exactFileName.trim(),
          exactOrder: file.exactOrder,
          documentType: file.documentType,
          format: file.format,
          envelope: file.envelope,
          requiresOriginalUpload: Boolean(file.requiresOriginalUpload),
        },
      });
      for (const requirementId of Array.from(new Set(file.sourceRequirementIds ?? []))) {
        await (tx as any).submissionPlanItemRequirement.create({ data: { submissionPlanItemId: item.id, tenderRequirementId: requirementId } });
      }
      for (const citation of file.sourceFileCitations ?? []) {
        await (tx as any).submissionPlanItemCitation.create({
          data: {
            submissionPlanItemId: item.id,
            tenderFileId: citation.tenderFileId,
            pageNumber: citation.pageNumber,
            exactQuote: citation.exactQuote,
            sourceContentHash,
            citationHash: citationHash({ tenderFileId: citation.tenderFileId, pageNumber: citation.pageNumber, exactQuote: citation.exactQuote, sourceContentHash }),
          },
        });
      }
    }

    return { planId: revision.id, revision: nextRevision, status: "DRAFT" as const, sourceContentHash, requirementsHash, itemCount: plannedFiles.length, confirmationRequired: true, virtualOnly: true };
  });
}

async function loadPlanForSnapshot(tx: Tx, planId: string) {
  return (tx as any).submissionPlanRevision.findUnique({
    where: { id: planId },
    include: { items: { orderBy: { exactOrder: "asc" }, include: { requirements: true, citations: { orderBy: [{ tenderFileId: "asc" }, { pageNumber: "asc" }] } } } },
  });
}

export async function confirmSubmissionPlan(tenderId: string, confirmedById: string, expectedSourceContentHash: string, expectedRequirementsHash: string) {
  return withSerializableRetry(async (tx) => {
    await (tx as any).$queryRawUnsafe('SELECT id FROM "Tender" WHERE id = $1 FOR UPDATE', tenderId);
    const currentSourceHash = await computeSourceContentHash(tenderId, tx as any);
    const currentRequirementsHash = await computeRequirementsHash(tenderId, tx as any);
    if (expectedSourceContentHash !== currentSourceHash || expectedRequirementsHash !== currentRequirementsHash) {
      return { ok: false as const, code: "PLAN_STALE_REBUILD_REQUIRED" as PersistedPlanStaleCode, error: "Plan is stale because tender source files or requirements changed. Rebuild the submission plan." };
    }

    const draft = await (tx as any).submissionPlanRevision.findFirst({
      where: { tenderId, status: { in: ["DRAFT", "REVIEW_REQUIRED"] } },
      orderBy: { revision: "desc" },
      include: { items: { include: { requirements: true, citations: true } } },
    });
    if (!draft) return { ok: false as const, code: "PLAN_NOT_FOUND", error: "No active draft plan found." };
    if (draft.sourceContentHash !== currentSourceHash || draft.requirementsHash !== currentRequirementsHash) {
      await (tx as any).submissionPlanRevision.update({ where: { id: draft.id }, data: { status: "SUPERSEDED", supersededAt: new Date(), invalidatedAt: new Date(), invalidationReason: "PLAN_STALE_REBUILD_REQUIRED" } });
      return { ok: false as const, code: "PLAN_STALE_REBUILD_REQUIRED" as PersistedPlanStaleCode, error: "Plan draft was built from stale tender source or requirements. Rebuild the submission plan." };
    }

    const activeFiles = await (tx as any).tenderFile.findMany({ where: { tenderId, deletionStatus: "ACTIVE" }, select: { id: true, totalPages: true, extractedPages: true, failedPages: true } });
    const activeFileIds = new Set(activeFiles.map((f: any) => f.id));
    if (activeFiles.length === 0 || activeFiles.some((f: any) => !f.totalPages || (f.extractedPages ?? 0) < f.totalPages || (f.failedPages ?? 0) > 0)) {
      return { ok: false as const, code: "PLAN_STALE_REBUILD_REQUIRED" as PersistedPlanStaleCode, error: "Plan cannot be confirmed while active tender source files are incomplete or weak." };
    }

    for (const item of draft.items) {
      if (!item.exactFileName || !item.exactOrder || !item.documentType || !item.format || !item.envelope) return { ok: false as const, code: "PLAN_ITEM_INVALID", error: "Plan item is missing required release fields." };
      for (const citation of item.citations) {
        if (!activeFileIds.has(citation.tenderFileId) || citation.pageNumber < 1 || (citation.exactQuote ?? "").trim().length < MEANINGFUL_QUOTE_MIN || citation.sourceContentHash !== currentSourceHash) {
          return { ok: false as const, code: "PLAN_STALE_REBUILD_REQUIRED" as PersistedPlanStaleCode, error: "Plan item citation is stale or not grounded in an active tender file." };
        }
      }
    }

    await (tx as any).submissionPlanRevision.updateMany({ where: { tenderId, status: "CONFIRMED" }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    const fresh = await loadPlanForSnapshot(tx, draft.id);
    const snapshot = {
      planId: draft.id,
      tenderId,
      revision: draft.revision,
      status: "CONFIRMED",
      sourceContentHash: currentSourceHash,
      requirementsHash: currentRequirementsHash,
      items: fresh.items.map((item: any) => ({
        id: item.id,
        exactFileName: item.exactFileName,
        exactOrder: item.exactOrder,
        documentType: item.documentType,
        format: item.format,
        envelope: item.envelope,
        requiresOriginalUpload: item.requiresOriginalUpload,
        generatedDocumentId: item.generatedDocumentId,
        requirementIds: item.requirements.map((r: any) => r.tenderRequirementId).sort(),
        citations: item.citations.map((c: any) => ({ tenderFileId: c.tenderFileId, pageNumber: c.pageNumber, exactQuote: c.exactQuote, sourceContentHash: c.sourceContentHash, citationHash: c.citationHash })),
      })),
    };
    const confirmationHash = sha256(stableJson(snapshot));
    await (tx as any).submissionPlanRevision.update({ where: { id: draft.id }, data: { status: "CONFIRMED", confirmedById, confirmedAt: new Date(), confirmationSnapshot: snapshot, confirmationHash } });
    return { ok: true as const, planId: draft.id, revision: draft.revision, confirmationHash };
  });
}

export async function getCurrentConfirmedPlan(tenderId: string) {
  return (prisma as any).submissionPlanRevision.findFirst({
    where: { tenderId, status: "CONFIRMED", invalidatedAt: null },
    orderBy: { revision: "desc" },
    include: { items: { include: { requirements: true, citations: true, generatedDocument: true }, orderBy: { exactOrder: "asc" } } },
  });
}

export async function hasConfirmedPersistedPlan(tenderId: string): Promise<boolean> {
  const currentSourceHash = await computeSourceContentHash(tenderId);
  const currentRequirementsHash = await computeRequirementsHash(tenderId);
  const plan = await getCurrentConfirmedPlan(tenderId);
  return Boolean(plan && plan.sourceContentHash === currentSourceHash && plan.requirementsHash === currentRequirementsHash && plan.confirmationHash);
}