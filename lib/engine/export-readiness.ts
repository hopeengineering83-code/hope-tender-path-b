import { prisma, prismaReady } from "../prisma";
import { getStorageAdapter } from "../storage";
import { isValidClientName } from "./metadata-validators";
import {
  deriveDocumentOutputState,
  exportBlockReason,
  EXPORT_BLOCKING_STATES,
  isGenerated,
  type DocumentOutputState,
  type DocumentLike,
} from "./document-output-state";
import { containsPricingLeakage, isCommercialOrFinancialDoc } from "./pricing-hygiene";
import { detectSubmissionPackageMode } from "./submission-package-mode";
import { safeParseJsonArray } from "../safe-json";
import { PLACEHOLDER_RE, AI_TRACE_RE } from "./detection-patterns";

export type ExportReadyDocument = {
  id: string;
  name: string;
  exactFileName: string | null;
  exactOrder?: number | null;
  documentType?: string | null;
  format?: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent?: string | null;
  storagePath?: string | null;
  contentSummary?: string | null;
  reviewNotes?: string | null;
};

export type ExportReadinessFailure = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
};

export type ExportReadinessTenderBlocker = {
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  recommendedAction: string;
};

export type ExportReadinessResult = {
  ok: boolean;
  score: number; // 0-100
  blockers: { code: string; message: string; severity: "BLOCK" | "WARN" }[];
  documentStates: Record<string, DocumentOutputState>;
  mode: "SINGLE_DOC" | "ZIP_PACKAGE";
  packageMode: "TECHNICAL_ONLY" | "TWO_ENVELOPE" | "COMBINED";
  failures: ExportReadinessFailure[];
  advisoryWarnings: any[];
  tenderLevelBlockers: ExportReadinessTenderBlocker[];
};

export function documentHygieneIssues(text: string | null, doc: { name: string; documentType?: string | null }): string[] {
  if (!text) return [];
  const issues: string[] = [];
  if (PLACEHOLDER_RE.test(text)) issues.push("Placeholder detected (e.g. [TBD], [INSERT], XXX)");
  if (AI_TRACE_RE.test(text)) issues.push("AI/meta-preparation trace detected");
  if (!isCommercialOrFinancialDoc(doc.documentType ?? "TECHNICAL", doc.name) && containsPricingLeakage(text)) {
    issues.push("Potential pricing language found in technical content");
  }
  return issues;
}

export function filePlanBlockersFromLists(
  docs: ExportReadyDocument[],
  exactFileNaming: string | null,
  exactFileOrder: string | null
): ExportReadinessTenderBlocker[] {
  const blockers: ExportReadinessTenderBlocker[] = [];
  const naming = safeParseJsonArray(exactFileNaming);
  if (naming.length > 0) {
    const extra = docs.filter(d => !naming.some((n: any) => (typeof n === 'string' ? n : n.name).toLowerCase() === (d.exactFileName || d.name || "").toLowerCase()));
    if (extra.length > 0) {
      blockers.push({ category: "EXTRA_FILES", severity: "HIGH", title: `${extra.length} extra document(s) generated`, recommendedAction: "Update naming list" });
    }
  }
  const seenOrders = new Set<number>();
  let hasDuplicateOrder = false;
  for (const doc of docs) {
    if (doc.exactOrder != null) {
      if (seenOrders.has(doc.exactOrder)) hasDuplicateOrder = true;
      seenOrders.add(doc.exactOrder);
    }
  }
  if (hasDuplicateOrder) {
    blockers.push({ category: "DUPLICATE_EXACT_ORDER", severity: "HIGH", title: "Duplicate exactOrder values", recommendedAction: "Ensure unique sequence numbers" });
  }
  return blockers;
}

export async function extractDocxVisibleText(buffer: string | Buffer | null, _fileName?: string): Promise<string | null> {
  if (!buffer) return null;
  try {
    const mammoth = await import("mammoth");
    const buf = typeof buffer === 'string' ? Buffer.from(buffer, 'base64') : buffer;
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  } catch {
    return null;
  }
}

export function checkExportReadiness(docs: ExportReadyDocument[], options: { requireFileContent?: boolean } = {}): any {
  const failures: ExportReadinessFailure[] = [];
  for (const doc of docs) {
    const state = deriveDocumentOutputState(doc as any);
    const reasons: string[] = [];
    if (EXPORT_BLOCKING_STATES.includes(state)) reasons.push(exportBlockReason(state));
    if (options.requireFileContent && !doc.fileContent && !doc.storagePath) reasons.push("fileContent is missing");
    reasons.push(...documentHygieneIssues(doc.fileContent ?? null, doc));
    if (reasons.length > 0) {
      failures.push({ documentId: doc.id, name: doc.name, fileName: doc.exactFileName || doc.name, reasons });
    }
  }
  return { ok: failures.length === 0, failures };
}

export async function checkFullExportReadiness(opts: {
  tenderId: string;
  docs: ExportReadyDocument[];
  requireFileContent: boolean;
}): Promise<any> {
  await prismaReady;
  const tender = await prisma.tender.findUnique({ where: { id: opts.tenderId }, include: { requirements: true } });
  const docReadiness = checkExportReadiness(opts.docs, { requireFileContent: opts.requireFileContent });
  const tenderLevelBlockers = tender ? filePlanBlockersFromLists(opts.docs, tender.exactFileNaming, tender.exactFileOrder) : [];
  if (tender && !isValidClientName(tender.clientName)) {
    tenderLevelBlockers.push({ category: "INVALID_CLIENT", severity: "CRITICAL", title: "Invalid client name", recommendedAction: "Set valid client name" });
  }
  return { ok: docReadiness.ok && !tenderLevelBlockers.some(b => b.severity === "CRITICAL" || b.severity === "HIGH"), failures: docReadiness.failures, tenderLevelBlockers, advisoryWarnings: [] };
}

export function exportReadinessError(failures: ExportReadinessFailure[], tenderBlockers: any[] = []): string {
  const parts = failures.map(f => `${f.fileName}: ${f.reasons.join(", ")}`);
  parts.push(...tenderBlockers.map(b => `${b.title} (Action: ${b.recommendedAction})`));
  return parts.join("; ") || "Tender not ready for export.";
}

export function isDocumentExportable(doc: DocumentLike): boolean {
  return !EXPORT_BLOCKING_STATES.includes(deriveDocumentOutputState(doc));
}

export async function checkDocxHygieneReadiness(docs: ExportReadyDocument[]): Promise<ExportReadinessFailure[]> {
  const failures: ExportReadinessFailure[] = [];
  const adapter = getStorageAdapter();
  for (const doc of docs) {
    let text = doc.fileContent;
    if (!text && doc.storagePath) {
      try {
        const buffer = await adapter.getFile({ storagePath: doc.storagePath, fileContent: null, fileName: doc.name });
        text = (await extractDocxVisibleText(buffer)) ?? null;
      } catch {}
    }
    const issues = documentHygieneIssues(text ?? null, doc);
    if (issues.length > 0) {
      failures.push({ documentId: doc.id, name: doc.name, fileName: doc.exactFileName || doc.name, reasons: issues.map(i => `${i} (inside DOCX)`) });
    }
  }
  return failures;
}
