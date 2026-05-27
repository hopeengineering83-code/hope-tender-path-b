// Bulk Generated Proposal quality reassessment.
//
// Screenshot regression:
//   Many GeneratedDocument rows in production are marked
//   PASSED / APPROVED / READY_FOR_EXPORT even though the body is
//   one-paragraph generic methodology, contains "Bid-Team to confirm",
//   or contains AI traces. The quality gate (PR #481) prevents NEW
//   documents from being marked PASSED if they fail the gate. This
//   endpoint runs the gate retroactively over existing rows and
//   demotes APPROVED/READY_FOR_EXPORT rows that fail.
//
// Endpoint:
//   POST /api/admin/generated-proposals/reassess
//     body: { tenderId?: string; dryRun?: boolean; limit?: number }
//
//   - tenderId  → restrict to one tender (otherwise all tenders).
//   - dryRun=true → returns which rows WOULD be demoted, without writing.
//   - limit (default 200, max 1000)
//
// Auth: ADMIN only.
//
// Demotion rules (only ever DOWNGRADE — never silently upgrade a row):
//   - reviewStatus READY_FOR_EXPORT|APPROVED + gate FAILED → NEEDS_REWRITE,
//     reviewNotes appended with "[quality-gate] reassessment-<date>".
//   - validationStatus PASSED|VALIDATED + gate FAILED + reviewStatus not
//     already REPLACE_WITH_ORIGINAL/NOT_EXPORTABLE → also set
//     validationStatus to NEEDS_REVALIDATION so downstream gates re-run.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { assessGeneratedDocumentQuality } from "../../../../../lib/engine/document-quality-gate";
import { extractDocxVisibleText } from "../../../../../lib/engine/export-readiness";
import { isFinalExportCandidateDocument } from "../../../../../lib/engine/document-output-state";
import { buildSevenPassGateInput, summarizeSevenPassForReviewNotes } from "../../../../../lib/engine/seven-pass-generation-wiring";
import { evaluateSevenPassGenerationGate } from "../../../../../lib/engine/seven-pass-generation";
import { detectAnalysisSource } from "../../../../../lib/engine/analysis-source";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REVIEW_DEMOTABLE = new Set(["READY_FOR_EXPORT", "APPROVED", "PASSED"]);

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "REASSESS_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

type ReassessmentRow = {
  tenderId: string;
  documentId: string;
  documentName: string;
  exactFileName: string | null;
  priorReviewStatus: string;
  priorValidationStatus: string;
  qualityScore: number;
  qualityStatus: string;
  issues: string[];
  demoted: boolean;
  demotionReason: string | null;
};

