from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} matches, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


# ---------------------------------------------------------------------------
# 1. Canonical source selection: duplicate uploads must not poison readiness,
#    source revisions, AI Analyze, or Engine input.
# ---------------------------------------------------------------------------
write(
    "lib/tender/canonical-source-files.ts",
    r'''export type CanonicalTenderFileInput = {
  id: string;
  fileName?: string | null;
  originalFileName?: string | null;
  deletionStatus?: string | null;
  contentSha256?: string | null;
  integrityStatus?: string | null;
  extractionScore?: number | null;
  extractionMethod?: string | null;
  totalPages?: number | null;
  extractedPages?: number | null;
  failedPages?: number | null;
  extractedText?: string | null;
  createdAt?: Date | string | null;
};

export type CanonicalTenderSourceReadiness<T extends CanonicalTenderFileInput> = {
  canonicalFiles: T[];
  duplicateFileCount: number;
  byteIntegrityValid: boolean;
  extractionComplete: boolean;
  extractionQualityValid: boolean;
  analysisReady: boolean;
  blockers: string[];
};

const MIN_ANALYSIS_SCORE = 70;

function normalizedLogicalStem(value: unknown): string {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/\s*\((?:copy|duplicate|\d+)\)\s*$/i, "")
    .replace(/\s*[-_]\s*(?:copy|duplicate)\s*$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw;
}

function numericDate(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function coverage(file: CanonicalTenderFileInput): number {
  const total = file.totalPages ?? 0;
  const extracted = file.extractedPages ?? 0;
  const failed = file.failedPages ?? 0;
  if (total <= 0) return file.extractedText && file.extractedText.trim().length >= 100 ? 1 : 0;
  return Math.max(0, Math.min(1, (extracted - failed) / total));
}

function rank(file: CanonicalTenderFileInput): number[] {
  const score = Number.isFinite(file.extractionScore) ? Number(file.extractionScore) : -1;
  const textLength = file.extractedText?.trim().length ?? 0;
  return [
    file.deletionStatus === "ACTIVE" || !file.deletionStatus ? 1 : 0,
    file.integrityStatus === "VERIFIED" ? 1 : 0,
    file.extractionMethod && file.extractionMethod !== "failed" ? 1 : 0,
    score,
    coverage(file),
    Math.min(textLength, 100_000),
    numericDate(file.createdAt),
  ];
}

function compareRank<T extends CanonicalTenderFileInput>(left: T, right: T): number {
  const a = rank(left);
  const b = rank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return left.id.localeCompare(right.id);
}

/**
 * Select one authoritative representation for each logical source document.
 * Exact filename stems are used to collapse the common DOCX/PDF/copy upload
 * pattern. The best verified, extracted representation wins deterministically.
 * Differently named addenda remain separate sources.
 */
export function selectCanonicalTenderFiles<T extends CanonicalTenderFileInput>(files: T[]): T[] {
  const active = files.filter((file) => !file.deletionStatus || file.deletionStatus === "ACTIVE");
  const grouped = new Map<string, T[]>();
  for (const file of active) {
    const stem = normalizedLogicalStem(file.originalFileName || file.fileName);
    const key = stem || (file.contentSha256 ? `sha256:${file.contentSha256.toLowerCase()}` : `id:${file.id}`);
    const rows = grouped.get(key) ?? [];
    rows.push(file);
    grouped.set(key, rows);
  }
  return [...grouped.values()]
    .map((rows) => [...rows].sort(compareRank)[0])
    .sort((left, right) => numericDate(left.createdAt) - numericDate(right.createdAt) || left.id.localeCompare(right.id));
}

export function assessCanonicalTenderSourceReadiness<T extends CanonicalTenderFileInput>(
  files: T[],
): CanonicalTenderSourceReadiness<T> {
  const activeCount = files.filter((file) => !file.deletionStatus || file.deletionStatus === "ACTIVE").length;
  const canonicalFiles = selectCanonicalTenderFiles(files);
  const blockers: string[] = [];

  const byteIntegrityValid = canonicalFiles.length > 0
    && canonicalFiles.every((file) => file.integrityStatus === "VERIFIED" && Boolean(file.contentSha256));
  const extractionComplete = canonicalFiles.length > 0
    && canonicalFiles.every((file) => {
      const textLength = file.extractedText?.trim().length ?? 0;
      const hasSuccessfulMethod = Boolean(file.extractionMethod) && file.extractionMethod !== "failed";
      const hasPositiveScore = Number.isFinite(file.extractionScore) && Number(file.extractionScore) > 0;
      const pageCoverage = coverage(file);
      return hasSuccessfulMethod && hasPositiveScore && textLength >= 100 && pageCoverage >= 0.95;
    });
  const extractionQualityValid = canonicalFiles.length > 0
    && canonicalFiles.every((file) => Number(file.extractionScore ?? -1) >= MIN_ANALYSIS_SCORE);

  if (canonicalFiles.length === 0) blockers.push("No active canonical tender source exists.");
  if (!byteIntegrityValid) blockers.push("Canonical source byte integrity is not verified.");
  if (!extractionComplete) blockers.push("Canonical source extraction is incomplete.");
  if (!extractionQualityValid) blockers.push(`Canonical source extraction quality is below ${MIN_ANALYSIS_SCORE}/100.`);

  return {
    canonicalFiles,
    duplicateFileCount: Math.max(0, activeCount - canonicalFiles.length),
    byteIntegrityValid,
    extractionComplete,
    extractionQualityValid,
    analysisReady: byteIntegrityValid && extractionComplete && extractionQualityValid,
    blockers,
  };
}
''',
)

