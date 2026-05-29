import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { extractRequestId } from "../../../../../../lib/request-id";
import { buildSubmissionPlan, hasExplicitSubmissionScope, plannedSubmissionTargetFiles, type SubmissionPlanFile } from "../../../../../../lib/engine/submission-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function documentTypeFor(file: SubmissionPlanFile): string {
  const label = `${file.exactFileName} ${file.documentType}`.toLowerCase();
  if (/technical[-\s_]*proposal|methodology|technical approach/.test(label)) return "TECHNICAL_PROPOSAL";
  if (/financial|price|commercial/.test(label)) return "FINANCIAL_PROPOSAL";
  if (/expert|cv|personnel|staff/.test(label)) return "EXPERT_CV_PACKAGE";
  if (/project|experience|reference/.test(label)) return "PROJECT_REFERENCE_PACKAGE";
  if (/form|declaration|annex|schedule|certificate|compliance/.test(label)) return "FORM_OR_ANNEX";
  return file.documentType || "TENDER_REQUIRED_FILE";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true } });
  if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });
  if (tender.requirements.length === 0) {
    return NextResponse.json({ ok: false, code: "NO_REQUIREMENTS", error: "Run AI Analyze / Run Engine before building a submission plan.", nextAction: "RUN_AI_ANALYZE" }, { status: 422 });
  }

  const explicitSubmissionScope = hasExplicitSubmissionScope(tender);
  const plan = buildSubmissionPlan({ id: tender.id, title: tender.title, exactFileNaming: tender.exactFileNaming, exactFileOrder: tender.exactFileOrder, pageLimit: tender.pageLimit, requirements: tender.requirements });
  const plannedFiles = explicitSubmissionScope ? plannedSubmissionTargetFiles(plan) : [];
  if (!explicitSubmissionScope || plannedFiles.length === 0) {
    return NextResponse.json({ ok: false, code: "NO_EXPLICIT_SUBMISSION_PLAN", error: "No explicit tender submission plan was detected. Repair submission rules/source extraction first.", nextAction: "REPAIR_SOURCE_REFERENCES" }, { status: 422 });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const file of plannedFiles) {
    const exactFileName = file.exactFileName?.trim();
    if (!exactFileName) continue;
    const existing = await prisma.generatedDocument.findFirst({ where: { tenderId: id, exactFileName, generationStatus: { not: "SUPERSEDED" } }, select: { id: true, generationStatus: true, fileContent: true, storagePath: true } });
    const contentSummary = `Planned tender-required file from explicit submission plan. Source requirements: ${file.sourceRequirementIds.join(", ") || "exact file naming/order instruction"}.`;
    if (!existing) {
      await prisma.generatedDocument.create({ data: { tenderId: id, name: exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""), documentType: documentTypeFor(file), format: file.format || "DOCX", exactFileName, exactOrder: file.exactOrder, generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING", contentSummary } });
      created += 1;
    } else if (existing.generationStatus === "GENERATED" && (existing.fileContent || existing.storagePath)) {
      unchanged += 1;
    } else {
      await prisma.generatedDocument.update({ where: { id: existing.id }, data: { documentType: documentTypeFor(file), format: file.format || "DOCX", exactOrder: file.exactOrder, generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING", contentSummary, updatedAt: new Date() } });
      updated += 1;
    }
  }

  await logAction({ userId: actor.id, action: "SUBMISSION_PLAN_BUILT", entityType: "Tender", entityId: id, description: `Built explicit submission plan for ${plannedFiles.length} tender-required file(s).`, metadata: { plannedTargetCount: plannedFiles.length, created, updated, unchanged }, requestId });
  return NextResponse.json({ ok: true, success: true, explicitSubmissionScope, plannedTargetCount: plannedFiles.length, created, updated, unchanged });
}
