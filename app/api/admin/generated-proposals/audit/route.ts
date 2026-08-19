import { logger } from "../../../../../lib/observability";
// ─── Admin generated-proposal audit endpoint ─────────────────────────────
//
// Why this exists:
//   Generated proposal content lives behind authenticated session cookies,
//   so /api/tenders/* correctly returns 401 to unauthenticated callers.
//   This endpoint gives ADMIN users a safe, structured way to audit the
//   health of generated proposals across all users without leaking proposal
//   body text or content bytes.
//
// Security guarantees:
//   - ADMIN role only.
//   - Returns metadata + issue flags only.
//   - Issue snippets are never returned.
//   - Pagination is bounded to 200 rows.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import {
  deriveDocumentOutputState,
  isFinalExportCandidateDocument,
  isValidationPassed,
  isReviewReadyForExport,
  isGenerated,
} from "../../../../../lib/engine/document-output-state";
import {
  documentHygieneIssues,
  extractDocxVisibleText,
} from "../../../../../lib/engine/export-readiness";
import { validateFileSignature } from "../../../../../lib/engine/export-format-policy";
import { containsPricingLeakage } from "../../../../../lib/engine/pricing-hygiene";
import { inferEnvelope } from "../../../../../lib/engine/submission-plan";
import { assessGeneratedDocumentQuality } from "../../../../../lib/engine/document-quality-gate";
import { METADATA_PLACEHOLDER_PATTERNS } from "../../../../../lib/engine/tender-metadata-completeness";
import { extractRequestId } from "../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Severity = "HIGH" | "MEDIUM" | "LOW";

type AuditRow = {
  tenderId: string;
  tenderTitle: string;
  documentId: string;
  documentName: string;
  exactFileName: string | null;
  documentType: string | null;
  envelope: string;
  format: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  finalExportCandidate: boolean;
  excludedReason: string | null;
  hasFileContent: boolean;
  hasStoragePath: boolean;
  storageReadable: boolean | null;
  byteSignatureOk: boolean | null;
  docxVisibleTextInspectable: boolean;
  wordCount: number;
  sectionCount: number;
  requiredSectionsPresent: string[];
  missingRequiredSections: string[];
  requirementCoverageRatio: number;
  qualityScore: number;
  qualityRecommendedStatus: string;
  aiTraceIssue: boolean;
  placeholderIssue: boolean;
  bidTeamToConfirmIssue: boolean;
  pricingLeakageIssue: boolean;
  genericContentIssue: boolean;
  unsupportedClaimRisk: boolean;
  internalTraceabilityIssue: boolean;
  officialOriginalPlaceholderRisk: boolean;
  missingContentIssue: boolean;
  duplicatedSectionsIssue: boolean;
  readyForExport: boolean;
  zipEligible: boolean;
  recommendedAction: string;
  severity: Severity;
  createdAt: string;
  updatedAt: string;
};

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "ADMIN_AUDIT_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

function why(row: AuditRow): { recommendedAction: string; severity: Severity } {
  if (row.missingContentIssue) {
    return { recommendedAction: "Regenerate this document or upload the final file. No file content is currently stored.", severity: "HIGH" };
  }
  if (row.officialOriginalPlaceholderRisk) {
    return { recommendedAction: "Attach the exact tender-issued original form/template. REPLACE_WITH_ORIGINAL placeholders must never enter the final ZIP.", severity: "HIGH" };
  }
  if (row.byteSignatureOk === false) {
    return { recommendedAction: "File extension does not match the actual byte signature. Regenerate this document in the required format.", severity: "HIGH" };
  }
  if (row.qualityRecommendedStatus === "QUALITY_FAILED") {
    return { recommendedAction: `Quality gate FAILED (score ${row.qualityScore}/100). Rewrite the document or attach the official original before export.`, severity: "HIGH" };
  }
  if (row.bidTeamToConfirmIssue) {
    return { recommendedAction: '"Bid-Team to confirm" or similar internal placeholder text detected. These must never appear in submitted proposals.', severity: "HIGH" };
  }
  if (row.internalTraceabilityIssue) {
    return { recommendedAction: "Internal traceability text (source-id / evidence-id / match-score) detected. Strip before submission.", severity: "HIGH" };
  }
  if (row.pricingLeakageIssue) {
    return { recommendedAction: "Pricing/financial language detected in a technical document. Remove all pricing/rate language from the technical envelope.", severity: "HIGH" };
  }
  if (row.aiTraceIssue) {
    return { recommendedAction: "AI/meta-preparation trace text detected. Run auto-finalize to clean before export.", severity: "MEDIUM" };
  }
  if (row.placeholderIssue) {
    return { recommendedAction: "Unresolved placeholder/drafting instruction detected. Run repair-export-gaps or edit the document.", severity: "MEDIUM" };
  }
  if (row.qualityRecommendedStatus === "NEEDS_REWRITE") {
    return { recommendedAction: `Document quality is weak (score ${row.qualityScore}/100). Rewrite or expand before approval.`, severity: "MEDIUM" };
  }
  if (row.genericContentIssue) {
    return { recommendedAction: "Generic marketing filler detected. Replace with tender-specific language and evidence-backed claims.", severity: "MEDIUM" };
  }
  if (row.unsupportedClaimRisk) {
    return { recommendedAction: "Document may contain unsupported numeric claims. Verify against reviewed vault evidence.", severity: "MEDIUM" };
  }
  if (row.duplicatedSectionsIssue) {
    return { recommendedAction: "Same heading repeated ≥3 times — likely a regeneration without dedupe. Deduplicate before export.", severity: "MEDIUM" };
  }
  if (!row.finalExportCandidate) {
    const reason = row.excludedReason ?? "Workspace-only row";
    return { recommendedAction: `${reason} — not a final-export file. The automatic generation stage produces the actual submission file.`, severity: "LOW" };
  }
  if (!row.readyForExport) {
    return { recommendedAction: "Document is not yet READY_FOR_EXPORT. Complete validation + reviewer approval.", severity: "MEDIUM" };
  }
  return { recommendedAction: "OK — ready for final export.", severity: "LOW" };
}

