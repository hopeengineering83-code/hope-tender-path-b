export type ExportReadyDocument = {
  id: string;
  name: string;
  exactFileName: string | null;
  generationStatus: string;
  validationStatus: string;
  reviewStatus: string;
  fileContent?: string | null;
};

export type ExportReadinessFailure = {
  documentId: string;
  name: string;
  fileName: string;
  reasons: string[];
};

export type ExportReadinessResult = {
  ok: boolean;
  failures: ExportReadinessFailure[];
};

function generatedFileName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]/g, "-")}.docx`;
}

export function isReadyForFinalExport(doc: ExportReadyDocument): boolean {
  return doc.generationStatus === "GENERATED" && doc.validationStatus === "VALIDATED" && doc.reviewStatus === "READY_FOR_EXPORT";
}

export function checkExportReadiness(docs: ExportReadyDocument[], opts: { requireFileContent?: boolean } = {}): ExportReadinessResult {
  const failures: ExportReadinessFailure[] = [];

  for (const doc of docs) {
    const reasons: string[] = [];
    if (doc.generationStatus !== "GENERATED") reasons.push(`generationStatus is ${doc.generationStatus}, expected GENERATED`);
    if (doc.validationStatus !== "VALIDATED") reasons.push(`validationStatus is ${doc.validationStatus}, expected VALIDATED`);
    if (doc.reviewStatus !== "READY_FOR_EXPORT") reasons.push(`reviewStatus is ${doc.reviewStatus}, expected READY_FOR_EXPORT`);
    if (opts.requireFileContent && !doc.fileContent) reasons.push("fileContent is missing");

    if (reasons.length > 0) {
      failures.push({
        documentId: doc.id,
        name: doc.name,
        fileName: doc.exactFileName ?? generatedFileName(doc.name),
        reasons,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

export function exportReadinessError(failures: ExportReadinessFailure[]): string {
  // PR PP — return an actionable error message that names each blocking
  // document and the specific reasons. Without this, the user saw only
  // "Final export blocked: N documents are not ready for export" with no
  // way to know what to fix.
  if (failures.length === 0) return "";
  const summary = failures.length === 1
    ? "Final export blocked: 1 document is not ready for export."
    : `Final export blocked: ${failures.length} documents are not ready for export.`;
  const details = failures
    .slice(0, 6)
    .map((f) => `• ${f.fileName} — ${f.reasons.join("; ")}`)
    .join("\n");
  const truncationNote = failures.length > 6 ? `\n• … and ${failures.length - 6} more` : "";
  return `${summary}\n${details}${truncationNote}`;
}
