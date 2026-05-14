import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableBorders, TableCell, TableRow, TextRun, WidthType } from "docx";
import { logAction } from "../../../../../lib/audit";
import { buildSubmissionPlan, findExtraGeneratedDocuments, findMissingGeneratedDocuments, hasExplicitSubmissionScope, plannedSubmissionTargetFiles } from "../../../../../lib/engine/submission-plan";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, checkFullExportReadiness, exportReadinessError } from "../../../../../lib/engine/export-readiness";
import { getCompanyIngestionReadiness } from "../../../../../lib/company-ingestion-readiness";
import { computeWinProbability } from "../../../../../lib/engine/win-probability";

function safeParseArr(v: unknown): string[] {
  try {
    const parsed = JSON.parse(v as string);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch { return []; }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

function visibleXmlText(xml: string): string {
  return xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function validateGeneratedDocx(doc: {
  id: string;
  name: string;
  exactFileName: string | null;
  generationStatus: string;
  validationStatus: string;
  fileContent: string | null;
  draftExpertCount: number | null;
  draftProjectCount: number | null;
  reviewedExpertCount: number | null;
  reviewedProjectCount: number | null;
}) {
  const errors: string[] = [];
  const filename = doc.exactFileName ?? generatedFileName(doc.name);

  if (doc.generationStatus !== "GENERATED") errors.push("Document is not generated.");
  if (!doc.fileContent) errors.push("Document file content is missing.");
  if (!filename.toLowerCase().endsWith(".docx")) errors.push("Generated document is not DOCX.");
  if ((doc.draftExpertCount ?? 0) > 0 || (doc.draftProjectCount ?? 0) > 0) errors.push("Document references draft/unreviewed sources.");

  let text = "";
  if (doc.fileContent) {
    try {
      const buffer = Buffer.from(doc.fileContent, "base64");
      if (buffer.length < 500) errors.push("DOCX file is unexpectedly small.");
      if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) errors.push("DOCX package signature is invalid.");

      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const documentXml = await zip.file("word/document.xml")?.async("string");
      if (!documentXml) {
        errors.push("DOCX word/document.xml is missing.");
      } else {
        text = visibleXmlText(documentXml);
        if (text.length < 100) errors.push("Document text is too short for final submission.");
      }
    } catch (error) {
      errors.push(`DOCX validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const forbiddenPatterns = [
    /AI_DRAFT/i,
    /REGEX_DRAFT/i,
    /remove before submission/i,
    /\[\s*(?:INSERT|TBD|TBA|TODO|FILL[-_\s]*IN|PLACEHOLDER|YOUR\s+\w+\s+HERE|DATE|NAME|CLIENT|VALUE|AMOUNT)\b[^\]]*\]/i,
    /sample text/i,
    /lorem ipsum/i,
    /as an AI/i,
    /AI-generated/i,
    /source snippet/i,
    /deterministic safety import/i,
    /=+\s*PAGE\s+\d+\s*=+/i,
    /PARSED TEXT FOR PAGE/i,
    /Company evidence available:/i,
    /Project evidence available:/i,
  ];
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text) || pattern.test(doc.name) || pattern.test(filename)) {
      errors.push(`Forbidden final-output trace detected: ${pattern.source}`);
    }
  }

  const status = errors.length === 0 ? "VALIDATED" : "FAILED";
  if (doc.validationStatus !== status) {
    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: {
        validationStatus: status,
        reviewNotes: errors.length > 0 ? errors.join("\n") : "Passed deterministic final export validation.",
      },
    });
  }

  return { ok: errors.length === 0, errors, filename };
}

async function validateDocsForExport(docs: Array<{
  id: string;
  name: string;
  exactFileName: string | null;
  generationStatus: string;
  validationStatus: string;
  fileContent: string | null;
  draftExpertCount: number | null;
  draftProjectCount: number | null;
  reviewedExpertCount: number | null;
  reviewedProjectCount: number | null;
}>) {
  const failures: Array<{ id: string; name: string; errors: string[] }> = [];
  for (const doc of docs) {
    const result = await validateGeneratedDocx(doc);
    if (!result.ok) failures.push({ id: doc.id, name: doc.name, errors: result.errors });
  }
  return failures;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  await prismaReady;
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "proposal";
  const docId = searchParams.get("docId");

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    include: {
      requirements: true,
      complianceGaps: true,
      generatedDocuments: true,
      exportPackages: true,
      // Needed for win probability report in ZIP
      expertMatches: { where: { isSelected: true }, include: { expert: { select: { disciplines: true, sectors: true, yearsExperience: true } } } },
      projectMatches: { where: { isSelected: true }, include: { project: { select: { sectors: true, contractValue: true } } } },
    },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const company = await prisma.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return NextResponse.json({ error: "Company profile required before download." }, { status: 422 });
  const ingestion = await getCompanyIngestionReadiness(company.id, { requireDocuments: true, requireReviewedExperts: tender.requirements.some((r) => r.requirementType === "EXPERT"), requireReviewedProjects: tender.requirements.some((r) => r.requirementType === "PROJECT_EXPERIENCE") });
  if (!ingestion.ingestionReady) return NextResponse.json({ error: "Export blocked: company knowledge ingestion is not ready.", code: "INGESTION_NOT_READY", blockers: ingestion.blockers, totals: ingestion.totals }, { status: 422 });

  const blockingGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL");
  if ((docId || type === "zip") && blockingGaps.length > 0) {
    return NextResponse.json({ error: "Final export blocked by unresolved CRITICAL compliance gaps", reasons: blockingGaps.map((g) => g.title) }, { status: 409 });
  }

  const untracedMandatoryRequirements = tender.requirements.filter((req) => req.priority === "MANDATORY" && ((req.sourceConfidence ?? 0) <= 0));
  if ((docId || type === "zip") && untracedMandatoryRequirements.length > 0) {
    return NextResponse.json({ error: `Final export blocked: ${untracedMandatoryRequirements.length} mandatory requirement(s) are not source-grounded yet.`, code: "UNTRACED_MANDATORY_REQUIREMENTS", requirements: untracedMandatoryRequirements.slice(0, 20).map((req) => ({ id: req.id, title: req.title })) }, { status: 422 });
  }

  if (type === "proposal" && !docId) {
    return NextResponse.json({
      error: "Direct proposal export is disabled",
      detail: "Run the tender engine and generate the required documents first. Then download a generated document or the ZIP package. This prevents unvalidated proposal files from bypassing compliance and review guardrails.",
    }, { status: 409 });
  }

  if (docId) {
    const doc = tender.generatedDocuments.find((d) => d.id === docId);
    if (!doc || !doc.fileContent || doc.generationStatus !== "GENERATED") {
      return NextResponse.json({ error: "Document not found or not yet generated" }, { status: 404 });
    }

    const validation = await validateGeneratedDocx(doc);
    if (!validation.ok) {
      return NextResponse.json({ error: "Document export blocked by final validation", reasons: validation.errors }, { status: 409 });
    }

    const readiness = checkExportReadiness([{ ...doc, validationStatus: "VALIDATED" }], { requireFileContent: true });
    if (!readiness.ok) {
      return NextResponse.json({ error: exportReadinessError(readiness.failures), failures: readiness.failures }, { status: 409 });
    }

    const buffer = Buffer.from(doc.fileContent, "base64");
    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "GeneratedDocument", entityId: docId, description: `Downloaded reviewed and validated generated document "${validation.filename}"` });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${validation.filename}"`,
      },
    });
  }

  if (type === "zip") {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();

    const generatedDocs = tender.generatedDocuments
      .filter((d) => d.generationStatus === "GENERATED" && d.fileContent)
      .sort((a, b) => (a.exactOrder ?? 99) - (b.exactOrder ?? 99));

    if (generatedDocs.length === 0) {
      return NextResponse.json({ error: "No generated documents to package. Run generation first." }, { status: 400 });
    }

    const validationFailures = await validateDocsForExport(generatedDocs);
    if (validationFailures.length > 0) {
      return NextResponse.json({ error: "ZIP export blocked by final validation", failures: validationFailures }, { status: 409 });
    }

    // PR XX-G4 — ZIP export now also enforces tender-level blockers
    // (HIGH evaluator objections, pricing leakage). Per-doc check
    // already passed `validateDocsForExport`; the readiness call adds
    // the tender-level gate.
    const readiness = await checkFullExportReadiness({
      tenderId: tender.id,
      docs: generatedDocs.map((doc) => ({ ...doc, validationStatus: "VALIDATED" })),
      requireFileContent: true,
    });
    if (!readiness.ok) {
      return NextResponse.json({ error: exportReadinessError(readiness.failures, readiness.tenderLevelBlockers), failures: readiness.failures, tenderLevelBlockers: readiness.tenderLevelBlockers ?? [] }, { status: 409 });
    }

    const requiredNames = safeParseArr(tender.exactFileNaming).map(normalizeName);
    const requiredOrder = safeParseArr(tender.exactFileOrder).map(normalizeName);
    const generatedNames = generatedDocs.map((d) => normalizeName(d.exactFileName ?? generatedFileName(d.name)));

    if (hasExplicitSubmissionScope(tender)) {
      const submissionPlan = buildSubmissionPlan({
        id: tender.id,
        title: tender.title,
        exactFileNaming: tender.exactFileNaming,
        exactFileOrder: tender.exactFileOrder,
        pageLimit: tender.pageLimit,
        requirements: tender.requirements,
      });
      const missingPlanFiles = findMissingGeneratedDocuments(submissionPlan, generatedDocs);
      const extraGeneratedDocs = findExtraGeneratedDocuments(submissionPlan, generatedDocs);
      if (missingPlanFiles.length > 0 || extraGeneratedDocs.length > 0) {
        return NextResponse.json({
          error: "ZIP export blocked by submission plan mismatch",
          missing: missingPlanFiles.map((file) => file.exactFileName),
          extras: extraGeneratedDocs.map((doc) => doc.exactFileName ?? generatedFileName(doc.name ?? doc.documentType ?? doc.id ?? "document")),
          requiredCount: plannedSubmissionTargetFiles(submissionPlan).length,
          generatedCount: generatedDocs.length,
        }, { status: 409 });
      }
    } else {
      if (requiredNames.length > 0) {
        const missing = requiredNames.filter((name) => !generatedNames.includes(name));
        const extras = generatedNames.filter((name) => !requiredNames.includes(name));
        if (missing.length > 0 || extras.length > 0 || generatedDocs.length !== requiredNames.length) {
          return NextResponse.json(
            { error: "Generated package does not match tender-required file naming scope.", missing, extras, requiredCount: requiredNames.length, generatedCount: generatedDocs.length },
            { status: 400 },
          );
        }
      }

      if (requiredOrder.length > 0) {
        const outOfOrder = requiredOrder.some((name, index) => generatedNames[index] !== name);
        if (outOfOrder) {
          return NextResponse.json({ error: "Generated package order does not match tender-required file order.", requiredOrder, generatedOrder: generatedNames }, { status: 400 });
        }
      }
    }

    for (const doc of generatedDocs) {
      const buffer = Buffer.from(doc.fileContent!, "base64");
      const filename = doc.exactFileName ?? generatedFileName(doc.name);
      zip.file(filename, buffer);
    }

    // ── H4: Expert CV DOCX files in a CVs/ sub-folder ─────────────────
    // Expert CV documents (EXPERT_CV_PACKAGE) are supplementary appendices
    // that evaluators expect alongside the main proposal. They are NOT part
    // of the submission plan scope check (which only covers the 6-8 main
    // proposal files), so we add them separately into a CVs/ folder.
    const cvDocs = tender.generatedDocuments.filter(
      (d) => d.generationStatus === "GENERATED" && d.fileContent &&
             (d.documentType === "EXPERT_CV_PACKAGE" || d.name?.startsWith("CV-")),
    );
    for (const cvDoc of cvDocs) {
      const cvBuffer = Buffer.from(cvDoc.fileContent!, "base64");
      const cvFilename = cvDoc.exactFileName ?? generatedFileName(cvDoc.name);
      zip.file(`CVs/${cvFilename}`, cvBuffer);
    }

    // ── M6: Win-probability report DOCX ───────────────────────────────
    // A concise internal report showing the 4-axis win-probability breakdown
    // so bid managers can reference it during proposal review meetings.
    try {
      const pastOutcomes = await prisma.tender.findMany({
        where: { userId, bidOutcome: { in: ["WON", "LOST"] } },
        select: { bidOutcome: true, category: true },
      });

      const wpResult = computeWinProbability({
        primarySector: tender.category ?? "General",
        projects: tender.projectMatches.map((m) => ({
          sectors: (m.project as { sectors?: string | null }).sectors,
          contractValue: (m.project as { contractValue?: number | null }).contractValue,
        })),
        experts: tender.expertMatches.map((m) => ({
          disciplines: (m.expert as { disciplines?: string | null }).disciplines,
          sectors: (m.expert as { sectors?: string | null }).sectors,
          yearsExperience: (m.expert as { yearsExperience?: number | null }).yearsExperience,
        })),
        complianceGaps: tender.complianceGaps.filter((g) => !g.isResolved),
        bidOutcomes: pastOutcomes.map((t) => ({ won: t.bidOutcome === "WON", primarySector: t.category ?? null })),
      });

      const axisRows: [string, string, string][] = [
        ["Evidence match", `${wpResult.breakdown.evidenceMatch}/30`, `${Math.round((wpResult.breakdown.evidenceMatch / 30) * 100)}%`],
        ["Team strength", `${wpResult.breakdown.teamStrength}/25`, `${Math.round((wpResult.breakdown.teamStrength / 25) * 100)}%`],
        ["Compliance posture", `${wpResult.breakdown.compliancePosture}/25`, `${Math.round((wpResult.breakdown.compliancePosture / 25) * 100)}%`],
        ["Historical outcomes", `${wpResult.breakdown.historicalOutcomes}/20`, `${Math.round((wpResult.breakdown.historicalOutcomes / 20) * 100)}%`],
      ];

      const wpDoc = new Document({
        styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } },
        sections: [{
          properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
          children: [
            new Paragraph({ text: "Win Probability Report", heading: HeadingLevel.HEADING_1, spacing: { after: 120 } }),
            new Paragraph({ children: [new TextRun({ text: `Tender: `, bold: true }), new TextRun({ text: tender.title })], spacing: { after: 60 } }),
            new Paragraph({ children: [new TextRun({ text: `Overall score: `, bold: true }), new TextRun({ text: `${wpResult.score}/100 — ${wpResult.label}` })], spacing: { after: 200 } }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: TableBorders.NONE,
              rows: [
                new TableRow({
                  tableHeader: true,
                  children: ["Axis", "Score", "Rate"].map((h) =>
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })] })], shading: { fill: "1F4E79" }, margins: { top: 80, bottom: 80, left: 100, right: 100 } })
                  ),
                }),
                ...axisRows.map(([axis, score, rate]) =>
                  new TableRow({
                    children: [axis, score, rate].map((v) =>
                      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, size: 20 })] })], margins: { top: 60, bottom: 60, left: 100, right: 100 } })
                    ),
                  })
                ),
              ],
            }),
            new Paragraph({ children: [new TextRun("")], spacing: { after: 200 } }),
            new Paragraph({ text: "Key notes", heading: HeadingLevel.HEADING_2, spacing: { after: 80 } }),
            ...wpResult.notes.map((note) => new Paragraph({ children: [new TextRun({ text: `• ${note}`, size: 20 })], spacing: { after: 60 } })),
            new Paragraph({ children: [new TextRun({ text: `Generated: ${new Date().toLocaleString()}`, size: 18, color: "888888", italics: true })], spacing: { before: 300 } }),
          ],
        }],
      });
      const wpBuffer = await Packer.toBuffer(wpDoc);
      zip.file("Win-Probability-Report.docx", wpBuffer);
    } catch {
      // Win probability report failure is non-blocking — the ZIP still exports
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipName = `${safeFileBaseName(tender.title)}-submission-package.zip`;
    const fileList = [
      ...generatedDocs.map((doc) => doc.exactFileName ?? generatedFileName(doc.name)),
      ...cvDocs.map((d) => `CVs/${d.exactFileName ?? generatedFileName(d.name)}`),
    ];

    const existingPackage = tender.exportPackages[0];
    if (existingPackage) {
      await prisma.exportPackage.update({ where: { id: existingPackage.id }, data: { status: "READY", fileList: JSON.stringify(fileList), downloadCount: { increment: 1 } } });
    } else {
      await prisma.exportPackage.create({ data: { tenderId: id, status: "READY", fileList: JSON.stringify(fileList), downloadCount: 1 } });
    }

    await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: id, description: `Downloaded reviewed and validated ZIP package for "${tender.title}" (${generatedDocs.length} files)` });

    return new NextResponse(new Uint8Array(zipBuffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${zipName}"` } });
  }

  const children: Paragraph[] = [];

  if (type === "compliance") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Internal Compliance Report: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    if (tender.complianceGaps.length === 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "No compliance gaps identified.", color: "22c55e" })] }));
    } else {
      for (const gap of tender.complianceGaps) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: `[${gap.severity}] `, bold: true, color: gap.severity === "CRITICAL" ? "dc2626" : gap.severity === "HIGH" ? "ea580c" : "ca8a04" }), new TextRun({ text: gap.title, bold: true })], spacing: { before: 160, after: 60 } }),
          new Paragraph({ children: [new TextRun({ text: gap.description, color: "555555" })], spacing: { after: 60 } }),
          ...(gap.mitigationPlan ? [new Paragraph({ children: [new TextRun({ text: `Mitigation: ${gap.mitigationPlan}`, italics: true })] })] : []),
        );
      }
    }
  } else if (type === "requirements") {
    children.push(new Paragraph({ children: [new TextRun({ text: `Internal Requirements Review: ${tender.title}`, bold: true, size: 48 })], spacing: { after: 300 } }));
    for (const req of tender.requirements) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: `[${req.priority}] ${req.requirementType}  `, bold: true, color: req.priority === "MANDATORY" ? "dc2626" : "2563eb" }), new TextRun({ text: req.title, bold: true })], spacing: { before: 120, after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: req.description })], spacing: { after: 120 } }),
      );
    }
  } else {
    return NextResponse.json({ error: "Unsupported download type" }, { status: 400 });
  }

  const doc = new Document({ sections: [{ properties: {}, children }], styles: { default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } } } } });
  const buffer = await Packer.toBuffer(doc);
  const filename = `${safeFileBaseName(tender.title)}-${type}-internal.docx`;

  await logAction({ userId, action: "EXPORT_PACKAGE_DOWNLOAD", entityType: "Tender", entityId: id, description: `Downloaded internal ${type} report for "${tender.title}"` });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${filename}"` } });
}