function detectOfficialOriginalRisk(doc: {
  name: string | null;
  exactFileName: string | null;
  documentType: string | null;
  reviewStatus: string | null;
  format: string | null;
}): boolean {
  const label = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""} ${doc.reviewStatus ?? ""} ${doc.format ?? ""}`.toUpperCase();
  if (label.includes("REPLACE_WITH_ORIGINAL")) return true;
  if (label.includes("NOT_EXPORTABLE") && /BID FORM|TENDER FORM|TEMPLATE|DECLARATION|UNDERTAKING|INTEGRITY PACT|BID BOND|RATE CARD|TIN|VAT|TAX CLEARANCE|AUDITED|TRADE LICENSE/.test(label)) return true;
  return false;
}

function describeExclusionReason(doc: {
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  format: string | null;
  documentType: string | null;
  name: string | null;
  exactFileName: string | null;
}): string | null {
  if (isFinalExportCandidateDocument(doc as any)) return null;
  const gen = (doc.generationStatus ?? "").toUpperCase();
  const val = (doc.validationStatus ?? "").toUpperCase();
  const rev = (doc.reviewStatus ?? "").toUpperCase();
  const fmt = (doc.format ?? "").toUpperCase();
  const dtype = (doc.documentType ?? "").toUpperCase();
  if (gen === "SUPERSEDED" || val === "SUPERSEDED") return "SUPERSEDED";
  if (gen === "PLANNED") return "PLANNED";
  if (rev === "NOT_EXPORTABLE") return "NOT_EXPORTABLE";
  if (rev === "REPLACE_WITH_ORIGINAL") return "REPLACE_WITH_ORIGINAL";
  if (fmt === "CONTROL") return "CONTROL";
  if (dtype === "SUBMISSION_CONTROL" || dtype === "SUBMISSION_RULES") return dtype;
  const label = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${dtype} ${fmt} ${rev} ${gen}`.toUpperCase();
  if (/QUICK_DRAFT|DRAFT_ONLY|MARKDOWN/.test(label)) return "INTERNAL_DRAFT";
  return "EXCLUDED_INTERNAL_ROW";
}

