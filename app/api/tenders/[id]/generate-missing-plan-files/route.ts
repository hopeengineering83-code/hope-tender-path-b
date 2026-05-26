import { NextResponse } from "next/server";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { buildSubmissionPlan, findMissingGeneratedDocuments } from "../../../../../lib/engine/submission-plan";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function clean(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function para(text: string, bold = false) {
  return new Paragraph({ children: [new TextRun({ text: clean(text), bold, size: 22, font: "Calibri" })], spacing: { after: 120, line: 276 } });
}

function heading(text: string) {
  return new Paragraph({ text: clean(text), heading: HeadingLevel.HEADING_1, spacing: { before: 260, after: 140 } });
}

function bullet(text: string) {
  return new Paragraph({ text: clean(text), bullet: { level: 0 }, spacing: { after: 80, line: 260 } });
}

function documentTypeFor(fileName: string, fallback: string) {
  const label = fileName.toLowerCase();
  if (/financial|audited|capacity|bank|turnover/.test(label)) return "FINANCIAL_EVIDENCE";
  if (/legal|eligibility|registration|licen[cs]ing|tax|certificate/.test(label)) return "LEGAL_EVIDENCE";
  if (/form|template/.test(label)) return "FORM_OR_TEMPLATE";
  if (/submission|deadline|delivery|method|rules/.test(label)) return "SUBMISSION_RULES";
  return fallback || "TENDER_REQUIRED_FILE";
}

function needsOriginalReplacement(fileName: string, documentType: string) {
  const label = `${fileName} ${documentType}`.toLowerCase();
  return /form|template|annex\s*[a-z0-9]+\s*\(?official\)?/.test(label);
}

async function replacementControlContent(tenderTitle: string, fileName: string, replaceWithOriginal: boolean) {
  const children: Paragraph[] = [
    para(fileName, true),
    para(`Tender: ${tenderTitle}`),
    heading(replaceWithOriginal ? "Replacement control" : "Generated support control"),
  ];
  if (replaceWithOriginal) {
    children.push(
      bullet("DO NOT SUBMIT this generated control document as the final tender attachment."),
      bullet("Replace this record with the tender-issued original, signed/stamped/certified document, or verified source evidence before final export."),
      bullet("Keep the exact tender-required file name and order when replacing the file."),
    );
  } else {
    children.push(
      bullet("This package item was created from the tender submission plan so the missing file is visible in the generated document register."),
      bullet("Review and replace or complete this support document before final export if the tender requires a prescribed original/template."),
    );
  }
  const buffer = await Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
  return buffer.toString("base64");
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = rateLimit(`generate-missing-plan-files:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json({ success: false, ok: false, code: "RATE_LIMITED", error: "Too many missing-plan generation requests. Wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({
    where: { id, userId: actor.id },
    include: {
      requirements: true,
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: { id: true, name: true, exactFileName: true, documentType: true, format: true, exactOrder: true, generationStatus: true, fileContent: true },
      },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });

  const plan = buildSubmissionPlan({
    id: tender.id,
    title: tender.title,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    pageLimit: tender.pageLimit,
    requirements: tender.requirements,
  });
  const missing = findMissingGeneratedDocuments(plan, tender.generatedDocuments);
  if (missing.length === 0) {
    await logAction({ userId: actor.id, action: "DOCUMENT_GENERATE", entityType: "Tender", entityId: id, description: `${actor.email} checked missing planned files for "${tender.title}"; none were missing.`, metadata: { tenderId: id, created: 0, updated: 0 }, requestId });
    return NextResponse.json({ success: true, created: 0, message: "No missing planned files remain." });
  }

  const created: string[] = [];
  const updated: string[] = [];
  for (const file of missing) {
    const documentType = documentTypeFor(file.exactFileName, file.documentType);
    const replaceWithOriginal = needsOriginalReplacement(file.exactFileName, documentType);
    const isSubmissionRules = documentType === "SUBMISSION_RULES" || /submission formatting|packaging rules|submission rules|delivery instruction/i.test(file.exactFileName);
    const fileContent = await replacementControlContent(tender.title, file.exactFileName, replaceWithOriginal);
    const existing = await prisma.generatedDocument.findFirst({ where: { tenderId: id, exactFileName: file.exactFileName }, select: { id: true } });
    const data = {
      name: file.exactFileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
      documentType,
      format: replaceWithOriginal || isSubmissionRules ? "CONTROL" : file.format,
      exactFileName: file.exactFileName,
      exactOrder: file.exactOrder,
      fileContent,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: isSubmissionRules ? "NOT_EXPORTABLE" : (replaceWithOriginal ? "REPLACE_WITH_ORIGINAL" : "PENDING"),
      reviewNotes: isSubmissionRules
        ? "Submission formatting/packaging rules are internal control metadata and are excluded from export."
        : (replaceWithOriginal ? "DO NOT SUBMIT this generated placeholder. Replace it with the tender-issued original / signed / stamped / certified document before final export." : "Review this generated support control document before final export."),
      contentSummary: replaceWithOriginal
        ? `Replacement-control record for tender-required file ${file.exactFileName}. This internal control record is intentionally non-final and must be replaced with the original before export.`
        : `Generated support-control record for tender-required file ${file.exactFileName}. Review before final export.`,
      updatedAt: new Date(),
    };
    if (existing) {
      await prisma.generatedDocument.update({ where: { id: existing.id }, data });
      updated.push(file.exactFileName);
    } else {
      await prisma.generatedDocument.create({ data: { tenderId: id, ...data } });
      created.push(file.exactFileName);
    }
  }

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_GENERATE",
    entityType: "Tender",
    entityId: id,
    description: `${actor.email} generated ${created.length} and updated ${updated.length} missing planned file control record(s) for "${tender.title}".`,
    metadata: { tenderId: id, createdCount: created.length, updatedCount: updated.length, created, updated, warning: "Replacement-control documents are not final submission evidence." },
    requestId,
  });

  return NextResponse.json({
    success: true,
    created: created.length,
    updated: updated.length,
    files: { created, updated },
    warning: "Replacement-control documents are not final submission evidence. Replace originals before export where reviewStatus is REPLACE_WITH_ORIGINAL.",
  });
}
