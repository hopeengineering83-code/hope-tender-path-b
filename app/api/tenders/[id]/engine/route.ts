import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runTenderEngine, type EngineRunOptions } from "../../../../../lib/engine/run-tender-engine";
import { assessExtractionQuality } from "../../../../../lib/extraction-quality";
import { actionableEngineError } from "../../../../../lib/engine/actionable-engine-error";
import { enqueueJob } from "../../../../../lib/ai-jobs";
import { computeStoredMetadataPatch, listInvalidStoredFields } from "../../../../../lib/engine/sanitize-stored-metadata";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function requestDiagnosticId() {
  return `eng_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function enginePostconditions(tenderId: string) {
  const [expertRequirementExists, projectRequirementExists, requirementCount, expertMatches, projectMatches, selectedReviewedExperts, selectedReviewedProjects, complianceRows] = await Promise.all([
    prisma.tenderRequirement.count({ where: { tenderId, requirementType: "EXPERT" } }),
    prisma.tenderRequirement.count({ where: { tenderId, requirementType: "PROJECT_EXPERIENCE" } }),
    prisma.tenderRequirement.count({ where: { tenderId } }),
    prisma.tenderExpertMatch.count({ where: { tenderId } }),
    prisma.tenderProjectMatch.count({ where: { tenderId } }),
    prisma.tenderExpertMatch.count({ where: { tenderId, isSelected: true, expert: { trustLevel: "REVIEWED" } } }),
    prisma.tenderProjectMatch.count({ where: { tenderId, isSelected: true, project: { trustLevel: "REVIEWED" } } }),
    prisma.complianceMatrix.count({ where: { tenderId } }),
  ]);
  const blockers: string[] = [];
  if (requirementCount === 0) blockers.push("NO_REQUIREMENTS_PERSISTED");
  if (expertRequirementExists > 0 && expertMatches === 0) blockers.push("ENGINE_RAN_ZERO_EXPERT_MATCHES");
  if (projectRequirementExists > 0 && projectMatches === 0) blockers.push("ENGINE_RAN_ZERO_PROJECT_MATCHES");
  if (expertRequirementExists > 0 && selectedReviewedExperts === 0) blockers.push("NO_SELECTED_REVIEWED_EXPERTS_AFTER_ENGINE");
  if (projectRequirementExists > 0 && selectedReviewedProjects === 0) blockers.push("NO_SELECTED_REVIEWED_PROJECTS_AFTER_ENGINE");
  if (requirementCount > 0 && complianceRows === 0) blockers.push("ENGINE_RAN_ZERO_EVIDENCE_ROWS");
  return { blockers, counts: { expertRequirementExists, projectRequirementExists, requirementCount, expertMatches, projectMatches, selectedReviewedExperts, selectedReviewedProjects, complianceRows } };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const diagnosticId = requestDiagnosticId();
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized. Sign in again before running the tender engine.", code: "UNAUTHORIZED", nextAction: "LOGIN_AGAIN", diagnosticId }, { status: 401 });

  try {
    await prismaReady;
    const { id } = await params;
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "true";
    const isAsync = url.searchParams.get("async") === "true";
    const isSafe = url.searchParams.get("safe") === "true";
    const skipAiRematch = url.searchParams.get("skipAiRematch") === "true";
    const maxCharsRaw = Number(url.searchParams.get("maxChars"));
    const maxChars = Number.isFinite(maxCharsRaw) && maxCharsRaw >= 1000 ? maxCharsRaw : undefined;
    const tender = await prisma.tender.findFirst({ where: { id, userId }, include: { files: { select: { id: true, originalFileName: true, fileName: true, extractedText: true } } } });
    if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND", diagnosticId }, { status: 404 });

    const totalChars = tender.files.reduce((s, f) => s + (f.extractedText?.length ?? 0), 0);
    const inputStats = { fileCount: tender.files.length, totalChars, safeModeAvailable: true };

    if (tender.files.length === 0) return NextResponse.json({ error: "Engine run blocked: no tender file is uploaded.", code: "NO_TENDER_FILES", nextAction: "UPLOAD_TENDER_DOCUMENT", hint: "Upload the tender/RFP document first, then run AI Analyze or Run Engine.", diagnosticId, inputStats }, { status: 422 });

    const invalidFields = listInvalidStoredFields(tender);
    if (invalidFields.length > 0) {
      const patch = computeStoredMetadataPatch(tender);
      await prisma.tender.update({ where: { id: tender.id }, data: patch });
      console.warn(`[engine] tender=${tender.id} sanitised ${invalidFields.length} invalid stored field(s) before run: ${invalidFields.join(", ")}`);
      for (const field of invalidFields) (tender as Record<string, unknown>)[field] = null;
    }

    const extractionReports = tender.files.map((file) => ({ fileName: file.originalFileName || file.fileName, quality: assessExtractionQuality(file.extractedText, file.originalFileName || file.fileName) }));
    const blockers = extractionReports.filter((item) => item.quality.severity === "FAILED" || item.quality.severity === "POOR");
    if (!force && blockers.length > 0) return NextResponse.json({ error: "Engine run blocked: one or more tender files have poor extraction quality.", code: "EXTRACTION_NOT_READY", nextAction: "OPEN_EXTRACTION_QUALITY", blockers, hint: "Re-import/OCR/review the file, or retry with ?force=true only when you intentionally accept degraded analysis quality.", diagnosticId }, { status: 422 });

    if (isAsync) {
      const activeJob = await prisma.aiJob.findFirst({ where: { userId, tenderId: id, jobType: "ENGINE_RUN", status: { in: ["QUEUED", "RUNNING"] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
      if (activeJob) return NextResponse.json({ success: true, async: true, reusedExistingJob: true, jobId: activeJob.id, jobStatus: activeJob.status, diagnosticId, message: "An engine run is already queued or running for this tender. Reusing the existing job." }, { status: 202 });
      const { id: jobId } = await enqueueJob({ userId, tenderId: id, jobType: "ENGINE_RUN", input: { safe: isSafe, skipAiRematch, ...(maxChars ? { maxChars } : {}) } });
      return NextResponse.json({ success: true, async: true, jobId, diagnosticId, inputStats, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"), message: "Engine run queued. Next step: POST /api/ai-jobs/run-next to start the worker, then poll GET /api/ai-jobs/[jobId] for status." }, { status: 202 });
    }

    const engineOptions: EngineRunOptions = { safe: isSafe, skipAiRematch, maxChars };
    const result = await runTenderEngine(id, userId, undefined, engineOptions);
    const postconditions = await enginePostconditions(id);
    if (postconditions.blockers.length > 0) {
      return NextResponse.json({
        success: false,
        async: false,
        tender: result,
        code: "ENGINE_COMPLETED_WITH_BLOCKERS",
        failedStage: "POSTCONDITION_VALIDATION",
        nextAction: "REVIEW_MATCHING_INPUTS",
        blockers: postconditions.blockers,
        counts: postconditions.counts,
        extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"),
        diagnosticId,
      }, { status: 422 });
    }
    return NextResponse.json({ success: true, async: false, tender: result, extractionWarnings: extractionReports.filter((item) => item.quality.severity === "WARNING"), inputStats, diagnosticId });
  } catch (error) {
    console.error("Engine run failed:", { diagnosticId, error });
    const mapped = actionableEngineError(error);
    return NextResponse.json({ ...mapped.body, diagnosticId }, { status: mapped.status });
  }
}
