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
  if (failures.length === 1) return "Final export blocked: 1 document is not ready for export.";
  return `Final export blocked: ${failures.length} documents are not ready for export.`;
}
