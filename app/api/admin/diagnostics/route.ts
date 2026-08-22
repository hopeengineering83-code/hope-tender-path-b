import { NextResponse } from "next/server";
import { redactSecrets } from "@/lib/sanitize-error";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { isAIEnabled, isAIConfigured, hasOnlyUnreachableProviderKeys } from "../../../../lib/env-check";
import { detailedLivenessPayload } from "../../../../lib/liveness";

function sanitizeDiagnosticMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  // Key and DSN redaction is delegated to the shared redactor. The four
  // patterns that used to be inlined here covered sk-, AIza, Bearer and DSNs,
  // missing Groq's gsk_, Cerebras' csk_, DeepSeek's dsk- and Google's newer AQ
  // format — every one of which this deployment uses. Connection-string
  // credentials given as query parameters are kept locally, since they are not
  // provider keys.
  return redactSecrets(value)
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
  if (!isAIConfigured()) {
    // Two different situations, and they need opposite actions. Telling an
    // operator who already holds five keys that "no AI provider key is set"
    // sends them looking for something that is right in front of them.
    actionItems.push(
      hasOnlyUnreachableProviderKeys()
        ? {
            severity: "HIGH",
            message:
              "AI provider keys are set, but none of them currently resolves to a usable provider — a key may be invalid, or its model may not be configured (OpenRouter and Groq have no model default, so they need one set explicitly). Check the provider diagnostics for the exact per-provider reason. Until one provider is usable, AI extraction is disabled and all records remain REGEX_DRAFT, which cannot be promoted to trusted status.",
          }
        : {
            severity: "HIGH",
            message:
              "No AI provider key is set. Configure at least one of the ten providers in the fallback chain — for example GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY. AI extraction is disabled; all records will be REGEX_DRAFT only and cannot be promoted to trusted status.",
          },
    );
  }
  if (expertsByTrust.REVIEWED === 0 && experts.length > 0) actionItems.push({ severity: "HIGH", message: `${experts.length} expert(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (projectsByTrust.REVIEWED === 0 && projects.length > 0) actionItems.push({ severity: "HIGH", message: `${projects.length} project(s) imported but none reviewed. Proposals will use unverified draft data.` });
  if (docsNoText > 0) actionItems.push({ severity: "MEDIUM", message: `${docsNoText} document(s) have no extracted text. Run repair to re-extract.` });
  if (docsAIFailed > 0) actionItems.push({ severity: "MEDIUM", message: `${docsAIFailed} document(s) failed AI extraction. Run repair to retry.` });
  if (orphanedExperts > 0) actionItems.push({ severity: "LOW", message: `${orphanedExperts} expert draft(s) reference a deleted source document.` });
  if (orphanedProjects > 0) actionItems.push({ severity: "LOW", message: `${orphanedProjects} project draft(s) reference a deleted source document.` });
  if (gapSummary.some((g) => g.critical > 0)) actionItems.push({ severity: "HIGH", message: "One or more tenders have unresolved CRITICAL compliance gaps blocking generation." });

  // Full runtime topology (provider order, storage provider, effective tuning
  // limits, deployment identifiers). This used to be served to anonymous
  // callers by the public /api/health endpoint; it is admin-only now. Failure
  // to compute it must not take down the rest of the diagnostics view.
  const runtime = await detailedLivenessPayload().catch(() => null);

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    runtime,
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
