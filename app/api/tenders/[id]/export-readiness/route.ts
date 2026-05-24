import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function nextActionForReason(reason: string): string {
  if (/NO_ACTIVE_GENERATED_DOCUMENTS/i.test(reason)) return "Generate the required documents before exporting.";
  if (/EXTRA_FILES|non-required file/i.test(reason)) return "Remove generated files that are outside the tender's exact required scope.";
  if (/FILE_ORDER|order does not match tender order/i.test(reason)) return "Reorder files to exactly match the tender-required submission sequence.";
  if (/SOURCE_REFERENCES_MISSING|lack source\/page\/quote traceability/i.test(reason)) return "Complete mandatory source grounding (source file/page/quote) before export.";
  if (/generationStatus/i.test(reason)) return "Regenerate this document or reconcile the submission plan.";
  if (/validationStatus/i.test(reason)) return "Run validation and fix reported document validation issues.";
  if (/reviewStatus/i.test(reason)) return "Complete human review and mark the document READY_FOR_EXPORT.";
  if (/fileContent|MISSING_CONTENT/i.test(reason)) return "Regenerate or upload the missing DOCX/PDF file content.";
  if (/AI\/meta-preparation trace|Placeholder|pricing language|inside DOCX visible text/i.test(reason)) return "Repair document hygiene issues (AI/meta traces, placeholders, or technical-envelope pricing leakage) and revalidate.";
  if (/MARKDOWN|QUICK_DRAFT|DRAFT_ONLY|CONTROL|NOT_EXPORTABLE|REPLACE_WITH_ORIGINAL|PLANNED|not a final export/i.test(reason)) return "Use Generate Docs or attach the tender-issued original; quick drafts, placeholders and control rows cannot be exported.";
  return "Review and resolve this blocker before final export.";
}

function severityForReasons(reasons: string[]): "HIGH" | "MEDIUM" | "LOW" {
  if (reasons.some((r) => /NO_ACTIVE_GENERATED_DOCUMENTS|fileContent|generationStatus|CONTROL|ORIGINAL_REQUIRED|PDF_CONVERSION_REQUIRED|NOT_EXPORTABLE|REPLACE_WITH_ORIGINAL|PLANNED|EXTRA_FILES|FILE_ORDER|SOURCE_REFERENCES_MISSING|AI\/meta-preparation trace|Placeholder|pricing language/i.test(r))) return "HIGH";
  if (reasons.some((r) => /validationStatus|reviewStatus|MARKDOWN|QUICK_DRAFT|DRAFT_ONLY/i.test(r))) return "MEDIUM";
  return "LOW";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Deduplicate by exactFileName: multiple active records with the same filename accumulate from
  // repeated generation runs that didn't supersede old records. Show one failure per logical file.
  const seenKeys = new Set<string>();
  const dedupedDocs = tender.generatedDocuments
    .slice()
    .sort((a, b) => (a.exactOrder ?? 9999) - (b.exactOrder ?? 9999))
    .filter((doc) => {
      const key = (doc.exactFileName ?? doc.name ?? "").trim().toLowerCase();
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

  const readiness = await checkFullExportReadiness({ tenderId: id, docs: dedupedDocs, requireFileContent: false });
  const documentBlockers = readiness.failures.map((failure) => ({
    ...failure,
    severity: severityForReasons(failure.reasons),
    nextActions: failure.reasons.map(nextActionForReason),
  }));
  const tenderLevelBlockers = readiness.tenderLevelBlockers ?? [];
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
        activeDocuments: tender.generatedDocuments.length,
        documentBlockers: documentBlockers.length,
        tenderLevelBlockers: tenderLevelBlockers.length,
        totalBlockers,
      },
      documentBlockers,
      tenderLevelBlockers,
      message: readiness.ok ? "Export gate passed. All active generated documents and tender-level controls are ready." : exportReadinessError(readiness.failures, tenderLevelBlockers),
    },
  });
}