export async function POST(req: Request) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    await prismaReady;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const tenderId = typeof body.tenderId === "string" ? body.tenderId : null;
    const dryRun = body.dryRun === true;
    const rawLimit = typeof body.limit === "number" ? body.limit : 200;
    const limit = Math.max(1, Math.min(1000, Number.isFinite(rawLimit) ? rawLimit : 200));

    const where = tenderId ? { tenderId } : {};
    const docs = await prisma.generatedDocument.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        tenderId: true,
        name: true,
        exactFileName: true,
        documentType: true,
        format: true,
        generationStatus: true,
        validationStatus: true,
        reviewStatus: true,
        fileContent: true,
        storagePath: true,
        reviewNotes: true,
      },
    });

    // ── Batch-load per-tender data (notes + evidence counts) ─────────────────
    // Collect all distinct tender IDs in the working set, then run three
    // aggregate queries — one for notes, one for reviewed expert matches, one
    // for reviewed project matches — so the loop below has O(1) cache lookups
    // instead of N+1 individual queries.
    const tenderIds = [...new Set(docs.map((d) => d.tenderId))];

    // Tender notes cache
    const tenderNotesCache = new Map<string, string | null>();
    if (tenderIds.length > 0) {
      const tenders = await prisma.tender.findMany({
        where: { id: { in: tenderIds } },
        select: { id: true, notes: true },
      });
      for (const t of tenders) tenderNotesCache.set(t.id, t.notes ?? null);
    }
    async function getTenderNotes(tid: string): Promise<string | null> {
      // Sync lookup after pre-load; fallback to DB only for IDs not in batch.
      if (tenderNotesCache.has(tid)) return tenderNotesCache.get(tid) ?? null;
      const t = await prisma.tender.findUnique({ where: { id: tid }, select: { notes: true } });
      const notes = t?.notes ?? null;
      tenderNotesCache.set(tid, notes);
      return notes;
    }

    // Reviewed evidence counts per tender — batch GROUP BY using groupBy
    type EvidenceCounts = { reviewedExperts: number; reviewedProjects: number };
    const evidenceCountCache = new Map<string, EvidenceCounts>();
    if (tenderIds.length > 0) {
      const [expertGroups, projectGroups] = await Promise.all([
        prisma.tenderExpertMatch.groupBy({
          by: ["tenderId"],
          where: { tenderId: { in: tenderIds }, isSelected: true, expert: { trustLevel: "REVIEWED" } },
          _count: { id: true },
        }),
        prisma.tenderProjectMatch.groupBy({
          by: ["tenderId"],
          where: { tenderId: { in: tenderIds }, isSelected: true, project: { trustLevel: "REVIEWED" } },
          _count: { id: true },
        }),
      ]);
      // Build map: initialise all tenderIds to 0
      for (const tid of tenderIds) evidenceCountCache.set(tid, { reviewedExperts: 0, reviewedProjects: 0 });
      for (const g of expertGroups) {
        const existing = evidenceCountCache.get(g.tenderId) ?? { reviewedExperts: 0, reviewedProjects: 0 };
        evidenceCountCache.set(g.tenderId, { ...existing, reviewedExperts: g._count.id });
      }
      for (const g of projectGroups) {
        const existing = evidenceCountCache.get(g.tenderId) ?? { reviewedExperts: 0, reviewedProjects: 0 };
        evidenceCountCache.set(g.tenderId, { ...existing, reviewedProjects: g._count.id });
      }
    }

    const rows: ReassessmentRow[] = [];
    let demotedCount = 0;
    let inspectedCount = 0;
    let skippedNonCandidateCount = 0;

    for (const doc of docs) {
      if (!isFinalExportCandidateDocument(doc)) {
        skippedNonCandidateCount += 1;
        continue;
      }
      inspectedCount += 1;
      const inline = typeof doc.fileContent === "string" && doc.fileContent.length < 2_000_000 ? doc.fileContent : null;
      let visible: string | null = null;
      if (inline) {
        visible = await extractDocxVisibleText(inline, doc.exactFileName ?? doc.name).catch(() => null);
        if (!visible) visible = inline; // plain-text fallback so the gate still scores
      }
      const report = assessGeneratedDocumentQuality({
        doc,
        visibleText: visible,
        rawFileContent: doc.fileContent,
        hasStoragePath: Boolean(doc.storagePath && doc.storagePath.length > 0),
      });
      const isFail = report.recommendedStatus === "QUALITY_FAILED" || report.recommendedStatus === "NEEDS_REWRITE";
      const priorReview = (doc.reviewStatus ?? "").toUpperCase();
      const priorValidation = (doc.validationStatus ?? "").toUpperCase();

      // ── Seven-pass gate: analysis-source check ───────────────────────────
      // The document quality gate already covers BID_TEAM_TO_CONFIRM,
      // AI_TRACE, PLACEHOLDER, PRICING_LEAKAGE. The supplemental check here
      // covers the analysis-source dimension that the quality gate cannot see:
      // if the tender used regex-fallback analysis, any READY_FOR_EXPORT row
      // produced from it must be demoted.
      const tenderNotes = await getTenderNotes(doc.tenderId);
      const evidenceCounts = evidenceCountCache.get(doc.tenderId) ?? { reviewedExperts: 0, reviewedProjects: 0 };
      const sevenPassInput = buildSevenPassGateInput({
        tenderNotes,
        visibleText: visible,
        documentType: doc.documentType,
        documentName: doc.name,
        exactFileName: doc.exactFileName,
        // Batch-loaded evidence counts: no N+1 per document
        reviewedExpertCount: evidenceCounts.reviewedExperts,
        reviewedProjectCount: evidenceCounts.reviewedProjects,
      });
      const sevenPassEval = evaluateSevenPassGenerationGate(sevenPassInput);
      const sevenPassFails = !sevenPassEval.finalApprovalAllowed;
      const sevenPassAnalysisBlock = sevenPassEval.passes.some((p) => p.id === "TENDER_COMPREHENSION" && p.status === "BLOCKED");

      // Only add the analysis-source demotion when it is the NEW trigger
      // (quality gate didn't already catch it) to avoid doubling the reason.
      const eligibleForQualityDemotion = isFail && REVIEW_DEMOTABLE.has(priorReview);
      const eligibleForAnalysisDemotion = sevenPassAnalysisBlock && REVIEW_DEMOTABLE.has(priorReview) && !eligibleForQualityDemotion;
      const eligibleForDemotion = eligibleForQualityDemotion || eligibleForAnalysisDemotion;

      const row: ReassessmentRow = {
        tenderId: doc.tenderId,
        documentId: doc.id,
        documentName: doc.name,
        exactFileName: doc.exactFileName,
        priorReviewStatus: doc.reviewStatus,
        priorValidationStatus: doc.validationStatus,
        qualityScore: report.score,
        qualityStatus: sevenPassFails ? `${report.recommendedStatus}+SEVEN_PASS_BLOCKED` : report.recommendedStatus,
        issues: [
          ...report.issues.map((i) => i.code),
          ...(sevenPassAnalysisBlock ? ["ANALYSIS_SOURCE_BLOCKED"] : []),
        ],
        demoted: false,
        demotionReason: null,
      };

      if (eligibleForDemotion) {
        if (eligibleForQualityDemotion) {
          row.demotionReason = `Quality gate ${report.recommendedStatus} (score ${report.score}/100; issues: ${report.issues.slice(0, 4).map((i) => i.code).join(", ") || "none"})`;
        } else {
          row.demotionReason = `Seven-pass gate: analysis source blocked. ${summarizeSevenPassForReviewNotes(sevenPassEval).slice(0, 200)}`;
        }
        if (!dryRun) {
          const noteSuffix = `\n[quality-gate] reassessment-${new Date().toISOString()}: demoted to NEEDS_REWRITE — ${row.demotionReason}`;
          const update: { reviewStatus: string; reviewNotes: string; validationStatus?: string } = {
            reviewStatus: "NEEDS_REWRITE",
            reviewNotes: ((doc.reviewNotes ?? "") + noteSuffix).slice(0, 4000),
          };
          if (priorValidation === "PASSED" || priorValidation === "VALIDATED") {
            update.validationStatus = "NEEDS_REVALIDATION";
          }
          await prisma.generatedDocument.update({ where: { id: doc.id }, data: update });
          row.demoted = true;
          demotedCount += 1;
        } else {
          row.demoted = true; // would-be demoted in dry-run mode
        }
      }

      rows.push(row);
    }

    if (!dryRun) {
      await logAction({
        userId: actor.id,
        action: "QUALITY_REASSESSMENT",
        entityType: tenderId ? "Tender" : "AllTenders",
        entityId: tenderId ?? "*",
        description: `Bulk reassessment: inspected ${inspectedCount}, demoted ${demotedCount} (skipped ${skippedNonCandidateCount} non-candidate row(s)).`,
      });
    }

    return NextResponse.json({
      success: true,
      dryRun,
      tenderId,
      summary: {
        inspected: inspectedCount,
        demoted: demotedCount,
        skippedNonCandidates: skippedNonCandidateCount,
      },
      rows,
    });
  } catch (error) {
    console.error("reassess route failed", error);
    return err("Bulk reassessment failed.", 500, { code: "REASSESS_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
