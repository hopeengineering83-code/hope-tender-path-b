import { logger } from "../../../../../lib/observability";
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

/**
 * Derive required sections from exactFileNaming / exactFileOrder JSON arrays.
 * Falls back to common section names inferred from document names.
 */
function deriveRequiredSections(
  exactFileNaming: string | null,
  exactFileOrder: string | null,
  documentNames: string[],
): string[] {
  const sections = new Set<string>();

  // Parse exact file naming/order hints
  for (const raw of [exactFileNaming, exactFileOrder]) {
    if (!raw) continue;
    const parsed = safeParseJsonArray(raw);
    if (parsed.length > 0) {
      for (const entry of parsed) {
        if (typeof entry === "string" && entry.trim()) {
          sections.add(entry.trim());
        } else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
          sections.add(((entry as Record<string, unknown>).name as string).trim());
        }
      }
    } else {
      // ignore empty / non-array
    }
  }

  // If no manifest hints, infer from document names (just return them as-is)
  if (sections.size === 0) {
    for (const name of documentNames) {
      sections.add(name);
    }
  }

  return Array.from(sections);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }

    await prismaReady;
    const { id } = await params;

    const tender = await prisma.tender.findFirst({
      where: { id, userId: actor.id },
      select: {
        id: true,
        exactFileNaming: true,
        exactFileOrder: true,
        generatedDocuments: {
          select: {
            id: true,
            name: true,
            documentType: true,
            contentSummary: true,
            reviewNotes: true,
            exactFileName: true,
            generationStatus: true,
          },
        },
        requirements: {
          select: {
            exactFileName: true,
          },
        },
      },
    });

    if (!tender) return jsonError("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    // Build manifest entries from requirements with exactFileName + generated docs
    const manifestEntries: ManifestEntry[] = [];

    // From requirements that have an explicit exactFileName
    for (const req of tender.requirements) {
      if (req.exactFileName) {
        manifestEntries.push({
          exactFileName: req.exactFileName,
          documentType: "TENDER_REQUIRED_FILE",
        });
      }
    }

    // From exactFileNaming JSON array
    const exactFileNamingRaw = tender.exactFileNaming ?? "[]";
    const parsedFileNaming = safeParseJsonArray(exactFileNamingRaw);
    if (parsedFileNaming.length > 0) {
      for (const entry of parsedFileNaming) {
        if (typeof entry === "string" && entry.trim()) {
          manifestEntries.push({ exactFileName: entry.trim(), documentType: "TENDER_REQUIRED_FILE" });
        } else if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
          const e = entry as Record<string, unknown>;
          manifestEntries.push({ exactFileName: (e.name as string).trim(), documentType: (e.documentType as string | undefined) ?? "TENDER_REQUIRED_FILE" });
        }
      }
    }

    // Only check GENERATED documents (not PLANNED stubs)
    const documents: DocumentInput[] = tender.generatedDocuments
      .filter((d) => d.generationStatus === "GENERATED")
      .map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.documentType,
        contentSummary: d.contentSummary ?? null,
        reviewNotes: d.reviewNotes ?? null,
        exactFileName: d.exactFileName ?? null,
      }));

    // Derive required sections from manifest entries
    const documentNames = documents.map((d) => d.name);
    const tenderRequiredSections = deriveRequiredSections(
      tender.exactFileNaming ?? null,
      tender.exactFileOrder ?? null,
      documentNames,
    );

    const result = runAuthorityReview(documents, manifestEntries, tenderRequiredSections);

    return NextResponse.json({
      success: true,
      tenderId: id,
      authorityReview: result,
    });
  } catch (error) {
    logger.error("Authority review route failed", { detail: error });
    return jsonError("Authority review failed.", 500, {
      code: "AUTHORITY_REVIEW_RUNTIME_ERROR",
      correlationId: require("crypto").randomUUID().slice(0, 8),
    });
  }
}
