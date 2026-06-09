import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { runAuthorityReview, type ManifestEntry, type DocumentInput } from "../../../../../lib/engine/authority-review";
import { safeParseJsonArray } from "../../../../../lib/safe-json";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "AUTHORITY_REVIEW_ERROR";
  return NextResponse.json({ ok: false, success: false, code, message, error: message, ...extra }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      include: { requirements: true, generatedDocuments: true }
    });
    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    const manifestEntries: ManifestEntry[] = [];
    const parsedNaming = safeParseJsonArray(tender.exactFileNaming) as any[];
    for (const entry of parsedNaming) {
      if (typeof entry === "string") {
        manifestEntries.push({ exactFileName: entry, documentType: "TENDER_REQUIRED_FILE" });
      } else if (entry && typeof entry === "object") {
        const e = entry as Record<string, any>;
        manifestEntries.push({ exactFileName: e.name || e.exactFileName || "", documentType: e.documentType || "TENDER_REQUIRED_FILE" });
      }
    }

    const docs: DocumentInput[] = tender.generatedDocuments.map(d => ({
      id: d.id,
      name: d.name,
      documentType: d.documentType || "OTHER",
      contentSummary: d.contentSummary,
      reviewNotes: d.reviewNotes,
      exactFileName: d.exactFileName
    }));

    const result = runAuthorityReview(docs, manifestEntries, []);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return jsonError("Authority review failed", 500);
  }
}
