import { logger } from "../../../../../lib/observability";
// ─── Admin generated-proposal audit endpoint ─────────────────────────────
//
// Why this exists:
//   Generated proposal content lives behind authenticated session cookies,
//   so /api/tenders/* correctly returns 401 to unauthenticated callers.
//   That makes external production auditing impossible without an app
//   session. This endpoint gives ADMIN users a safe, structured way to
//   audit the health of every generated proposal across all users without
//   leaking the proposal body text.
//
// Security guarantees:
//   - ADMIN role only.
//   - Returns metadata + issue flags ONLY. No proposal text or content
//     bytes ever flow through this response.
//   - Issue snippets are NOT returned. The caller gets:
//       * boolean issue flags (aiTrace, placeholder, pricingLeakage, etc.)
//       * a recommendedAction string per row
//       * aggregate counts at the top
//   - Pagination via ?limit=20 (max 200).
//   - Optional ?tenderId=… to scope a single tender (still ADMIN-only).
//
// Use cases:
//   - "Show me every generated DOCX across production that has AI traces"
//   - "Show me every tender with strict two-envelope risk"
//   - "Show me every generated proposal that has no file content"
//   - "Show me every official-original placeholder still blocking export"
//
// Query parameters:
//   tenderId      — optional; restrict to a single tender
//   limit         — optional; 1..200, default 20
//   includeReady  — optional "true|false"; when false (default), only rows
//                   with at least one issue are returned. When true, every
//                   row is returned for full inventory.
//   severity      — optional "HIGH|MEDIUM|LOW"; filter by recommended-action
//                   severity. Computed from the per-doc reasons.
//
// Response shape (no body text leaks):
//   {
//     success: true,
//     summary: { totalGeneratedDocuments, finalExportCandidates,
//                readyForExport, blockedDocuments, missingContent,
//                invalidSignatures, aiTraceIssues, placeholderIssues,
//                pricingLeakageIssues, officialOriginalRisks,
//                staleInternalRows },
//     documents: [ { tenderId, tenderTitle, documentId, documentName,
//                    exactFileName, documentType, envelope, format,
//                    generationStatus, validationStatus, reviewStatus,
//                    finalExportCandidate, excludedReason,
//                    hasFileContent, hasStoragePath, storageReadable,
//                    byteSignatureOk, docxVisibleTextInspectable,
//                    aiTraceIssue, placeholderIssue, pricingLeakageIssue,
//                    officialOriginalPlaceholderRisk, readyForExport,
//                    zipEligible, recommendedAction, createdAt, updatedAt
//                    } ]
//   }

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
import { sanitizeError } from "../../../../../lib/sanitize-error";

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
  // ── Quality-gate fields (Part 14) ──────────────────────────────────────
  wordCount: number;
  sectionCount: number;
  requiredSectionsPresent: string[];
  missingRequiredSections: string[];
  requirementCoverageRatio: number;
  qualityScore: number;
  qualityRecommendedStatus: string;
  // ── Issue flags (booleans only — no body text leaks) ─────────────────
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
  // ── Outcome ───────────────────────────────────────────────────────────
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
    return { recommendedAction: `${reason} — not a final-export file. Use Generate Docs to produce the actual submission file.`, severity: "LOW" };
  }
  if (!row.readyForExport) {
    return { recommendedAction: "Document is not yet READY_FOR_EXPORT. Complete validation + reviewer approval.", severity: "MEDIUM" };
  }
  return { recommendedAction: "OK — ready for final export.", severity: "LOW" };
}

