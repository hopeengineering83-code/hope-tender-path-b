import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { documentHygieneIssues } from "../../../../../lib/engine/export-readiness";

export const dynamic = "force-dynamic";

const mapCats = (s: string) => { const t = s.toLowerCase(); if (/financial|audited|bank|turnover|capacity/.test(t)) return ["FINANCIAL_STATEMENT"]; if (/legal|license|tax|vat|tin|registration|cert/.test(t)) return ["LEGAL_REGISTRATION", "CERTIFICATION"]; if (/profile|capability/.test(t)) return ["COMPANY_PROFILE"]; if (/manual|policy|quality|safeguard|compliance/.test(t)) return ["MANUAL", "COMPLIANCE_RECORD"]; if (/cv|personnel|expert/.test(t)) return ["EXPERT_CV"]; if (/project|reference|experience|contract/.test(t)) return ["PROJECT_REFERENCE", "PROJECT_CONTRACT"]; return []; };
const usable = (d: { storagePath: string; extractedText: string | null }) => Boolean((d.storagePath ?? "").trim() || (d.extractedText ?? "").trim());
const scoreOption = (rowName: string, category: string, fileName: string) => {
  let score = 0;
  const label = `${rowName} ${fileName}`.toLowerCase();
  if (label.includes(category.toLowerCase().replace(/_/g, " "))) score += 2;
  if (/audited|financial|tax|vat|tin|legal|license|cv|project|reference/.test(label)) score += 1;
  if (rowName.toLowerCase() === fileName.toLowerCase()) score += 3;
  return score;
};

async function extractedTextDocx(title: string, text: string) { const lines = text.replace(/[\u0000-\u001F\u007F]/g, " ").split(/\n+/).filter(Boolean).slice(0, 200); const buf = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: title, bold: true })] }), ...lines.map((line) => new Paragraph({ text: line.slice(0, 3000) }))] }] })); return buf.toString("base64"); }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady; const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" }, reviewStatus: { in: ["REPLACE_WITH_ORIGINAL", "PENDING", "CHANGES_REQUESTED"] } }, select: { id: true, name: true, exactFileName: true, documentType: true } } } });
  const company = await prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({ error: "Company profile not found. Set up your company profile before linking vault evidence.", code: "COMPANY_NOT_FOUND" }, { status: 422 });
  // fileContent omitted — GET only checks usability, not content. POST loads content when linking.
  const vault = await prisma.companyDocument.findMany({ where: { companyId: company.id }, select: { id: true, fileName: true, category: true, storagePath: true, extractedText: true } });
  const candidates = tender.generatedDocuments.map((row) => { const cats = mapCats(`${row.exactFileName ?? row.name} ${row.documentType ?? ""}`); const options = vault.filter((v) => cats.includes(v.category) && usable(v)).map((v) => ({ id: v.id, fileName: v.fileName, category: v.category, score: scoreOption(row.exactFileName ?? row.name, v.category, v.fileName) })).sort((a,b)=>b.score-a.score); return { rowId: row.id, rowName: row.exactFileName ?? row.name, suggestedCategories: cats, options }; }).filter((x) => x.options.length > 0);
  return NextResponse.json({ success: true, candidates });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const rl = rateLimit(`link-vault:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  await prismaReady; const { id } = await params; const body = await req.json().catch(() => ({}));
  const rowId = String(body.rowId ?? ""); const vaultDocumentId = String(body.vaultDocumentId ?? "");
  const [row, company] = await Promise.all([prisma.generatedDocument.findFirst({ where: { id: rowId, tenderId: id } }), prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } })]);
  if (!row || !company) return NextResponse.json({ error: "Document row or company not found" }, { status: 404 });
  const vault = await prisma.companyDocument.findFirst({ where: { id: vaultDocumentId, companyId: company.id } });
  if (!vault || !usable(vault)) return NextResponse.json({ error: "Vault evidence not found or empty" }, { status: 400 });
  const fileContent = (vault.fileContent ?? "").trim() ? vault.fileContent : (vault.extractedText ?? "").trim() ? await extractedTextDocx(vault.fileName, vault.extractedText ?? "") : row.fileContent;
  const hasBytes = Boolean((fileContent ?? "").trim() || (vault.storagePath ?? "").trim());
  const hygieneIssues = documentHygieneIssues(vault.extractedText ?? vault.fileName, { name: row.name, exactFileName: row.exactFileName, documentType: row.documentType ?? undefined, format: row.format ?? undefined });
  const ready = hasBytes && hygieneIssues.length === 0;
  await prisma.generatedDocument.update({ where: { id: row.id }, data: { fileContent, storagePath: (vault.storagePath ?? "") || row.storagePath, generationStatus: "GENERATED", validationStatus: ready ? "VALIDATED" : "PENDING", reviewStatus: ready ? "READY_FOR_EXPORT" : "PENDING", reviewNotes: ready ? `Linked Knowledge Vault evidence: ${vault.fileName}` : `Linked Knowledge Vault evidence (${vault.fileName}) but requires validation/hygiene review.` } });
  await prisma.documentReview.create({ data: { documentId: row.id, reviewerId: actor.id, action: ready ? "READY_FOR_EXPORT" : "CHANGES_REQUESTED", notes: `Linked vault evidence ${vault.fileName}`, priorStatus: row.reviewStatus, newStatus: ready ? "READY_FOR_EXPORT" : row.reviewStatus } });
  await logAction({ userId: actor.id, action: "VAULT_EVIDENCE_LINKED", entityType: "GeneratedDocument", entityId: row.id, description: `Vault evidence linked: ${vault.fileName} → ${row.exactFileName ?? row.name}. Ready: ${ready}.`, metadata: { tenderId: id, packageDocId: row.id, vaultDocId: vault.id, vaultFileName: vault.fileName, readyForExport: ready, hygieneIssues } });
  return NextResponse.json({ success: true, readyForExport: ready, hygieneIssues });
}
