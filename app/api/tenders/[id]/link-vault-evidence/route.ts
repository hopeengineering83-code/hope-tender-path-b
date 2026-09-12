import { NextResponse } from "next/server";
import { forbiddenResponse, requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { includeVaultDocumentInPackage, INCLUDABLE_VAULT_DOCUMENT_WHERE } from "../../../../../lib/engine/vault-document-package-inclusion";
import { getStorageAdapter } from "../../../../../lib/storage";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

const mapCats = (s: string) => { const t = s.toLowerCase(); if (/financial|audited|bank|turnover|capacity/.test(t)) return ["FINANCIAL_STATEMENT"]; if (/legal|license|tax|vat|tin|registration|cert/.test(t)) return ["LEGAL_REGISTRATION", "CERTIFICATION"]; if (/profile|capability/.test(t)) return ["COMPANY_PROFILE"]; if (/manual|policy|quality|safeguard|compliance/.test(t)) return ["MANUAL", "COMPLIANCE_RECORD"]; if (/cv|personnel|expert/.test(t)) return ["EXPERT_CV"]; if (/project|reference|experience|contract/.test(t)) return ["PROJECT_REFERENCE", "PROJECT_CONTRACT"]; return []; };
const scoreOption = (rowName: string, category: string, fileName: string) => {
  let score = 0;
  const label = `${rowName} ${fileName}`.toLowerCase();
  if (label.includes(category.toLowerCase().replace(/_/g, " "))) score += 2;
  if (/audited|financial|tax|vat|tin|legal|license|cv|project|reference/.test(label)) score += 1;
  if (rowName.toLowerCase() === fileName.toLowerCase()) score += 3;
  return score;
};


export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady; const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" }, reviewStatus: { in: ["REPLACE_WITH_ORIGINAL", "PENDING", "CHANGES_REQUESTED"] } }, select: { id: true, name: true, exactFileName: true, documentType: true } } } });
  const company = await prisma.company.findUnique({ where: { userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  if (!company) return NextResponse.json({ error: "Company profile not found. Set up your company profile before linking vault evidence.", code: "COMPANY_NOT_FOUND" }, { status: 422 });
  // Byte columns are selected as presence flags only — the large base64 blob is
  // never loaded here. POST reads the real bytes when it includes one.
  const vault = await prisma.companyDocument.findMany({ where: { companyId: company.id, ...INCLUDABLE_VAULT_DOCUMENT_WHERE }, select: { id: true, fileName: true, category: true } });
  const candidates = tender.generatedDocuments.map((row) => { const cats = mapCats(`${row.exactFileName ?? row.name} ${row.documentType ?? ""}`); const options = vault.filter((v) => cats.includes(v.category)).map((v) => ({ id: v.id, fileName: v.fileName, category: v.category, score: scoreOption(row.exactFileName ?? row.name, v.category, v.fileName) })).sort((a,b)=>b.score-a.score); return { rowId: row.id, rowName: row.exactFileName ?? row.name, suggestedCategories: cats, options }; }).filter((x) => x.options.length > 0);
  return NextResponse.json({ success: true, candidates });
}

// ADMIN only. Placing unchanged official company documents into a package that
// goes to a client is not a drafting action — it is a decision about what the
// company formally submits.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor; try { actor = await requireRole("ADMIN"); } catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const rl = await rateLimitPersistent(`link-vault:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });
  await prismaReady; const { id } = await params; const body = await req.json().catch(() => ({}));
  const rowId = String(body.rowId ?? ""); const vaultDocumentId = String(body.vaultDocumentId ?? "");
  // Verify tender ownership BEFORE accessing GeneratedDocument — prevents
  // cross-tenant mutation (was missing — actor could supply any tenderId
  // and mutate another tenant's GeneratedDocument fileContent/reviewStatus).
  const ownerTender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!ownerTender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  // One inclusion authority, shared with the auto variant: verified bytes only,
  // copied unchanged through the digest-computing persist path. The document
  // lands PENDING/PENDING — the export gate and a human approver still decide,
  // and no DocumentReview is fabricated on the actor's behalf.
  const outcome = await includeVaultDocumentInPackage({
    client: prisma,
    storage: getStorageAdapter(),
    tenderId: id,
    userId: actor.id,
    documentId: rowId,
    vaultDocumentId,
  });
  if (!outcome.included) {
    return NextResponse.json({ success: false, error: outcome.reason, code: "VAULT_INCLUSION_BLOCKED" }, { status: 400 });
  }
  await logAction({ userId: actor.id, action: "VAULT_EVIDENCE_LINKED", entityType: "GeneratedDocument", entityId: outcome.documentId, description: `Official Vault document included unchanged: ${outcome.vaultFileName}. Awaiting validation and approval.`, metadata: { tenderId: id, packageDocId: outcome.documentId, vaultDocId: outcome.vaultDocumentId, vaultFileName: outcome.vaultFileName, sha256: outcome.sha256, byteLength: outcome.byteLength } });
  // Gap 4: re-query the canonical final-export authority after the mutation.
  // The client no longer has to infer final-export readiness from intermediate
  // signals — this is the authoritative verdict.
  const canonicalReadiness = await getCanonicalReadinessSummary(prisma, actor.id, id);
  return NextResponse.json({ success: true, sha256: outcome.sha256, byteLength: outcome.byteLength, canonicalReadiness });
}
