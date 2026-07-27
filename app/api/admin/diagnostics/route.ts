import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled, isAIConfigured } from "../../../../lib/env-check";

function sanitizeDiagnosticMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/(?:postgres(?:ql)?|mysql|mongodb|redis):\/\/[^\s"']+/gi, "[REDACTED_DSN]")
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED_KEY]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/password=([^\s&]+)/gi, "password=[REDACTED]")
    .replace(/user(name)?=([^\s&]+)/gi, "user$1=[REDACTED]")
    .slice(0, 240);
}

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
    dbError = sanitizeDiagnosticMessage(e instanceof Error ? e.message : String(e));
  }

  // ── company knowledge health ──────────────────────────────────────────────
  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    include: {
      experts: { where: { deletedAt: null }, select: { id: true, trustLevel: true, sourceDocumentId: true } },
      projects: { where: { deletedAt: null }, select: { id: true, trustLevel: true, sourceDocumentId: true } },
      documents: { select: { id: true, originalFileName: true, aiExtractionStatus: true, aiExtractionError: true, category: true } },
    },
  });

  const experts = company?.experts ?? [];
  const projects = company?.projects ?? [];
  const docs = company?.documents ?? [];
  const docTextMetrics = company ? await prisma.$queryRaw<Array<{ id: string; extractedTextLength: number }>>`
    SELECT id, COALESCE(char_length("extractedText"), 0)::int AS "extractedTextLength"
    FROM "CompanyDocument"
    WHERE "companyId" = ${company.id}
  ` : [];
  const docTextLengthById = new Map(docTextMetrics.map((doc) => [doc.id, doc.extractedTextLength]));

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

  const docsWithText = docs.filter((d) => (docTextLengthById.get(d.id) ?? 0) > 100).length;
  const docsNoText = docs.filter((d) => (docTextLengthById.get(d.id) ?? 0) <= 100).length;
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
    .map((d) => ({ id: d.id, name: d.originalFileName, category: d.category, error: sanitizeDiagnosticMessage(d.aiExtractionError) }));

  // ── action items ──────────────────────────────────────────────────────────
  const actionItems: Array<{ severity: string; message: string }> = [];

  if (!dbOk) actionItems.push({ severity: "CRITICAL", message: "Database connection failed. Check DATABASE_URL/Neon connectivity in Vercel; raw database diagnostics are intentionally hidden." });
  if (!isAIConfigured()) actionItems.push({ severity: "HIGH", message: "No AI provider key set. Configure OPENAI_API_KEY, GEMINI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY. AI extraction is disabled; all records will be REGEX_DRAFT only and cannot be promoted to trusted status." });
  if (expertsByTrust.REVIEWED === 0 && experts.length > 0) actionItems.push({ severity: "HIGH", message: `${experts.length} expert(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (projectsByTrust.REVIEWED === 0 && projects.length > 0) actionItems.push({ severity: "HIGH", message: `${projects.length} project(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (docsNoText > 0) actionItems.push({ severity: "MEDIUM", message: `${docsNoText} document(s) have no extracted text. Run repair to re-extract.` });
  if (docsAIFailed > 0) actionItems.push({ severity: "MEDIUM", message: `${docsAIFailed} document(s) failed AI extraction. Run repair to retry.` });
  if (orphanedExperts > 0) actionItems.push({ severity: "LOW", message: `${orphanedExperts} expert draft(s) reference a deleted source document.` });
  if (orphanedProjects > 0) actionItems.push({ severity: "LOW", message: `${orphanedProjects} project draft(s) reference a deleted source document.` });
  if (gapSummary.some((g) => g.critical > 0)) actionItems.push({ severity: "HIGH", message: "One or more tenders have unresolved CRITICAL compliance gaps blocking generation." });

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    database: { ok: dbOk, error: dbError ? "Database connectivity check failed; details redacted." : null },
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