function detectOfficialOriginalRisk(doc: { name: string | null; exactFileName: string | null; documentType: string | null; reviewStatus: string | null; format: string | null }): boolean {
  const label = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${doc.documentType ?? ""} ${doc.reviewStatus ?? ""} ${doc.format ?? ""}`.toUpperCase();
  if (label.includes("REPLACE_WITH_ORIGINAL")) return true;
  if (label.includes("NOT_EXPORTABLE") && /BID FORM|TENDER FORM|TEMPLATE|DECLARATION|UNDERTAKING|INTEGRITY PACT|BID BOND|RATE CARD|TIN|VAT|TAX CLEARANCE|AUDITED|TRADE LICENSE/.test(label)) return true;
  return false;
}

function describeExclusionReason(doc: { generationStatus: string; validationStatus: string; reviewStatus: string; format: string | null; documentType: string | null; name: string | null; exactFileName: string | null }): string | null {
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
  // Internal-draft heuristic (QUICK_DRAFT / DRAFT_ONLY / Markdown).
  const label = `${doc.name ?? ""} ${doc.exactFileName ?? ""} ${dtype} ${fmt} ${rev} ${gen}`.toUpperCase();
  if (/QUICK_DRAFT|DRAFT_ONLY|MARKDOWN/.test(label)) return "INTERNAL_DRAFT";
  return "EXCLUDED_INTERNAL_ROW";
}

export async function GET(req: Request) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }
    await prismaReady;

    const url = new URL(req.url);
    const tenderIdParam = url.searchParams.get("tenderId");
    const limitParam = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? "20") || 20));
    const includeReady = (url.searchParams.get("includeReady") ?? "").toLowerCase() === "true";
    const severityParam = (url.searchParams.get("severity") ?? "").toUpperCase();
    const severityFilter: Severity | null =
      severityParam === "HIGH" || severityParam === "MEDIUM" || severityParam === "LOW" ? (severityParam as Severity) : null;

    // Pull a bounded slice: most recently updated generated docs across all
    // tenders. Filtering by tenderId narrows to a single tender. We never
    // load fileContent for ALL rows up front — we stream document-by-document
    // and only decode DOCX visible text when the file is small enough
    // (<2MB base64) to avoid blowing Vercel memory on big PDFs.
    const where = tenderIdParam ? { tenderId: tenderIdParam } : {};
    const docs = await prisma.generatedDocument.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limitParam * 2, // overfetch so the issue filter can find enough
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

    const tenderIds = Array.from(new Set(docs.map((d) => d.tenderId)));
    const tenders = await prisma.tender.findMany({
      where: { id: { in: tenderIds } },
      select: { id: true, title: true },
    });
    const tenderTitleById = new Map(tenders.map((t) => [t.id, t.title]));

    const rows: AuditRow[] = [];
    for (const d of docs) {
      const candidate = isFinalExportCandidateDocument(d);
      const excludedReason = candidate ? null : describeExclusionReason(d);
      const hasFileContent = Boolean(d.fileContent && d.fileContent.length > 0);
      const hasStoragePath = Boolean(d.storagePath && d.storagePath.length > 0);
      const missingContentIssue = candidate && !hasFileContent && !hasStoragePath;
      const fileName = d.exactFileName ?? d.name ?? "generated-document";

      let byteSignatureOk: boolean | null = null;
      if (hasFileContent && d.fileContent) {
        const sig = validateFileSignature(fileName, d.fileContent);
        byteSignatureOk = sig.ok;
      }

      // Decode DOCX visible text from inline base64 (small enough) or from
      // storagePath for storage-backed documents (capped at 2 MB to bound RAM).
      let visibleText: string | null = null;
      let docxVisibleTextInspectable = false;
      let storageReadable: boolean | null = hasStoragePath ? null : null;
      const inlineBase64 = d.fileContent ?? null;
      if (inlineBase64 && inlineBase64.length > 0 && inlineBase64.length < 2_000_000) {
        try {
          visibleText = await extractDocxVisibleText(inlineBase64, fileName);
          docxVisibleTextInspectable = visibleText !== null;
          storageReadable = null; // inline path — storage not consulted
        } catch {
          docxVisibleTextInspectable = false;
        }
      } else if (hasStoragePath && d.storagePath) {
        // Attempt to read from storage for docs without inline content.
        try {
          const { getStorageAdapter } = await import("../../../../../lib/storage");
          const storage = getStorageAdapter();
          const buf = await storage.getFile({ storagePath: d.storagePath, fileContent: null, fileName });
          storageReadable = true;
          if (buf.length < 2_000_000) {
            const base64FromStorage = buf.toString("base64");
            visibleText = await extractDocxVisibleText(base64FromStorage, fileName).catch(() => null);
            docxVisibleTextInspectable = visibleText !== null;
            if (!byteSignatureOk && byteSignatureOk !== false) {
              byteSignatureOk = validateFileSignature(fileName, base64FromStorage).ok;
            }
          } else {
            docxVisibleTextInspectable = false; // too large
          }
        } catch {
          storageReadable = false;
        }
      }

      // Pure-text hygiene (works on either plain-text fileContent or the
      // decoded DOCX visible text). We never return the matching text — only
      // the flags.
      const hygieneTarget = visibleText ?? (inlineBase64 ?? "");
      const hygiene = hygieneTarget ? documentHygieneIssues(hygieneTarget, d) : [];
      const aiTraceIssue = hygiene.some((r) => /AI\/meta-preparation/i.test(r));
      const placeholderIssue = hygiene.some((r) => /Placeholder/i.test(r));
      const pricingLeakageIssue = hygiene.some((r) => /pricing language/i.test(r)) || (visibleText ? containsPricingLeakage(visibleText, d) : false);
      const officialOriginalPlaceholderRisk = detectOfficialOriginalRisk(d);

      // ── Quality-gate per document (Part 14). Runs only when we have visible
      // text; otherwise we mark it inspectable=false and skip the gate so
      // we don't penalise documents whose body lives in storage we did not
      // fetch in this bulk audit.
      const quality = visibleText
        ? assessGeneratedDocumentQuality({ doc: d, visibleText, rawFileContent: inlineBase64, hasStoragePath })
        : null;
      const wordCount = quality?.wordCount ?? 0;
      const sectionCount = quality?.sectionCount ?? 0;
      const requiredSectionsPresent = quality?.requiredSectionsPresent ?? [];
      const missingRequiredSections = quality?.missingRequiredSections ?? [];
      const requirementCoverageRatio = quality?.requirementCoverageRatio ?? 0;
      const qualityScore = quality?.score ?? 0;
      const qualityRecommendedStatus = quality?.recommendedStatus ?? (visibleText ? "PASSED" : "DRAFT_ONLY");
      // Issue flags derived from the quality gate so the admin audit
      // surface lines up with the gate's verdict.
      const issueCodes = new Set(quality?.issues.map((i) => i.code) ?? []);
      const bidTeamToConfirmIssue = issueCodes.has("BID_TEAM_TO_CONFIRM") || (visibleText ? METADATA_PLACEHOLDER_PATTERNS.some((rx) => rx.test(visibleText)) : false);
      const genericContentIssue = issueCodes.has("GENERIC_FILLER");
      const unsupportedClaimRisk = issueCodes.has("UNSUPPORTED_CLAIM_RISK");
      const internalTraceabilityIssue = issueCodes.has("INTERNAL_TRACEABILITY");
      const duplicatedSectionsIssue = issueCodes.has("DUPLICATED_SECTIONS");

      const generated = isGenerated(d.generationStatus);
      const validated = isValidationPassed(d.validationStatus);
      const reviewed = isReviewReadyForExport(d.reviewStatus);
      const state = deriveDocumentOutputState(d);
      const readyForExport = candidate && generated && validated && reviewed && state === "READY_FOR_EXPORT";
      const zipEligible = readyForExport && !missingContentIssue && byteSignatureOk !== false && !officialOriginalPlaceholderRisk;
      const envelope = inferEnvelope(d.documentType ?? "TECHNICAL", d.exactFileName ?? d.name ?? "");

      const partial: AuditRow = {
        tenderId: d.tenderId,
        tenderTitle: tenderTitleById.get(d.tenderId) ?? d.tenderId,
        documentId: d.id,
        documentName: d.name,
        exactFileName: d.exactFileName,
        documentType: d.documentType,
        envelope,
        format: d.format,
        generationStatus: d.generationStatus,
        validationStatus: d.validationStatus,
        reviewStatus: d.reviewStatus,
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
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      };
      const verdict = why(partial);
      partial.recommendedAction = verdict.recommendedAction;
      partial.severity = verdict.severity;
      rows.push(partial);
    }

    const hasIssue = (r: AuditRow) =>
      r.missingContentIssue || r.officialOriginalPlaceholderRisk || r.byteSignatureOk === false ||
      r.pricingLeakageIssue || r.aiTraceIssue || r.placeholderIssue || r.bidTeamToConfirmIssue ||
      r.genericContentIssue || r.unsupportedClaimRisk || r.internalTraceabilityIssue ||
      r.duplicatedSectionsIssue || r.qualityRecommendedStatus !== "PASSED" ||
      (!r.readyForExport && r.finalExportCandidate);

    let visibleRows = includeReady ? rows : rows.filter(hasIssue);
    if (severityFilter) visibleRows = visibleRows.filter((r) => r.severity === severityFilter);
    visibleRows = visibleRows.slice(0, limitParam);

    const summary = {
      totalGeneratedDocuments: rows.length,
      currentOutputs: rows.filter((r) => r.finalExportCandidate && r.generationStatus === "GENERATED").length,
      staleOutputs: rows.filter((r) => !r.finalExportCandidate).length,
      finalExportCandidates: rows.filter((r) => r.finalExportCandidate).length,
      readyForExport: rows.filter((r) => r.readyForExport).length,
      blockedDocuments: rows.filter((r) => r.finalExportCandidate && !r.readyForExport).length,
      qualityFailed: rows.filter((r) => r.qualityRecommendedStatus === "QUALITY_FAILED").length,
      missingRequiredDocs: 0, // Computed at the tender level by the canonical helper, not in the bulk audit.
      missingContent: rows.filter((r) => r.missingContentIssue).length,
      invalidSignatures: rows.filter((r) => r.byteSignatureOk === false).length,
      aiTraceIssues: rows.filter((r) => r.aiTraceIssue).length,
      placeholderIssues: rows.filter((r) => r.placeholderIssue).length,
      bidTeamToConfirmIssues: rows.filter((r) => r.bidTeamToConfirmIssue).length,
      pricingLeakageIssues: rows.filter((r) => r.pricingLeakageIssue).length,
      genericContentIssues: rows.filter((r) => r.genericContentIssue).length,
      unsupportedClaimRisks: rows.filter((r) => r.unsupportedClaimRisk).length,
      internalTraceabilityIssues: rows.filter((r) => r.internalTraceabilityIssue).length,
      duplicatedSectionsIssues: rows.filter((r) => r.duplicatedSectionsIssue).length,
      officialOriginalRisks: rows.filter((r) => r.officialOriginalPlaceholderRisk).length,
      staleInternalRows: rows.filter((r) => !r.finalExportCandidate).length,
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
    logger.error("admin generated-proposals audit failed", { detail: error });
    return jsonError("Admin audit failed.", 500, { code: "ADMIN_AUDIT_RUNTIME_ERROR", detail: sanitizeError(error) });
  }
}
