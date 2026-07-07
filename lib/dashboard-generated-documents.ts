export type DashboardGeneratedDocument = {
  id: string;
  name: string;
  exactFileName?: string | null;
  exactOrder?: number | null;
  documentType?: string | null;
  generationStatus?: string | null;
  validationStatus?: string | null;
  reviewStatus?: string | null;
  reviewNotes?: string | null;
  storagePath?: string | null;
  hasInlineFileContent?: boolean | null;
};

export type DashboardGeneratedDocumentSummary = {
  total: number;
  shown: number;
  hiddenHistorical: number;
  hiddenPlanned: number;
  hiddenDuplicates: number;
  replacementRequired: number;
  readyForExport: number;
};

function normalizeStatus(value?: string | null): string {
  const status = (value ?? "").trim().toUpperCase();
  // A few historical rows in production were displayed with a typo. Normalize
  // defensively so UI filtering does not leak stale status noise.
  if (status === "SUPSERSEDED") return "SUPERSEDED";
  return status;
}

function docDisplayName(doc: DashboardGeneratedDocument): string {
  return (doc.exactFileName ?? doc.name ?? doc.id ?? "generated-document").trim();
}

function docKey(doc: DashboardGeneratedDocument): string {
  return docDisplayName(doc)
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHistoricalGeneratedDocument(doc: DashboardGeneratedDocument): boolean {
  const generation = normalizeStatus(doc.generationStatus);
  const validation = normalizeStatus(doc.validationStatus);
  const review = normalizeStatus(doc.reviewStatus);
  const notes = doc.reviewNotes ?? "";
  return generation === "SUPERSEDED"
    || validation === "SUPERSEDED"
    || review === "SUPERSEDED"
    || /\bmarked\s+superse?ded\b|\bsuperseded\s+by\b/i.test(notes);
}

export function isPlannedGeneratedDocument(doc: DashboardGeneratedDocument): boolean {
  return normalizeStatus(doc.generationStatus) === "PLANNED";
}

export function isReplacementRequiredDocument(doc: DashboardGeneratedDocument): boolean {
  return !isHistoricalGeneratedDocument(doc) && normalizeStatus(doc.reviewStatus) === "REPLACE_WITH_ORIGINAL";
}

export function isReadyForExportDocument(doc: DashboardGeneratedDocument): boolean {
  const generation = normalizeStatus(doc.generationStatus);
  const validation = normalizeStatus(doc.validationStatus);
  const review = normalizeStatus(doc.reviewStatus);
  return !isHistoricalGeneratedDocument(doc)
    && generation === "GENERATED"
    && (validation === "PASSED" || validation === "VALIDATED")
    && (review === "READY_FOR_EXPORT" || review === "APPROVED");
}

function priority(doc: DashboardGeneratedDocument): number {
  if (isHistoricalGeneratedDocument(doc)) return 900;
  if (isPlannedGeneratedDocument(doc)) return 800;
  if (isReadyForExportDocument(doc)) return 0;
  if (isReplacementRequiredDocument(doc)) return 20;
  if (normalizeStatus(doc.validationStatus) === "NEEDS_REVALIDATION") return 40;
  if (normalizeStatus(doc.generationStatus) === "GENERATED") return 60;
  return 100;
}

function compareDocs(a: DashboardGeneratedDocument, b: DashboardGeneratedDocument): number {
  const p = priority(a) - priority(b);
  if (p !== 0) return p;
  const order = (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER);
  if (order !== 0) return order;
  return docDisplayName(a).localeCompare(docDisplayName(b));
}

export function prepareDashboardGeneratedDocuments<T extends DashboardGeneratedDocument>(docs: T[]): { documents: T[]; summary: DashboardGeneratedDocumentSummary } {
  const total = docs.length;
  const hiddenHistorical = docs.filter(isHistoricalGeneratedDocument).length;
  const hiddenPlanned = docs.filter((doc) => !isHistoricalGeneratedDocument(doc) && isPlannedGeneratedDocument(doc)).length;

  const visibleCandidates = docs
    .filter((doc) => !isHistoricalGeneratedDocument(doc))
    .filter((doc) => !isPlannedGeneratedDocument(doc))
    .slice()
    .sort(compareDocs);

  const byKey = new Map<string, T>();
  let hiddenDuplicates = 0;
  for (const doc of visibleCandidates) {
    const key = docKey(doc) || doc.id;
    if (byKey.has(key)) {
      hiddenDuplicates += 1;
      continue;
    }
    byKey.set(key, doc);
  }

  const documents = Array.from(byKey.values()).sort(compareDocs);
  return {
    documents,
    summary: {
      total,
      shown: documents.length,
      hiddenHistorical,
      hiddenPlanned,
      hiddenDuplicates,
      replacementRequired: documents.filter(isReplacementRequiredDocument).length,
      readyForExport: documents.filter(isReadyForExportDocument).length,
    },
  };
}
