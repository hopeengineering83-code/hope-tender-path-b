import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled, isAIConfigured } from "../../../../lib/env-check";

export async function GET() {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  await prismaReady;

  // ── database connectivity ─────────────────────────────────────────────────
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  // ── company knowledge health ──────────────────────────────────────────────
  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    include: {
      experts: { select: { id: true, trustLevel: true, sourceDocumentId: true } },
      projects: { select: { id: true, trustLevel: true, sourceDocumentId: true } },
      documents: { select: { id: true, originalFileName: true, extractedText: true, aiExtractionStatus: true, aiExtractionError: true, category: true } },
    },
  });

  const experts = company?.experts ?? [];
  const projects = company?.projects ?? [];
  const docs = company?.documents ?? [];

  const expertsByTrust = {
    REVIEWED: experts.filter((e) => e.trustLevel === "REVIEWED").length,
    AI_DRAFT: experts.filter((e) => e.trustLevel === "AI_DRAFT").length,
    REGEX_DRAFT: experts.filter((e) => e.trustLevel === "REGEX_DRAFT").length,
  };
  const projectsByTrust = {
    REVIEWED: projects.filter((p) => p.trustLevel === "REVIEWED").length,
    AI_DRAFT: projects.filter((p) => p.trustLevel === "AI_DRAFT").length,
    REGEX_DRAFT: projects.filter((p) => p.trustLevel === "REGEX_DRAFT").length,
  };

  const docsWithText = docs.filter((d) => d.extractedText && d.extractedText.trim().length > 100).length;
  const docsNoText = docs.filter((d) => !d.extractedText || d.extractedText.trim().length <= 100).length;
  const docsAIExtracted = docs.filter((d) => d.aiExtractionStatus === "EXTRACTED").length;
  const docsAIFailed = docs.filter((d) => d.aiExtractionStatus === "FAILED").length;
  const docsAIPending = docs.filter((d) => d.aiExtractionStatus === "PENDING").length;

  // ── orphaned draft records (source doc deleted) ───────────────────────────
  const orphanedExperts = experts.filter((e) => e.sourceDocumentId && !docs.find((d) => d.id === e.sourceDocumentId)).length;
  const orphanedProjects = projects.filter((p) => p.sourceDocumentId && !docs.find((d) => d.id === p.sourceDocumentId)).length;

  // ── open compliance gaps by tender ───────────────────────────────────────
  const openGaps = await prisma.complianceGap.groupBy({
    by: ["tenderId", "severity"],
    where: { isResolved: false, tender: { userId: actor.id } },
    _count: { id: true },
  });

  const tenderIds = [...new Set(openGaps.map((g) => g.tenderId))];
  const tenders = await prisma.tender.findMany({
    where: { id: { in: tenderIds } },
    select: { id: true, title: true, status: true },
  });
  const tenderMap = new Map(tenders.map((t) => [t.id, t]));

  const gapSummary = tenderIds.map((tid) => ({
    tenderId: tid,
    tenderTitle: tenderMap.get(tid)?.title ?? "Unknown",
    tenderStatus: tenderMap.get(tid)?.status ?? "Unknown",
    critical: openGaps.filter((g) => g.tenderId === tid && g.severity === "CRITICAL").reduce((s, g) => s + g._count.id, 0),
    high: openGaps.filter((g) => g.tenderId === tid && g.severity === "HIGH").reduce((s, g) => s + g._count.id, 0),
    medium: openGaps.filter((g) => g.tenderId === tid && g.severity === "MEDIUM").reduce((s, g) => s + g._count.id, 0),
  }));

  // ── AI extraction failures detail ─────────────────────────────────────────
  const failedDocs = docs
    .filter((d) => d.aiExtractionStatus === "FAILED")
    .map((d) => ({ id: d.id, name: d.originalFileName, category: d.category, error: d.aiExtractionError }));

  // ── action items ──────────────────────────────────────────────────────────
  const actionItems: Array<{ severity: string; message: string }> = [];

  if (!dbOk) actionItems.push({ severity: "CRITICAL", message: `Database connection failed: ${dbError}` });
  if (!isAIConfigured()) actionItems.push({ severity: "HIGH", message: "GEMINI_API_KEY not set — AI extraction disabled. All records will be REGEX_DRAFT only and cannot be promoted to trusted status." });
  if (expertsByTrust.REVIEWED === 0 && experts.length > 0) actionItems.push({ severity: "HIGH", message: `${experts.length} expert(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (projectsByTrust.REVIEWED === 0 && projects.length > 0) actionItems.push({ severity: "HIGH", message: `${projects.length} project(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (docsNoText > 0) actionItems.push({ severity: "MEDIUM", message: `${docsNoText} document(s) have no extracted text. Run repair to re-extract.` });
  if (docsAIFailed > 0) actionItems.push({ severity: "MEDIUM", message: `${docsAIFailed} document(s) failed AI extraction. Run repair to retry.` });
  if (orphanedExperts > 0) actionItems.push({ severity: "LOW", message: `${orphanedExperts} expert draft(s) reference a deleted source document.` });
  if (orphanedProjects > 0) actionItems.push({ severity: "LOW", message: `${orphanedProjects} project draft(s) reference a deleted source document.` });
  if (gapSummary.some((g) => g.critical > 0)) actionItems.push({ severity: "HIGH", message: "One or more tenders have unresolved CRITICAL compliance gaps blocking generation." });

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    database: { ok: dbOk, error: dbError, url: (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]+@/, "://*****@") },
    ai: { enabled: isAIEnabled(), configured: isAIConfigured() },
    knowledge: {
      totalDocuments: docs.length,
      documentsWithText: docsWithText,
      documentsNoText: docsNoText,
      aiExtracted: docsAIExtracted,
      aiFailed: docsAIFailed,
      aiPending: docsAIPending,
      experts: expertsByTrust,
      projects: projectsByTrust,
      orphanedExperts,
      orphanedProjects,
    },
    failedDocuments: failedDocs,
    complianceGaps: gapSummary,
    actionItems,
  });
}