replace_once(
    "lib/engine/tender-analysis-content.ts",
    'import { formatTenderFileAnalysisMarker } from "./requirement-source-linkage";\n',
    'import { formatTenderFileAnalysisMarker } from "./requirement-source-linkage";\nimport { selectCanonicalTenderFiles } from "../tender/canonical-source-files";\n',
)
replace_once(
    "lib/engine/tender-analysis-content.ts",
    '''  classification?: string | null;\n  createdAt?: Date;\n};''',
    '''  classification?: string | null;\n  createdAt?: Date;\n  deletionStatus?: string | null;\n  contentSha256?: string | null;\n  integrityStatus?: string | null;\n  extractionScore?: number | null;\n  extractionMethod?: string | null;\n  totalPages?: number | null;\n  extractedPages?: number | null;\n  failedPages?: number | null;\n};''',
)
replace_once(
    "lib/engine/tender-analysis-content.ts",
    '  const orderedFiles = [...tender.files].sort((a, b) => {',
    '  const orderedFiles = selectCanonicalTenderFiles(tender.files).sort((a, b) => {',
)

# Snapshot must use the same canonical source set and real byte integrity.
replace_once(
    "lib/engine/tender-release-snapshot.ts",
    'import { EXTRACTION_OVERRIDE_MAX_AGE_MS } from "./readiness-overrides";\n',
    'import { EXTRACTION_OVERRIDE_MAX_AGE_MS } from "./readiness-overrides";\nimport { selectCanonicalTenderFiles } from "../tender/canonical-source-files";\n',
)
replace_once(
    "lib/engine/tender-release-snapshot.ts",
    '''          extractedText: true,\n          extractionScore: true,\n          deletionStatus: true,\n          totalPages: true,\n          pageStatusJson: true,''',
    '''          extractedText: true,\n          extractionScore: true,\n          extractionMethod: true,\n          extractedPages: true,\n          failedPages: true,\n          deletionStatus: true,\n          integrityStatus: true,\n          contentSha256: true,\n          createdAt: true,\n          totalPages: true,\n          pageStatusJson: true,''',
)
replace_once(
    "lib/engine/tender-release-snapshot.ts",
    '  const activeFiles = tender.files.filter((f) => f.deletionStatus === "ACTIVE");',
    '  const activeFiles = selectCanonicalTenderFiles(tender.files.filter((f) => f.deletionStatus === "ACTIVE"));',
)
replace_once(
    "lib/engine/tender-release-snapshot.ts",
    '''    for (const file of extractionFiles) {\n      if (file.corrupted) {''',
    '''    for (const item of fileQualities) {\n      if (item.file.integrityStatus !== "VERIFIED" || !item.file.contentSha256) {\n        extractionBlocker = `Tender source ${item.file.originalFileName} does not have verified stored-byte integrity.`;\n        break;\n      }\n    }\n    for (const file of extractionFiles) {\n      if (extractionBlocker) break;\n      if (file.corrupted) {''',
)

# Tender page props must derive from canonical source state, not every historical row.
replace_once(
    "app/dashboard/tenders/[id]/page.tsx",
    'import { parseTenderPackageSessionResult } from "../../../../lib/tender-package-intake-session";\n',
    'import { parseTenderPackageSessionResult } from "../../../../lib/tender-package-intake-session";\nimport { assessCanonicalTenderSourceReadiness } from "../../../../lib/tender/canonical-source-files";\nimport { DeleteTenderButton } from "../../../../components/delete-tender-button";\n',
)
replace_once(
    "app/dashboard/tenders/[id]/page.tsx",
    'select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true, storagePath: true, extractionScore: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true },',
    'select: { id: true, fileName: true, originalFileName: true, mimeType: true, size: true, classification: true, createdAt: true, storagePath: true, extractionScore: true, extractionMethod: true, totalPages: true, extractedPages: true, ocrPages: true, failedPages: true, deletionStatus: true, contentSha256: true, integrityStatus: true, extractedText: true },',
)
replace_once(
    "app/dashboard/tenders/[id]/page.tsx",
    '''  // sourceIntegrityValid: true when all active files have a non-failed\n  // extraction method and non-null extractionScore. This replaces the\n  // previous hardcoded `sourceIntegrityValid={true}`.\n  const sourceIntegrityValid = tender.files.length > 0\n    && tender.files.every((f) => f.extractionScore !== null && f.extractionScore > 0);\n\n  // extractionComplete: true when at least one file has been successfully\n  // extracted (extractionScore > 0 means text was extracted).\n  const extractionComplete = tender.files.some((f) => f.extractionScore !== null && f.extractionScore > 0);''',
    '''  // Canonical source readiness excludes duplicate/superseded representations\n  // and keeps byte integrity, extraction completion, and extraction quality\n  // as separate facts. A pending duplicate can no longer block a fully\n  // extracted authoritative source, and a weak 25/100 file is never treated\n  // as integrity-valid merely because its score is greater than zero.\n  const sourceReadiness = assessCanonicalTenderSourceReadiness(tender.files);\n  const sourceIntegrityValid = sourceReadiness.byteIntegrityValid;\n  const extractionComplete = sourceReadiness.analysisReady;''',
)
replace_once(
    "app/dashboard/tenders/[id]/page.tsx",
    '      <NextActionPanel tenderId={tender.id} />\n',
    '      <NextActionPanel tenderId={tender.id} />\n      {canMutate ? <div className="flex justify-end"><DeleteTenderButton tenderId={tender.id} tenderTitle={tender.title} /></div> : null}\n',
)

