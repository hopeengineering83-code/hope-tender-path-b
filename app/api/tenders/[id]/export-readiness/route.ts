import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments } from "../../../../../lib/engine/document-output-state";
import { getFinalSubmissionReadiness } from "../../../../../lib/engine/final-submission-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "EXPORT_READINESS_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

function nextActionForReason(reason: string): string {
  if (/ORIGINAL_REQUIRED|REPLACE_WITH_ORIGINAL|tender-issued original/i.test(reason)) {
    return "Attach or upload the exact tender-issued original form/template for this file. Do not use Repair safe document gaps for official-original rows.";
  }
  if (/NOT_EXPORTABLE/i.test(reason)) {
    return "Manual review required: this row is marked NOT_EXPORTABLE and must not be included in the final package unless replaced by the official source file.";
  }
  if (/PLANNED|CONTROL_RECORD_ONLY|control, placeholder, or text-only/i.test(reason)) {
    return "Generate the actual final file or attach the official original. Planned/control rows are not exportable files.";
  }
  if (/PDF_CONVERSION_REQUIRED|not a real PDF/i.test(reason)) {
    return "Upload the final PDF required by the tender or provide a real PDF file before export.";
  }
  if (/NO_ACTIVE_GENERATED_DOCUMENTS/i.test(reason)) return "Generate the required documents before exporting.";
  if (/generationStatus/i.test(reason)) return "Regenerate this document or reconcile the submission plan.";
  if (/validationStatus/i.test(reason)) return "Run validation and fix reported document validation issues.";
  if (/reviewStatus/i.test(reason)) return "Complete human review and mark the document READY_FOR_EXPORT.";
  if (/fileContent|MISSING_CONTENT/i.test(reason)) return "Regenerate or upload the missing DOCX/PDF file content.";
  if (/MARKDOWN|QUICK_DRAFT|DRAFT_ONLY|CONTROL|not a final export/i.test(reason)) return "Use Generate Docs or attach the tender-issued original; quick drafts, placeholders and control rows cannot be exported.";
  return "Review and resolve this blocker before final export.";
}

function severityForReasons(reasons: string[]): "HIGH" | "MEDIUM" | "LOW" {
  if (reasons.some((r) => /NO_ACTIVE_GENERATED_DOCUMENTS|fileContent|generationStatus|CONTROL|ORIGINAL_REQUIRED|PDF_CONVERSION_REQUIRED|NOT_EXPORTABLE|REPLACE_WITH_ORIGINAL|PLANNED/i.test(r))) return "HIGH";
  if (reasons.some((r) => /validationStatus|reviewStatus|MARKDOWN|QUICK_DRAFT|DRAFT_ONLY/i.test(r))) return "MEDIUM";
  return "LOW";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;
    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        id: true,
        title: true,
        status: true,
        stage: true,
        readinessScore: true,
        generatedDocuments: {
          where: { generationStatus: { not: "SUPERSEDED" } },
          orderBy: [{ exactOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            name: true,
            exactFileName: true,
            exactOrder: true,
            documentType: true,
            format: true,
            generationStatus: true,
            validationStatus: true,
            reviewStatus: true,
            fileContent: true,
            storagePath: true,
          },
        },
      },
    });

    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const finalCandidateDocs = filterFinalExportCandidateDocuments(tender.generatedDocuments);

    const seenKeys = new Set<string>();
    const dedupedDocs = finalCandidateDocs
      .slice()
      .sort((a, b) => (a.exactOrder ?? 9999) - (b.exactOrder ?? 9999))
      .filter((doc) => {
        const key = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

    const canonical = await getFinalSubmissionReadiness(id);
    if (!canonical) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });
    const readiness = await checkFullExportReadiness({ tenderId: id, docs: dedupedDocs, requireFileContent: true });
    const documentBlockers = readiness.failures.map((failure) => ({
      ...failure,
      severity: severityForReasons(failure.reasons),
      nextActions: Array.from(new Set(failure.reasons.map(nextActionForReason))),
    }));
    const tenderLevelBlockers = readiness.tenderLevelBlockers ?? [];
    const advisoryWarnings = readiness.advisoryWarnings ?? [];
    const totalBlockers = documentBlockers.length + tenderLevelBlockers.length;

    return NextResponse.json({
      success: true,
      exportReadiness: {
        ok: readiness.ok,
        tender: {
          id: tender.id,
          title: tender.title,
          status: tender.status,
          stage: tender.stage,
          readinessScore: tender.readinessScore ?? 0,
        },
        summary: {
          activeDocuments: canonical.summary.finalExportCandidates,
          workspaceDocuments: canonical.summary.workspaceDocuments,
          excludedInternalDrafts: canonical.summary.excludedInternalRows,
          documentBlockers: documentBlockers.length,
          tenderLevelBlockers: tenderLevelBlockers.length,
          advisoryWarnings: advisoryWarnings.length,
          totalBlockers,
          missingContentCount: canonical.summary.missingContentCount,
          planStatus: canonical.summary.planStatus,
        },
        documentBlockers,
        tenderLevelBlockers,
        advisoryWarnings,
        message: readiness.ok ? "Export gate passed. All final-package documents and tender-level controls are ready." : exportReadinessError(readiness.failures, tenderLevelBlockers),
      },
    });
  } catch (error) {
    console.error("Export readiness route failed", error);
    return jsonError("Export-readiness route failed.", 500, {
      code: "EXPORT_READINESS_RUNTIME_ERROR",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
