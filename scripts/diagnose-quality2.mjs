/**
 * Reproduce the export-readiness document quality gate verdicts for a tender.
 * Development/diagnostic harness, not production code.
 */
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const tenderId = process.argv[2];
const { checkFullExportReadinessWithQualityGate, checkDocumentQualityGate, extractDocxVisibleText } =
  await import("../lib/engine/export-readiness.ts");
const { validateGeneratedDocumentQuality } = await import("../lib/document-generation/generated-document-quality-validator.ts");
const { buildTenderDocumentContext } = await import("../lib/document-generation/tender-document-context.ts");

const tender = await p.tender.findUnique({ where: { id: tenderId }, include: { requirements: true, files: true } });
const company = await p.company.findUnique({ where: { userId: tender.userId }, include: { experts: true, projects: true, documents: true } });
const ctx = buildTenderDocumentContext(
  tender,
  tender.files,
  tender.requirements,
  [], [], [], [],
  { name: company?.name ?? "", legalName: company?.legalName ?? null },
);
const docs = await p.generatedDocument.findMany({
  where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
  select: { id: true, name: true, exactFileName: true, documentType: true, fileContent: true },
});
const mandatory = tender.requirements.filter(r => r.priority === "MANDATORY").map(r => r.title);
for (const d of docs) {
  const text = await extractDocxVisibleText(d.fileContent, d.exactFileName ?? d.name);
  if (!text) { console.log(`\n- ${d.exactFileName}: no extractable text`); continue; }
  const r = validateGeneratedDocumentQuality(text, d.documentType ?? "", ctx, [], mandatory);
  console.log(`\n- ${d.exactFileName} type=${d.documentType} score=${r.score} okForFinal=${r.okForFinal} textLen=${text.length}`);
  for (const k of ["finalBlockers","aiTraceViolations","placeholderViolations","missingSections","inventedEvidenceRisks","missingRequirements"]) {
    if (r[k]?.length) console.log(`   ${k}:`, JSON.stringify(r[k]).slice(0, 400));
  }
}
await p.$disconnect();
