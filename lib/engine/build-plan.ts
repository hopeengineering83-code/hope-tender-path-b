import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { buildSubmissionPlan, plannedSubmissionTargetFiles, type SubmissionPlanFile } from "./submission-plan";

export type BuildPlanItem = SubmissionPlanFile;
export type BuildPlanValidation = { ok: boolean; blockers: string[] };

function normalizeText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizePlanName(value: unknown): string {
  return normalizeText(value);
}

function planItemKey(item: Pick<BuildPlanItem, "exactFileName" | "exactOrder" | "documentType">): string {
  return `${Number(item.exactOrder)}::${normalizePlanName(item.exactFileName)}::${normalizeText(item.documentType)}`;
}

function quoteSupported(extractedText: unknown, quote: string): boolean {
  return normalizeText(extractedText).includes(normalizeText(quote));
}

export async function computeTenderBuildPlanHash(prisma: PrismaClient, tenderId: string, userId: string, items?: BuildPlanItem[]): Promise<string | null> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    select: {
      id: true, title: true, reference: true, exactFileNaming: true, exactFileOrder: true, submissionMethod: true, submissionAddress: true, submissionEmails: true, submissionEmailSubject: true,
      files: { where: { deletionStatus: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { id: true, originalFileName: true, extractedText: true, deletionStatus: true } },
      requirements: { orderBy: { createdAt: "asc" }, select: { id: true, title: true, description: true, requirementType: true, priority: true, exactFileName: true, exactOrder: true, sourceTenderFileId: true, sourcePageNumber: true, sourceExactQuote: true } },
    },
  });
  if (!tender) return null;
  const planItems = items ?? plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  // CANONICAL HASH: uses the SINGLE shared computeBuildPlanHash from
  // build-plan-hash.ts — the SAME helper the generation-readiness-gate uses
  // for stale detection. No second "compatibility" hash may exist.
  const { computeBuildPlanHash, buildPlanHashInputFromTender } = await import("./build-plan-hash");
  return computeBuildPlanHash(buildPlanHashInputFromTender({
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    files: tender.files.map((f) => ({ id: f.id, fileName: f.originalFileName, extractedText: f.extractedText, deletionStatus: f.deletionStatus })),
    requirements: tender.requirements.map((r) => ({ id: r.id, title: r.title, requirementType: r.requirementType, priority: r.priority, exactFileName: r.exactFileName, exactOrder: r.exactOrder })),
  }));
}

export async function buildDraftBuildPlan(prisma: PrismaClient, tenderId: string, userId: string) {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: { requirements: true },
  });
  if (!tender) return null;
  const items = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  const contentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  if (!contentHash) return null;

  // TRANSACTION-SAFE REBUILD: BuildPlan has ONE unique row per tender
  // (tenderId @unique). Whether the existing row is DRAFT or CONFIRMED,
  // rebuild it in-place: set status=DRAFT, increment revision, replace
  // canonical items/hash, and CLEAR all confirmed* fields so any stale
  // confirmation is invalidated. Never create a second row; never delete
  // a confirmed plan. Uses upsert for race safety.
  const itemsJson = JSON.stringify(items);
  const validationJson = JSON.stringify({ ok: false, blockers: ["Draft build plan requires confirmation."] });
  return (prisma as any).buildPlan.upsert({
    where: { tenderId },
    update: {
      status: "DRAFT",
      revision: { increment: 1 },
      contentHash,
      itemsJson,
      validationJson,
      builtById: userId,
      confirmedRevision: null,
      confirmedContentHash: null,
      confirmedById: null,
      confirmedBy: null,
      confirmedAt: null,
    },
    create: {
      tenderId,
      status: "DRAFT",
      revision: 1,
      contentHash,
      itemsJson,
      validationJson,
      builtById: userId,
    },
  });
}