# ---------------------------------------------------------------------------
# 2. Analysis quality must not show 100/100 usable while source/analysis is stale.
# ---------------------------------------------------------------------------
replace_once(
    "components/analysis-quality-panel.tsx",
    'import { statusToSeverity, severityBgClass, severityBorderClass, severityTextClass, scoreToSeverity } from "../lib/ui-tokens";\n',
    'import { statusToSeverity, severityBgClass, severityBorderClass, severityTextClass, scoreToSeverity } from "../lib/ui-tokens";\nimport { getTenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";\n',
)
replace_once(
    "components/analysis-quality-panel.tsx",
    '''  const rawSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender).catch(() => "UNKNOWN" as const);\n  const effectiveFacts = await getEffectiveTenderFacts(prisma, tenderId, userId).catch(() => null);''',
    '''  const rawSource = await detectAnalysisSourceWithApproval(prisma, tenderId, tender).catch(() => "UNKNOWN" as const);\n  const effectiveFacts = await getEffectiveTenderFacts(prisma, tenderId, userId).catch(() => null);\n  const releaseSnapshot = await getTenderReleaseSnapshot(prisma, tenderId, userId).catch(() => null);''',
)
replace_once(
    "components/analysis-quality-panel.tsx",
    '''  const ready = quality.severity !== "POOR" && quality.severity !== "UNSAFE" && analysisSource.risk === "LOW" && !fallbackOnly;''',
    '''  const analysisCurrent = Boolean(\n    releaseSnapshot?.analysis.state === "AI_SUCCEEDED"\n    && releaseSnapshot.analysis.contentHashMatch\n    && releaseSnapshot.analysis.canonicalJobId,\n  );\n  const canonicalExtractionReady = releaseSnapshot?.extraction.overallOk === true;\n  const ready = quality.severity !== "POOR"\n    && quality.severity !== "UNSAFE"\n    && analysisSource.risk === "LOW"\n    && !fallbackOnly\n    && analysisCurrent\n    && canonicalExtractionReady;\n  const displayedScore = ready ? quality.score : Math.min(quality.score, 69);''',
)
replace_once(
    "components/analysis-quality-panel.tsx",
    '<p className="text-xl font-bold text-slate-900">{quality.score}/100</p>',
    '<p className="text-xl font-bold text-slate-900">{displayedScore}/100</p>',
)
replace_all(
    "components/analysis-quality-panel.tsx",
    "Analysis runs automatically once extraction is reliable enough; the source is recorded here when it completes.",
    "Select Run AI Analyze after extraction is reliable; the source is recorded when the manual action completes.",
)
replace_all(
    "components/analysis-quality-panel.tsx",
    "The Engine runs automatically.",
    "Run Engine is a separate manual action.",
)
replace_once(
    "components/analysis-quality-panel.tsx",
    '''      {quality.metadataIssues.length > 0 && (''',
    '''      {!analysisCurrent && (\n        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">\n          The displayed analysis is absent or stale for the current canonical source revision. Run AI Analyze again before Run Engine.\n        </div>\n      )}\n\n      {quality.metadataIssues.length > 0 && (''',
)

