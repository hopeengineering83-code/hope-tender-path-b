import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { safeFileBaseName } from "../../../../../lib/engine/proposal-labels";
import { checkExportReadiness, isDocumentExportable, type ExportReadyDocument } from "../../../../../lib/engine/export-readiness";
import { filterFinalExportCandidateDocuments } from "../../../../../lib/engine/document-output-state";
import { buildFinalZipEntries } from "../../../../../lib/engine/final-zip-scope";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { safeParseJsonArray, safeParseJsonObject, safeParse } from "../../../../../lib/safe-json";
import { inferEnvelope, type SubmissionEnvelope } from "../../../../../lib/engine/submission-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "DOWNLOAD_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

function asReadyDoc(raw: any): ExportReadyDocument {
  return {
    id: raw.id,
    name: raw.name,
    exactFileName: raw.exactFileName,
    exactOrder: raw.exactOrder,
    documentType: raw.documentType,
    format: raw.format,
    generationStatus: raw.generationStatus,
    validationStatus: raw.validationStatus,
    reviewStatus: raw.reviewStatus,
    fileContent: raw.fileContent,
    storagePath: raw.storagePath,
  };
}

async function singleDocument(userId: string, tender: any, docId: string) {
  const raw = tender.generatedDocuments.find((d: any) => d.id === docId);
  if (!raw || raw.generationStatus !== "GENERATED") return err("Document not found or not yet generated.", 404, { code: "DOCUMENT_NOT_FOUND" });

  const doc = asReadyDoc(raw);
  if (!isDocumentExportable(doc)) return err("Document is not ready for export.", 409, { code: "DOCUMENT_NOT_READY" });

  // Simplified for audit
  return NextResponse.json({ ok: true, docId: doc.id });
}

async function zipPackage(userId: string, tender: any, envelopeFilter: SubmissionEnvelope | null) {
  const readiness = await checkExportReadiness(tender.id);
  if (!readiness.ok) {
    return err("Tender is not ready for export.", 409, { code: "TENDER_NOT_READY", blockers: readiness.blockers });
  }

  // Simplified for audit
  return NextResponse.json({ ok: true, tenderId: tender.id });
}

function parseEnvelopeQuery(q: string | null): SubmissionEnvelope | null | "INVALID" {
  if (!q) return null;
  const normalized = q.toUpperCase();
  if (["TECHNICAL", "FINANCIAL", "ADMIN"].includes(normalized)) return normalized as SubmissionEnvelope;
  return "INVALID";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "proposal";
    const docId = searchParams.get("docId");
    const envelopeRaw = parseEnvelopeQuery(searchParams.get("envelope"));
    if (envelopeRaw === "INVALID") {
      return err("Invalid envelope query parameter. Use technical, financial, or admin.", 400, { code: "INVALID_ENVELOPE_QUERY" });
    }

    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, include: { requirements: true, generatedDocuments: true } });
    if (!tender) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    if (docId) return await singleDocument(actor.id, tender, docId);
    if (type === "zip") return await zipPackage(actor.id, tender, envelopeRaw);
    return err("Direct proposal export is disabled.", 409, { code: "DIRECT_PROPOSAL_EXPORT_DISABLED" });
  } catch (error) {
    console.error("Tender download route failed", error);
    return err("Download route failed.", 500, { code: "DOWNLOAD_ROUTE_RUNTIME_ERROR" });
  }
}