export async function validateBuildPlanForConfirmation(prisma: PrismaClient, tenderId: string, userId: string, items: BuildPlanItem[]): Promise<BuildPlanValidation> {
  const blockers: string[] = [];
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, include: { files: true, requirements: true } });
  if (!tender) return { ok: false, blockers: ["Tender not found or not owned by actor."] };
  const activeFiles = new Map(tender.files.filter((f: any) => f.deletionStatus === "ACTIVE").map((f: any) => [f.id, f]));
  const reqs = new Map(tender.requirements.map((r: any) => [r.id, r]));
  const authoritativeItems = plannedSubmissionTargetFiles(buildSubmissionPlan(tender as any));
  const authoritativeKeys = new Set(authoritativeItems.map(planItemKey));
  const seen = new Set<string>();
  if (items.length === 0) blockers.push("Build Plan has no tender-controlled required files.");
  if (items.length !== authoritativeItems.length) blockers.push("Build Plan item count does not match current tender-controlled submission scope.");
  for (const item of items) {
    const key = planItemKey(item);
    if (!authoritativeKeys.has(key)) blockers.push(`${item.exactFileName} order/type/name is not in current tender-controlled scope.`);
    const orderNameKey = `${Number(item.exactOrder)}:${normalizePlanName(item.exactFileName)}`;
    if (seen.has(orderNameKey)) blockers.push(`Duplicate/conflicting plan item: ${item.exactOrder} ${item.exactFileName}`);
    seen.add(orderNameKey);
    if (!item.exactFileName?.trim() || !Number.isInteger(item.exactOrder) || item.exactOrder < 1) blockers.push(`Invalid filename/order for ${item.canonicalId ?? item.exactFileName}`);
    if (item.required && item.sourceRequirementIds.length === 0 && !String(item.canonicalId ?? "").startsWith("exact-")) blockers.push(`${item.exactFileName} is missing linked tender requirement IDs.`);
    for (const reqId of item.sourceRequirementIds) {
      const req: any = reqs.get(reqId);
      if (!req) { blockers.push(`${item.exactFileName} references missing/foreign requirement ${reqId}.`); continue; }
      const file: any = req.sourceTenderFileId ? activeFiles.get(req.sourceTenderFileId) : null;
      const quote = String(req.sourceExactQuote ?? "").trim();
      if (!file) blockers.push(`Requirement ${reqId} evidence is not an ACTIVE TenderFile on this tender.`);
      if (!Number.isInteger(req.sourcePageNumber) || req.sourcePageNumber < 1) blockers.push(`Requirement ${reqId} has invalid source page.`);
      if (quote.length < 10) blockers.push(`Requirement ${reqId} has no meaningful source quote.`);
      if (file && quote.length >= 10 && !quoteSupported(file.extractedText, quote)) blockers.push(`Requirement ${reqId} quote is not supported by active file text.`);
    }
  }
  for (const authoritative of authoritativeItems) {
    if (!items.some((item) => planItemKey(item) === planItemKey(authoritative))) blockers.push(`${authoritative.exactFileName} is missing from the Build Plan.`);
  }
  return { ok: blockers.length === 0, blockers };
}

export async function getCurrentConfirmedBuildPlan(prisma: PrismaClient, tenderId: string, userId: string) {
  const plan = await (prisma as any).buildPlan.findFirst({ where: { tenderId, status: "CONFIRMED", tender: { userId } }, orderBy: { updatedAt: "desc" } });
  if (!plan) return { ok: false as const, blocker: "No confirmed Build Plan exists." };
  const items = JSON.parse(plan.itemsJson || "[]") as BuildPlanItem[];
  const currentHash = await computeTenderBuildPlanHash(prisma, tenderId, userId, items);
  const ok = plan.confirmedRevision === plan.revision && plan.confirmedContentHash === plan.contentHash && currentHash === plan.confirmedContentHash;
  return ok ? { ok: true as const, plan, currentHash } : { ok: false as const, blocker: "Confirmed Build Plan is stale or hash/revision mismatched." };
}


export type ConfirmedPlanDocumentValidation = { ok: boolean; blockers: string[]; exportReadyDocumentCount: number };

function generatedDocumentHasContent(doc: { fileContent?: string | null; storagePath?: string | null }): boolean {
  return Boolean(String(doc.fileContent ?? "").trim() || String(doc.storagePath ?? "").trim());
}

export async function validateConfirmedPlanDocuments(prisma: PrismaClient, tenderId: string, userId: string, items: BuildPlanItem[]): Promise<ConfirmedPlanDocumentValidation> {
  const blockers: string[] = [];
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId }, select: { id: true } });
  if (!tender) return { ok: false, blockers: ["Tender not found or not owned by actor."], exportReadyDocumentCount: 0 };

  const requiredItems = items.filter((item) => item.required);
  const requiredKeys = new Set(requiredItems.map(planItemKey));
  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: { id: true, name: true, documentType: true, exactFileName: true, exactOrder: true, format: true, fileContent: true, storagePath: true, generationStatus: true, validationStatus: true, reviewStatus: true },
  });
  let exportReadyDocumentCount = 0;
  const docsByKey = new Map<string, typeof docs>();
  for (const doc of docs) {
    const key = planItemKey({ exactFileName: doc.exactFileName ?? doc.name, exactOrder: doc.exactOrder ?? -1, documentType: doc.documentType });
    const bucket = docsByKey.get(key) ?? [];
    bucket.push(doc);
    docsByKey.set(key, bucket);
    if (!requiredKeys.has(key) && doc.generationStatus === "GENERATED") blockers.push(`Generated document ${doc.name} is not in the confirmed Build Plan.`);
  }

  for (const item of requiredItems) {
    const key = planItemKey(item);
    const matches = docsByKey.get(key) ?? [];
    const ready = matches.filter((doc) =>
      doc.generationStatus === "GENERATED" &&
      generatedDocumentHasContent(doc) &&
      ["VALIDATED", "APPROVED", "READY_FOR_EXPORT"].includes(doc.validationStatus) &&
      ["APPROVED", "READY_FOR_EXPORT", "REPLACE_WITH_ORIGINAL"].includes(doc.reviewStatus),
    );
    if (matches.length === 0) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is missing.`);
    if (matches.length > 1) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} has duplicate generated rows.`);
    if (matches.some((doc) => !generatedDocumentHasContent(doc))) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is empty.`);
    if (matches.length > 0 && ready.length !== 1) blockers.push(`Required plan file ${item.exactOrder} ${item.exactFileName} is not generated, validated, and approved for export.`);
    exportReadyDocumentCount += ready.length;
  }

  return { ok: blockers.length === 0, blockers, exportReadyDocumentCount };
}
