import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

const mapCats = (s: string) => { const t = s.toLowerCase(); if (/financial|audited|bank|turnover|capacity/.test(t)) return ["FINANCIAL_STATEMENT"]; if (/legal|license|tax|vat|tin|registration|cert/.test(t)) return ["LEGAL_REGISTRATION", "CERTIFICATION"]; if (/profile|capability/.test(t)) return ["COMPANY_PROFILE"]; if (/manual|policy/.test(t)) return ["MANUAL"]; if (/cv|personnel|expert/.test(t)) return ["EXPERT_CV"]; if (/project|reference|experience|contract/.test(t)) return ["PROJECT_REFERENCE", "PROJECT_CONTRACT"]; return []; };
const usable = (d: { fileContent: string | null; storagePath: string; extractedText: string | null }) => Boolean((d.fileContent ?? "").trim() || (d.storagePath ?? "").trim() || (d.extractedText ?? "").trim());

async function extractedTextDocx(title: string, text: string) { const lines = text.replace(/[\u0000-\u001F\u007F]/g, " ").split(/\n+/).filter(Boolean).slice(0, 200); const buf = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: title, bold: true })] }), ...lines.map((line) => new Paragraph({ text: line.slice(0, 3000) }))] }] })); return buf.toString("base64"); }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady; const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } }, select: { id: true, name: true, exactFileName: true, documentType: true } } } });
  const company = await prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!tender || !company) return NextResponse.json({ error: "Tender/company not found" }, { status: 404 });
  const vault = await prisma.companyDocument.findMany({ where: { companyId: company.id }, select: { id: true, fileName: true, category: true, fileContent: true, storagePath: true, extractedText: true } });
  const candidates = tender.generatedDocuments.map((row) => { const cats = mapCats(`${row.exactFileName ?? row.name} ${row.documentType ?? ""}`); const options = vault.filter((v) => cats.includes(v.category) && usable(v)).map((v) => ({ id: v.id, fileName: v.fileName, category: v.category })); return { rowId: row.id, rowName: row.exactFileName ?? row.name, suggestedCategories: cats, options }; }).filter((x) => x.options.length > 0);
  return NextResponse.json({ success: true, candidates });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady; const { id } = await params; const body = await req.json().catch(() => ({}));
  const rowId = String(body.rowId ?? ""); const vaultDocumentId = String(body.vaultDocumentId ?? "");
  const [row, company] = await Promise.all([prisma.generatedDocument.findFirst({ where: { id: rowId, tenderId: id } }), prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } })]);
  if (!row || !company) return NextResponse.json({ error: "Document row or company not found" }, { status: 404 });
  const vault = await prisma.companyDocument.findFirst({ where: { id: vaultDocumentId, companyId: company.id } });
  if (!vault || !usable(vault)) return NextResponse.json({ error: "Vault evidence not found or empty" }, { status: 400 });
  const fileContent = (vault.fileContent ?? "").trim() ? vault.fileContent : (vault.extractedText ?? "").trim() ? await extractedTextDocx(vault.fileName, vault.extractedText ?? "") : row.fileContent;
  const ready = Boolean((fileContent ?? "").trim() || (vault.storagePath ?? "").trim());
  await prisma.generatedDocument.update({ where: { id: row.id }, data: { fileContent, storagePath: (vault.storagePath ?? "") || row.storagePath, generationStatus: "GENERATED", validationStatus: ready ? "VALIDATED" : "PENDING", reviewStatus: ready ? "READY_FOR_EXPORT" : "PENDING", reviewNotes: `Linked Knowledge Vault evidence: ${vault.fileName}` } });
  await prisma.documentReview.create({ data: { documentId: row.id, reviewerId: actor.id, action: ready ? "READY_FOR_EXPORT" : "CHANGES_REQUESTED", notes: `Linked vault evidence ${vault.fileName}`, priorStatus: row.reviewStatus, newStatus: ready ? "READY_FOR_EXPORT" : row.reviewStatus } });
  return NextResponse.json({ success: true, readyForExport: ready });
}