# ---------------------------------------------------------------------------
# 3. Run Engine must reuse the current grounded AI Analyze result instead of
#    re-analyzing and losing its source coordinates.
# ---------------------------------------------------------------------------
replace_once(
    "lib/engine/run-tender-engine.ts",
    'import { loadDurableCompanySupportRecords } from "../prisma-schema-compatibility";\n',
    'import { loadDurableCompanySupportRecords } from "../prisma-schema-compatibility";\nimport { selectCanonicalTenderFiles } from "../tender/canonical-source-files";\n',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''function chunks<T>(items: T[], size = 100): T[][] {\n  const out: T[][] = [];\n  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));\n  return out;\n}\n''',
    '''function chunks<T>(items: T[], size = 100): T[][] {\n  const out: T[][] = [];\n  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));\n  return out;\n}\n\nfunction parseStringArray(value: string | null | undefined): string[] {\n  if (!value) return [];\n  try {\n    const parsed = JSON.parse(value);\n    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];\n  } catch {\n    return [];\n  }\n}\n''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    'include: { files: { select: { id: true, originalFileName: true, mimeType: true, classification: true, extractedText: true } } },',
    'include: { files: { select: { id: true, fileName: true, originalFileName: true, mimeType: true, classification: true, extractedText: true, deletionStatus: true, contentSha256: true, integrityStatus: true, extractionScore: true, extractionMethod: true, totalPages: true, extractedPages: true, failedPages: true, createdAt: true } }, requirements: { orderBy: { createdAt: "asc" } } },',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''    if (isAIEnabled()) {\n      let tenderText = tender.files''',
    '''    const persistedGroundedRequirements = tender.requirements.filter((requirement) =>\n      Boolean(requirement.sourceTenderFileId && requirement.sourcePageNumber && requirement.sourceExactQuote),\n    );\n\n    if (\n      persistedGroundedRequirements.length > 0\n      && tender.analysisExtractionStatus === "FULL_EXTRACTION_AI_ANALYZED"\n    ) {\n      analysis = {\n        summary: tender.analysisSummary || `Using ${persistedGroundedRequirements.length} grounded requirements from the current AI Analyze result.`,\n        requirements: persistedGroundedRequirements.map((requirement) => ({\n          title: requirement.title,\n          description: requirement.description,\n          requirementType: requirement.requirementType,\n          priority: requirement.priority,\n          requiredQuantity: requirement.requiredQuantity,\n          pageLimit: requirement.pageLimit,\n          exactFileName: requirement.exactFileName,\n          exactOrder: requirement.exactOrder,\n          restrictions: requirement.restrictions,\n          sectionReference: requirement.sectionReference,\n          sourceTenderFileId: requirement.sourceTenderFileId,\n          sourcePageNumber: requirement.sourcePageNumber,\n          sourceSectionHeading: requirement.sourceSectionHeading,\n          sourceExactQuote: requirement.sourceExactQuote,\n          sourceConfidence: requirement.sourceConfidence,\n          sourceExtractionMethod: requirement.sourceExtractionMethod,\n        })),\n        exactFileNaming: parseStringArray(tender.exactFileNaming),\n        exactFileOrder: parseStringArray(tender.exactFileOrder),\n      };\n      analysisMethod = "AI";\n      progress("engine.analyze", `Reusing ${persistedGroundedRequirements.length} current-revision grounded requirements from manual AI Analyze`);\n    } else if (isAIEnabled()) {\n      let tenderText = selectCanonicalTenderFiles(tender.files)''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    '''    if (filesWithText.length > 0 && analysis.requirements.length > 0) {\n      try {\n        const { extractRequirementSources } = await import("./requirement-source-extractor");\n        const draftWithIds: Array<{ id: string; req: typeof analysis.requirements[number] }> = analysis.requirements.map((req) => ({ id: randomUUID(), req }));''',
    '''    const validSourceFileIds = new Set(filesWithText.map((file) => file.id));\n    const requirementsNeedingSourceExtraction = analysis.requirements.filter((requirement) =>\n      !requirement.sourceTenderFileId\n      || !validSourceFileIds.has(requirement.sourceTenderFileId)\n      || !requirement.sourcePageNumber\n      || !requirement.sourceExactQuote,\n    );\n    if (filesWithText.length > 0 && requirementsNeedingSourceExtraction.length > 0) {\n      try {\n        const { extractRequirementSources } = await import("./requirement-source-extractor");\n        const draftWithIds: Array<{ id: string; req: typeof analysis.requirements[number] }> = requirementsNeedingSourceExtraction.map((req) => ({ id: randomUUID(), req }));''',
)
replace_once(
    "lib/engine/run-tender-engine.ts",
    'logger.info(`[run-tender-engine] requirement source extractor: ${bestByReqId.size}/${analysis.requirements.length} requirements matched to a source paragraph.`);',
    'logger.info(`[run-tender-engine] requirement source extractor added ${bestByReqId.size}/${requirementsNeedingSourceExtraction.length} missing source coordinates; ${analysis.requirements.filter((requirement) => requirement.sourceTenderFileId && requirement.sourcePageNumber && requirement.sourceExactQuote).length}/${analysis.requirements.length} requirements are now grounded.`);',
)

# Analysis job chunks must also exclude duplicate/superseded source rows.
replace_once(
    "lib/ai-jobs/analysis-job-service.ts",
    'import { syncPersistedTenderFactsToLedger } from "../engine/tender-facts-ledger-service";\n',
    'import { syncPersistedTenderFactsToLedger } from "../engine/tender-facts-ledger-service";\nimport { selectCanonicalTenderFiles } from "../tender/canonical-source-files";\n',
)
replace_once(
    "lib/ai-jobs/analysis-job-service.ts",
    '''  const fullText = tender.files\n    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime())''',
    '''  const fullText = selectCanonicalTenderFiles(tender.files.filter((file: any) => file.deletionStatus === "ACTIVE"))\n    .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime())''',
)

# Bound matcher payloads below provider TPM limits and avoid the production 413.
replace_once("lib/engine/main-engine-ai-rematch.ts", "const PRE_FILTER_LIMIT = 20;", "const PRE_FILTER_LIMIT = 8;")
replace_once("lib/engine/ai-multi-perspective-matcher.ts", "export const MAX_CANDIDATES_PER_MATCHER_BATCH = 20;", "export const MAX_CANDIDATES_PER_MATCHER_BATCH = 8;")
replace_all("lib/engine/ai-multi-perspective-matcher.ts", ".slice(0, 800)", ".slice(0, 400)", minimum=2)
replace_all("lib/engine/ai-multi-perspective-matcher.ts", "opts.tenderRequirementsText.slice(0, 8_000)", "opts.tenderRequirementsText.slice(0, 4_000)", minimum=2)
replace_once("lib/engine/ai-multi-perspective-matcher.ts", "opts.evaluationMethodology.slice(0, 4_000)", "opts.evaluationMethodology.slice(0, 2_000)")
replace_once(
    "lib/ai.ts",
    '  if (Number.isFinite(raw) && raw >= 1 && raw <= 10) return Math.floor(raw);',
    '  if (Number.isFinite(raw) && raw >= 1 && raw <= 10) return Math.max(6, Math.floor(raw));',
)

# Vercel does not provide DOMMatrix/canvas. Prefer the Node-safe pdf2json path
# there; retain the other extractors for local/desktop environments.
replace_once(
    "lib/extract-text.ts",
    '''  const extractors = [\n    { source: "pdf-parse", fn: () => extractPdfWithPdfParse(buffer) },\n    { source: "pdf2json", fn: () => extractPdfWithPdf2Json(buffer) },\n    { source: "pdfjs", fn: () => extractPdfWithPdfJs(buffer) },\n  ];''',
    '''  const extractors = [\n    { source: "pdf2json", fn: () => extractPdfWithPdf2Json(buffer) },\n    ...(!process.env.VERCEL\n      ? [\n          { source: "pdf-parse", fn: () => extractPdfWithPdfParse(buffer) },\n          { source: "pdfjs", fn: () => extractPdfWithPdfJs(buffer) },\n        ]\n      : []),\n  ];''',
)

# ---------------------------------------------------------------------------
# 4. Exact duplicate Company Vault records: merge safely and idempotently.
# ---------------------------------------------------------------------------
write(
    "lib/plan-b-deduplicate.ts",
    r'''import type { Prisma, PrismaClient } from "@prisma/client";

export type VaultDeduplicationResult = {
  mergedExperts: number;
  mergedProjects: number;
  ambiguousExpertGroups: number;
  ambiguousProjectGroups: number;
};

function canonicalIdentity(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\b(?:mr|mrs|ms|dr|prof|professor|eng|engr|engineer)\.?\s+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nonEmpty(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function trustRank(value: string | null | undefined): number {
  if (value === "REVIEWED") return 4;
  if (value === "SOURCE_VERIFIED") return 3;
  if (value === "AI_DRAFT") return 2;
  if (value === "REGEX_DRAFT") return 1;
  return 0;
}

function jsonUnion(values: Array<string | null | undefined>): string {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) for (const item of parsed) if (String(item).trim()) out.add(String(item).trim());
    } catch {
      for (const item of value.split(",")) if (item.trim()) out.add(item.trim());
    }
  }
  return JSON.stringify([...out]);
}

function hasConflictingIdentifiers(rows: Array<{ email?: string | null; phone?: string | null }>): boolean {
  const emails = new Set(rows.map((row) => nonEmpty(row.email)?.toLowerCase()).filter(Boolean));
  const phones = new Set(rows.map((row) => nonEmpty(row.phone)?.replace(/\D+/g, "")).filter(Boolean));
  return emails.size > 1 || phones.size > 1;
}

function bestText(values: Array<string | null | undefined>): string | null {
  return values.map(nonEmpty).filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length)[0] ?? null;
}

export async function deduplicateCompanyVaultRecords(
  prisma: PrismaClient,
  companyId: string,
): Promise<VaultDeduplicationResult> {
  const [experts, projects] = await Promise.all([
    prisma.expert.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
    prisma.project.findMany({ where: { companyId, deletedAt: null }, orderBy: { createdAt: "asc" } }),
  ]);

  let mergedExperts = 0;
  let mergedProjects = 0;
  let ambiguousExpertGroups = 0;
  let ambiguousProjectGroups = 0;

  const expertGroups = new Map<string, typeof experts>();
  for (const expert of experts) {
    const key = canonicalIdentity(expert.fullName);
    if (!key) continue;
    expertGroups.set(key, [...(expertGroups.get(key) ?? []), expert]);
  }

  for (const rows of expertGroups.values()) {
    if (rows.length < 2) continue;
    if (hasConflictingIdentifiers(rows)) {
      ambiguousExpertGroups += 1;
      continue;
    }
    const ordered = [...rows].sort((a, b) => trustRank(b.trustLevel) - trustRank(a.trustLevel) || a.createdAt.getTime() - b.createdAt.getTime());
    const survivor = ordered[0];
    const duplicates = ordered.slice(1);
    const mergedData: Prisma.ExpertUpdateInput = {
      title: bestText(ordered.map((row) => row.title)),
      email: bestText(ordered.map((row) => row.email)),
      phone: bestText(ordered.map((row) => row.phone)),
      yearsExperience: Math.max(...ordered.map((row) => row.yearsExperience ?? 0)) || null,
      disciplines: jsonUnion(ordered.map((row) => row.disciplines)),
      sectors: jsonUnion(ordered.map((row) => row.sectors)),
      certifications: jsonUnion(ordered.map((row) => row.certifications)),
      profile: bestText(ordered.map((row) => row.profile)),
      trustLevel: ordered[0].trustLevel,
      reviewedBy: ordered.find((row) => row.reviewedBy)?.reviewedBy ?? null,
      reviewedAt: ordered.find((row) => row.reviewedAt)?.reviewedAt ?? null,
      reviewNotes: bestText(ordered.map((row) => row.reviewNotes)),
      sourceDocument: ordered.find((row) => row.sourceDocumentId)?.sourceDocumentId
        ? { connect: { id: ordered.find((row) => row.sourceDocumentId)!.sourceDocumentId! } }
        : { disconnect: true },
      isActive: true,
      deletedAt: null,
      deletedBy: null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.expert.update({ where: { id: survivor.id }, data: mergedData });
      for (const duplicate of duplicates) {
        const matches = await tx.tenderExpertMatch.findMany({ where: { expertId: duplicate.id } });
        for (const match of matches) {
          const existing = await tx.tenderExpertMatch.findUnique({
            where: { tenderId_expertId: { tenderId: match.tenderId, expertId: survivor.id } },
          });
          if (existing) {
            await tx.tenderExpertMatch.update({
              where: { id: existing.id },
              data: {
                score: Math.max(existing.score, match.score),
                isSelected: existing.isSelected || match.isSelected,
                rationale: bestText([existing.rationale, match.rationale]),
              },
            });
            await tx.tenderExpertMatch.delete({ where: { id: match.id } });
          } else {
            await tx.tenderExpertMatch.update({ where: { id: match.id }, data: { expertId: survivor.id } });
          }
        }
        await tx.expert.delete({ where: { id: duplicate.id } });
        mergedExperts += 1;
      }
    });
  }

  const projectGroups = new Map<string, typeof projects>();
  for (const project of projects) {
    const key = [canonicalIdentity(project.name), canonicalIdentity(project.clientName), canonicalIdentity(project.country)].join("|");
    if (!canonicalIdentity(project.name)) continue;
    projectGroups.set(key, [...(projectGroups.get(key) ?? []), project]);
  }

  for (const rows of projectGroups.values()) {
    if (rows.length < 2) continue;
    const ordered = [...rows].sort((a, b) => trustRank(b.trustLevel) - trustRank(a.trustLevel) || a.createdAt.getTime() - b.createdAt.getTime());
    const survivor = ordered[0];
    const duplicates = ordered.slice(1);
    const mergedData: Prisma.ProjectUpdateInput = {
      clientName: bestText(ordered.map((row) => row.clientName)),
      country: bestText(ordered.map((row) => row.country)),
      sector: bestText(ordered.map((row) => row.sector)),
      serviceAreas: jsonUnion(ordered.map((row) => row.serviceAreas)),
      summary: bestText(ordered.map((row) => row.summary)),
      contractValue: ordered.find((row) => row.contractValue != null)?.contractValue ?? null,
      currency: ordered.find((row) => row.currency)?.currency ?? null,
      startDate: ordered.find((row) => row.startDate)?.startDate ?? null,
      endDate: ordered.find((row) => row.endDate)?.endDate ?? null,
      trustLevel: ordered[0].trustLevel,
      reviewedBy: ordered.find((row) => row.reviewedBy)?.reviewedBy ?? null,
      reviewedAt: ordered.find((row) => row.reviewedAt)?.reviewedAt ?? null,
      reviewNotes: bestText(ordered.map((row) => row.reviewNotes)),
      sourceDocument: ordered.find((row) => row.sourceDocumentId)?.sourceDocumentId
        ? { connect: { id: ordered.find((row) => row.sourceDocumentId)!.sourceDocumentId! } }
        : { disconnect: true },
      deletedAt: null,
      deletedBy: null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: survivor.id }, data: mergedData });
      for (const duplicate of duplicates) {
        const matches = await tx.tenderProjectMatch.findMany({ where: { projectId: duplicate.id } });
        for (const match of matches) {
          const existing = await tx.tenderProjectMatch.findUnique({
            where: { tenderId_projectId: { tenderId: match.tenderId, projectId: survivor.id } },
          });
          if (existing) {
            await tx.tenderProjectMatch.update({
              where: { id: existing.id },
              data: {
                score: Math.max(existing.score, match.score),
                isSelected: existing.isSelected || match.isSelected,
                rationale: bestText([existing.rationale, match.rationale]),
              },
            });
            await tx.tenderProjectMatch.delete({ where: { id: match.id } });
          } else {
            await tx.tenderProjectMatch.update({ where: { id: match.id }, data: { projectId: survivor.id } });
          }
        }
        await tx.projectEvidence.updateMany({ where: { projectId: duplicate.id }, data: { projectId: survivor.id } });
        await tx.project.delete({ where: { id: duplicate.id } });
        mergedProjects += 1;
      }
    });
  }

  return { mergedExperts, mergedProjects, ambiguousExpertGroups, ambiguousProjectGroups };
}
''',
)
replace_once(
    "app/api/company/plan-b-import/finalize/route.ts",
    'import { logger } from "../../../../../lib/observability";\n',
    'import { logger } from "../../../../../lib/observability";\nimport { deduplicateCompanyVaultRecords } from "../../../../../lib/plan-b-deduplicate";\n',
)
replace_once(
    "app/api/company/plan-b-import/finalize/route.ts",
    '''    const result = await finalizePlanBCompanyVault(prisma, {\n      userId: actor.id,\n      companyId: company.id,\n      payload,\n    });\n\n    return NextResponse.json({ success: true, ...result });''',
    '''    const result = await finalizePlanBCompanyVault(prisma, {\n      userId: actor.id,\n      companyId: company.id,\n      payload,\n    });\n    const deduplication = await deduplicateCompanyVaultRecords(prisma, company.id);\n\n    return NextResponse.json({ success: true, ...result, deduplication });''',
)

# Deterministic unique-stem source linking when exact normalized filename is absent.
replace_once(
    "lib/plan-b-vault-finalize.ts",
    '''export function normalizePlanBFileName(value: unknown): string {\n  const normalized = clean(value).normalize("NFKC").replace(/\\\\/g, "/");\n  return path.posix.basename(normalized).toLowerCase();\n}\n''',
    '''export function normalizePlanBFileName(value: unknown): string {\n  const normalized = clean(value).normalize("NFKC").replace(/\\\\/g, "/");\n  return path.posix.basename(normalized).toLowerCase().replace(/\\s+/g, " ");\n}\n\nexport function normalizePlanBFileStem(value: unknown): string {\n  return normalizePlanBFileName(value)\n    .replace(/\\.[a-z0-9]{1,8}$/i, "")\n    .replace(/[^a-z0-9]+/g, " ")\n    .trim();\n}\n''',
)
replace_once(
    "lib/plan-b-vault-finalize.ts",
    '''  byHash: Map<string, OfficialDoc>,\n  byFileName: Map<string, OfficialDoc>,\n  sourceSha256: unknown,''',
    '''  byHash: Map<string, OfficialDoc>,\n  byFileName: Map<string, OfficialDoc>,\n  byUniqueStem: Map<string, OfficialDoc>,\n  sourceSha256: unknown,''',
)
replace_once(
    "lib/plan-b-vault-finalize.ts",
    '''  const fileName = normalizePlanBFileName(sourceDocument);\n  return fileName ? byFileName.get(fileName) ?? null : null;''',
    '''  const fileName = normalizePlanBFileName(sourceDocument);\n  const exact = fileName ? byFileName.get(fileName) ?? null : null;\n  if (exact) return exact;\n  const stem = normalizePlanBFileStem(sourceDocument);\n  return stem ? byUniqueStem.get(stem) ?? null : null;''',
)
replace_once(
    "lib/plan-b-vault-finalize.ts",
    '''  const byHash = new Map<string, OfficialDoc>();\n  const byFileName = new Map<string, OfficialDoc>();''',
    '''  const byHash = new Map<string, OfficialDoc>();\n  const byFileName = new Map<string, OfficialDoc>();\n  const byStemCandidates = new Map<string, OfficialDoc[]>();''',
)
replace_once(
    "lib/plan-b-vault-finalize.ts",
    '''      if (name && !byFileName.has(name)) byFileName.set(name, doc);\n    }\n  }\n''',
    '''      if (name && !byFileName.has(name)) byFileName.set(name, doc);\n      const stem = normalizePlanBFileStem(candidate);\n      if (stem) byStemCandidates.set(stem, [...(byStemCandidates.get(stem) ?? []), doc]);\n    }\n  }\n  const byUniqueStem = new Map<string, OfficialDoc>();\n  for (const [stem, rows] of byStemCandidates) {\n    const uniqueIds = new Set(rows.map((row) => row.id));\n    if (uniqueIds.size === 1) byUniqueStem.set(stem, rows[0]);\n  }\n''',
)
replace_all(
    "lib/plan-b-vault-finalize.ts",
    'resolveOfficialDocument(byHash, byFileName, declared.sourceSha256, declared.sourceDocument)',
    'resolveOfficialDocument(byHash, byFileName, byUniqueStem, declared.sourceSha256, declared.sourceDocument)',
    minimum=2,
)

# ---------------------------------------------------------------------------
# 5. Permanent deletion user flow and post-delete polling.
# ---------------------------------------------------------------------------
write(
    "components/delete-tender-button.tsx",
    r'''"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  tenderId: string;
  tenderTitle: string;
  compact?: boolean;
};

export function DeleteTenderButton({ tenderId, tenderTitle, compact = false }: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function permanentlyDelete() {
    if (deleting) return;
    const confirmation = window.prompt(
      `Permanently delete “${tenderTitle}” and all of its files, jobs, matches, and generated outputs? Type DELETE to continue.`,
    );
    if (confirmation !== "DELETE") return;

    setDeleting(true);
    setError("");
    window.dispatchEvent(new CustomEvent("tender-deletion-started", { detail: { tenderId } }));
    try {
      const response = await fetch(`/api/tenders/${tenderId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Permanent deletion failed (HTTP ${response.status}).`);
      window.dispatchEvent(new CustomEvent("tender-deleted", { detail: { tenderId, storageCleanupPending: Boolean(body.storageCleanupPending) } }));
      router.replace(`/dashboard/tenders?deleted=${encodeURIComponent(tenderTitle)}${body.storageCleanupPending ? "&cleanup=pending" : ""}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Permanent deletion failed.");
      setDeleting(false);
    }
  }

  return (
    <div className={compact ? "inline-flex flex-col items-end" : "flex flex-col items-end"}>
      <button
        type="button"
        onClick={() => void permanentlyDelete()}
        disabled={deleting}
        aria-busy={deleting}
        className={compact
          ? "inline-flex min-h-11 items-center rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          : "inline-flex min-h-11 items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"}
      >
        {deleting ? "Deleting permanently…" : "Permanently delete"}
      </button>
      {error ? <p className="mt-1 max-w-xs text-right text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
''',
)
replace_once(
    "app/dashboard/tenders/page.tsx",
    'import { DuplicateButton } from "../history/duplicate-button";\n',
    'import { DuplicateButton } from "../history/duplicate-button";\nimport { DeleteTenderButton } from "../../../components/delete-tender-button";\n',
)
replace_once(
    "app/dashboard/tenders/page.tsx",
    '''                          <DuplicateButton tenderId={tender.id} />\n                        </div>''',
    '''                          <DuplicateButton tenderId={tender.id} />\n                          <DeleteTenderButton tenderId={tender.id} tenderTitle={tender.title} compact />\n                        </div>''',
)
replace_once(
    "app/dashboard/tenders/page.tsx",
    '''                      <DuplicateButton tenderId={tender.id} />\n                    </div>''',
    '''                      <DuplicateButton tenderId={tender.id} />\n                      <DeleteTenderButton tenderId={tender.id} tenderTitle={tender.title} compact />\n                    </div>''',
)
replace_once(
    "app/api/tenders/[id]/workflow-center/route.ts",
    '''    const { id: tenderId } = await params;\n    await prismaReady;\n\n    const [snapshot, workflow, rawDecision] = await Promise.all([''',
    '''    const { id: tenderId } = await params;\n    await prismaReady;\n\n    // Deleted or cross-tenant tenders are a normal terminal state for polling.\n    // Preflight before Promise.all so downstream resolvers never turn a normal\n    // post-deletion poll into an HTTP 500.\n    const ownedTender = await prisma.tender.findFirst({\n      where: { id: tenderId, userId: actor.id },\n      select: { id: true },\n    });\n    if (!ownedTender) {\n      return NextResponse.json({ error: "Tender not found", code: "TENDER_NOT_FOUND" }, { status: 404 });\n    }\n\n    const [snapshot, workflow, rawDecision] = await Promise.all([''',
)

# ---------------------------------------------------------------------------
# 6. Regression tests for the confirmed production failures.
# ---------------------------------------------------------------------------
write(
    "tests/remaining-production-gaps-regression.test.ts",
    r'''import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  assessCanonicalTenderSourceReadiness,
  selectCanonicalTenderFiles,
} from "../lib/tender/canonical-source-files";

const root = path.resolve(process.cwd());
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("canonical source selection ignores a pending duplicate when a verified extracted representation exists", () => {
  const files = [
    {
      id: "good",
      originalFileName: "pharo tender document.docx",
      deletionStatus: "ACTIVE",
      contentSha256: "a".repeat(64),
      integrityStatus: "VERIFIED",
      extractionScore: 90,
      extractionMethod: "text",
      totalPages: 7,
      extractedPages: 7,
      failedPages: 0,
      extractedText: "x".repeat(1000),
      createdAt: new Date("2026-08-05T00:00:00Z"),
    },
    {
      id: "pending",
      originalFileName: "pharo tender document.pdf",
      deletionStatus: "ACTIVE",
      contentSha256: "b".repeat(64),
      integrityStatus: "VERIFIED",
      extractionScore: null,
      extractionMethod: null,
      totalPages: null,
      extractedPages: null,
      failedPages: null,
      extractedText: null,
      createdAt: new Date("2026-08-06T00:00:00Z"),
    },
  ];
  const canonical = selectCanonicalTenderFiles(files);
  assert.equal(canonical.length, 1);
  assert.equal(canonical[0].id, "good");
  const readiness = assessCanonicalTenderSourceReadiness(files);
  assert.equal(readiness.analysisReady, true);
  assert.equal(readiness.duplicateFileCount, 1);
});

test("weak extraction is not confused with verified byte integrity", () => {
  const readiness = assessCanonicalTenderSourceReadiness([{
    id: "weak",
    originalFileName: "tender.pdf",
    deletionStatus: "ACTIVE",
    contentSha256: "c".repeat(64),
    integrityStatus: "VERIFIED",
    extractionScore: 25,
    extractionMethod: "text",
    totalPages: 7,
    extractedPages: 7,
    failedPages: 0,
    extractedText: "x".repeat(1000),
  }]);
  assert.equal(readiness.byteIntegrityValid, true);
  assert.equal(readiness.extractionQualityValid, false);
  assert.equal(readiness.analysisReady, false);
});

test("Engine reuses grounded manual AI Analyze requirements", () => {
  const engine = source("lib/engine/run-tender-engine.ts");
  assert.match(engine, /persistedGroundedRequirements/);
  assert.match(engine, /Reusing .* current-revision grounded requirements/);
  assert.match(engine, /requirementsNeedingSourceExtraction/);
});

test("matcher and provider payloads are bounded for production", () => {
  assert.match(source("lib/engine/main-engine-ai-rematch.ts"), /PRE_FILTER_LIMIT = 8/);
  assert.match(source("lib/engine/ai-multi-perspective-matcher.ts"), /MAX_CANDIDATES_PER_MATCHER_BATCH = 8/);
  assert.match(source("lib/ai.ts"), /Math\.max\(6, Math\.floor\(raw\)\)/);
});

test("deleted tender polling returns not-found instead of internal error", () => {
  const workflow = source("app/api/tenders/[id]/workflow-center/route.ts");
  assert.match(workflow, /const ownedTender = await prisma\.tender\.findFirst/);
  assert.match(workflow, /code: "TENDER_NOT_FOUND"/);
  assert.ok(workflow.indexOf("const ownedTender") < workflow.indexOf("Promise.all"));
});

test("permanent delete controls exist on list and detail screens", () => {
  const list = source("app/dashboard/tenders/page.tsx");
  const detail = source("app/dashboard/tenders/[id]/page.tsx");
  assert.match(list, /DeleteTenderButton/);
  assert.match(detail, /DeleteTenderButton/);
  assert.match(source("components/delete-tender-button.tsx"), /Type DELETE to continue/);
});

test("Plan B finalization performs exact canonical duplicate consolidation", () => {
  assert.match(source("app/api/company/plan-b-import/finalize/route.ts"), /deduplicateCompanyVaultRecords/);
  const dedupe = source("lib/plan-b-deduplicate.ts");
  assert.match(dedupe, /tenderExpertMatch/);
  assert.match(dedupe, /tenderProjectMatch/);
  assert.match(dedupe, /projectEvidence/);
});

test("Vercel PDF extraction avoids DOMMatrix-dependent parsers", () => {
  const extraction = source("lib/extract-text.ts");
  assert.match(extraction, /\.\.\.\(!process\.env\.VERCEL/);
  assert.ok(extraction.indexOf('source: "pdf2json"') < extraction.indexOf('source: "pdf-parse"'));
});
''',
)

print("Applied remaining production-gap repair set successfully.")