export async function GET(req: Request) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (error) {
      return error instanceof Error && error.message === "Forbidden"
        ? forbiddenResponse()
        : unauthorizedResponse();
    }
    await prismaReady;

    const url = new URL(req.url);
    const tenderIdParam = url.searchParams.get("tenderId");
    const limitParam = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "20") || 20));
    const includeReady = (url.searchParams.get("includeReady") ?? "").toLowerCase() === "true";
    const severityParam = (url.searchParams.get("severity") ?? "").toUpperCase();
    const severityFilter: Severity | null =
      severityParam === "HIGH" || severityParam === "MEDIUM" || severityParam === "LOW"
        ? (severityParam as Severity)
        : null;

    const where = tenderIdParam ? { tenderId: tenderIdParam } : {};
    const docs = await prisma.generatedDocument.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limitParam * 2,
      select: {
        id: true,
        tenderId: true,
        name: true,
        exactFileName: true,
        exactOrder: true,
        documentType: true,
        format: true,
        generationStatus: true,
        validationStatus: true,
        reviewStatus: true,
        fileContent: true,
        storagePath: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const tenderIds = Array.from(new Set(docs.map((document) => document.tenderId)));
    const tenders = await prisma.tender.findMany({
      where: { id: { in: tenderIds } },
      select: { id: true, title: true },
    });
    const tenderTitleById = new Map(tenders.map((tender) => [tender.id, tender.title]));

    const rows: AuditRow[] = [];
    for (const document of docs) {
      const candidate = isFinalExportCandidateDocument(document);
      const excludedReason = candidate ? null : describeExclusionReason(document);
      const hasFileContent = Boolean(document.fileContent && document.fileContent.length > 0);
      const hasStoragePath = Boolean(document.storagePath && document.storagePath.length > 0);
      const missingContentIssue = candidate && !hasFileContent && !hasStoragePath;
      const fileName = document.exactFileName ?? document.name ?? "generated-document";

      let byteSignatureOk: boolean | null = null;
      if (hasFileContent && document.fileContent) {
        byteSignatureOk = validateFileSignature(fileName, document.fileContent).ok;
      }

      let visibleText: string | null = null;
      let docxVisibleTextInspectable = false;
      let storageReadable: boolean | null = null;
      const inlineBase64 = document.fileContent ?? null;
      if (inlineBase64 && inlineBase64.length > 0 && inlineBase64.length < 2_000_000) {
        try {
          visibleText = await extractDocxVisibleText(inlineBase64, fileName);
          docxVisibleTextInspectable = visibleText !== null;
        } catch {
          docxVisibleTextInspectable = false;
        }
      } else if (hasStoragePath && document.storagePath) {
        try {
          const { getStorageAdapter } = await import("../../../../../lib/storage");
          const storage = getStorageAdapter();
          const buffer = await storage.getFile({
            storagePath: document.storagePath,
            fileContent: null,
            fileName,
          });
          storageReadable = true;
          if (buffer.length < 2_000_000) {
            const base64FromStorage = buffer.toString("base64");
            visibleText = await extractDocxVisibleText(base64FromStorage, fileName).catch(() => null);
            docxVisibleTextInspectable = visibleText !== null;
            if (byteSignatureOk === null) {
              byteSignatureOk = validateFileSignature(fileName, base64FromStorage).ok;
            }
          }
        } catch {
          storageReadable = false;
        }
      }

      const hygieneTarget = visibleText ?? (inlineBase64 ?? "");
      const hygiene = hygieneTarget ? documentHygieneIssues(hygieneTarget, document) : [];
      const aiTraceIssue = hygiene.some((reason) => /AI\/meta-preparation/i.test(reason));
      const placeholderIssue = hygiene.some((reason) => /Placeholder/i.test(reason));
      const pricingLeakageIssue = hygiene.some((reason) => /pricing language/i.test(reason))
        || (visibleText ? containsPricingLeakage(visibleText, document) : false);
      const officialOriginalPlaceholderRisk = detectOfficialOriginalRisk(document);

      const quality = visibleText
        ? assessGeneratedDocumentQuality({
            doc: document,
            visibleText,
            rawFileContent: inlineBase64,
            hasStoragePath,
          })
        : null;
      const wordCount = quality?.wordCount ?? 0;
      const sectionCount = quality?.sectionCount ?? 0;
      const requiredSectionsPresent = quality?.requiredSectionsPresent ?? [];
      const missingRequiredSections = quality?.missingRequiredSections ?? [];
      const requirementCoverageRatio = quality?.requirementCoverageRatio ?? 0;
      const qualityScore = quality?.score ?? 0;
      const qualityRecommendedStatus = quality?.recommendedStatus ?? (visibleText ? "PASSED" : "DRAFT_ONLY");
      const issueCodes = new Set(quality?.issues.map((issue) => issue.code) ?? []);
      const bidTeamToConfirmIssue = issueCodes.has("BID_TEAM_TO_CONFIRM")
        || (visibleText ? METADATA_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(visibleText)) : false);
      const genericContentIssue = issueCodes.has("GENERIC_FILLER");
      const unsupportedClaimRisk = issueCodes.has("UNSUPPORTED_CLAIM_RISK");
      const internalTraceabilityIssue = issueCodes.has("INTERNAL_TRACEABILITY");
      const duplicatedSectionsIssue = issueCodes.has("DUPLICATED_SECTIONS");

      const generated = isGenerated(document.generationStatus);
      const validated = isValidationPassed(document.validationStatus);
      const reviewed = isReviewReadyForExport(document.reviewStatus);
      const state = deriveDocumentOutputState(document);
      const readyForExport = candidate && generated && validated && reviewed && state === "READY_FOR_EXPORT";
      const zipEligible = readyForExport
        && !missingContentIssue
        && byteSignatureOk !== false
        && !officialOriginalPlaceholderRisk;
      const envelope = inferEnvelope(
        document.documentType ?? "TECHNICAL",
        document.exactFileName ?? document.name ?? "",
      );

      const row: AuditRow = {
        tenderId: document.tenderId,
        tenderTitle: tenderTitleById.get(document.tenderId) ?? document.tenderId,
        documentId: document.id,
        documentName: document.name,
        exactFileName: document.exactFileName,
        documentType: document.documentType,
        envelope,
        format: document.format,
        generationStatus: document.generationStatus,
        validationStatus: document.validationStatus,
        reviewStatus: document.reviewStatus,
        finalExportCandidate: candidate,
        excludedReason,
        hasFileContent,
        hasStoragePath,
        storageReadable,
        byteSignatureOk,
        docxVisibleTextInspectable,
        wordCount,
        sectionCount,
        requiredSectionsPresent,
        missingRequiredSections,
        requirementCoverageRatio,
        qualityScore,
        qualityRecommendedStatus,
        aiTraceIssue,
        placeholderIssue,
        bidTeamToConfirmIssue,
        pricingLeakageIssue,
        genericContentIssue,
        unsupportedClaimRisk,
        internalTraceabilityIssue,
        officialOriginalPlaceholderRisk,
        missingContentIssue,
        duplicatedSectionsIssue,
        readyForExport,
        zipEligible,
        recommendedAction: "",
        severity: "LOW",
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      };
      const verdict = why(row);
      row.recommendedAction = verdict.recommendedAction;
      row.severity = verdict.severity;
      rows.push(row);
    }

    const hasIssue = (row: AuditRow) =>
      row.missingContentIssue
      || row.officialOriginalPlaceholderRisk
      || row.byteSignatureOk === false
      || row.pricingLeakageIssue
      || row.aiTraceIssue
      || row.placeholderIssue
      || row.bidTeamToConfirmIssue
      || row.genericContentIssue
      || row.unsupportedClaimRisk
      || row.internalTraceabilityIssue
      || row.duplicatedSectionsIssue
      || row.qualityRecommendedStatus !== "PASSED"
      || (!row.readyForExport && row.finalExportCandidate);

    let visibleRows = includeReady ? rows : rows.filter(hasIssue);
    if (severityFilter) visibleRows = visibleRows.filter((row) => row.severity === severityFilter);
    visibleRows = visibleRows.slice(0, limitParam);

    const summary = {
      totalGeneratedDocuments: rows.length,
      currentOutputs: rows.filter((row) => row.finalExportCandidate && row.generationStatus === "GENERATED").length,
      staleOutputs: rows.filter((row) => !row.finalExportCandidate).length,
      finalExportCandidates: rows.filter((row) => row.finalExportCandidate).length,
      readyForExport: rows.filter((row) => row.readyForExport).length,
      blockedDocuments: rows.filter((row) => row.finalExportCandidate && !row.readyForExport).length,
      qualityFailed: rows.filter((row) => row.qualityRecommendedStatus === "QUALITY_FAILED").length,
      missingRequiredDocs: 0,
      missingContent: rows.filter((row) => row.missingContentIssue).length,
      invalidSignatures: rows.filter((row) => row.byteSignatureOk === false).length,
      aiTraceIssues: rows.filter((row) => row.aiTraceIssue).length,
      placeholderIssues: rows.filter((row) => row.placeholderIssue).length,
      bidTeamToConfirmIssues: rows.filter((row) => row.bidTeamToConfirmIssue).length,
      pricingLeakageIssues: rows.filter((row) => row.pricingLeakageIssue).length,
      genericContentIssues: rows.filter((row) => row.genericContentIssue).length,
      unsupportedClaimRisks: rows.filter((row) => row.unsupportedClaimRisk).length,
      internalTraceabilityIssues: rows.filter((row) => row.internalTraceabilityIssue).length,
      duplicatedSectionsIssues: rows.filter((row) => row.duplicatedSectionsIssue).length,
      officialOriginalRisks: rows.filter((row) => row.officialOriginalPlaceholderRisk).length,
      staleInternalRows: rows.filter((row) => !row.finalExportCandidate).length,
    };

    return NextResponse.json({
      success: true,
      actor: { id: actor.id, role: actor.role },
      query: {
        tenderId: tenderIdParam,
        limit: limitParam,
        includeReady,
        severity: severityFilter,
      },
      summary,
      documents: visibleRows,
    });
  } catch (error) {
    logger.error("admin generated-proposals audit failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return jsonError("Admin audit failed.", 500, {
      code: "ADMIN_AUDIT_RUNTIME_ERROR",
      requestId,
    });
  }
}
