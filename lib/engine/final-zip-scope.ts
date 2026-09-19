import { safeParseJsonArray } from "../safe-json";
import {
  inferEnvelope,
  inferSubmissionPlanFormat,
  type SubmissionEnvelope,
  type SubmissionPlanFormat,
} from "./submission-plan";
/**
 * Strict final-ZIP scope resolver.
 *
 * Original product rule: "Generate and export exactly and only what
 * the tender requires." Pre-this-module, app/api/tenders/[id]/download/
 * route.ts violated that rule in three ways:
 *
 *   1. CV documents were ALWAYS duplicated under a CVs/ subfolder
 *      regardless of whether the tender required that path.
 *   2. Win-Probability-Report.docx was UNCONDITIONALLY appended to
 *      the final ZIP — an internal scoring artifact that no tender
 *      asks for and that leaks our internal win probability to the
 *      evaluator.
 *   3. ExportPackage.fileList recorded only the generated docs +
 *      CV duplicates but NOT the win-probability addition, so the
 *      DB record drifted from the actual ZIP entries.
 *
 * This module is the SINGLE SOURCE OF TRUTH for what enters the
 * final submission ZIP. The download route builds the entry list
 * here and then uses the SAME list for:
 *   - zip.file() calls
 *   - ExportPackage.fileList
 *   - audit-log file count
 *   - any per-document readiness check
 *
 * Internal artifacts (win probability, compliance report, evaluator
 * report, readiness report, source-traceability map) remain
 * downloadable separately through their own routes — they just
 * never enter the final tender ZIP unless the tender explicitly
 * requires that exact filename.
 */

export type ZipEntrySource = "GENERATED_DOC" | "CV_FOLDER" | "WIN_PROBABILITY";

export type ZipEntry = {
  /** Path inside the ZIP. Examples: "Technical-Proposal.docx", "CVs/CV-Alemu.docx". */
  name: string;
  /** Where this entry came from — used for diagnostics and audit. */
  source: ZipEntrySource;
  /** ID of the GeneratedDocument that produced this entry. Null only for synthesised entries. */
  generatedDocId: string | null;
  /** Exact submission-plan position persisted into the package manifest. */
  order: number;
  /** Physical tender envelope this file belongs to. */
  envelope: SubmissionEnvelope;
  /** Required output format persisted into the package manifest. */
  format: SubmissionPlanFormat;
};

export type FinalZipScopeInput = {
  tender: {
    exactFileNaming: string | null;
    exactFileOrder: string | null;
    requirements: Array<{ exactFileName?: string | null }>;
  };
  /** Pre-filtered to generationStatus === GENERATED with non-null fileContent in the route. */
  generatedDocs: Array<{
    id: string;
    name: string;
    exactFileName: string | null;
    exactOrder: number | null;
    documentType: string | null;
    format?: string | null;
  }>;
};

export type FinalZipScopeResult = {
  /** Ordered final ZIP entries. Single source of truth. */
  entries: ZipEntry[];
  /** Documents NOT added to the final ZIP, with the reason why. UI surfaces these. */
  exclusions: Array<{ docId: string; docName: string; reason: string }>;
  /** True when the tender has explicit exactFileNaming / exactFileOrder / per-requirement exactFileName. */
  hasExplicitScope: boolean;
};

const CV_PATH_PREFIX_RE = /^CVs?\//i;
const WIN_PROBABILITY_NAME_RE = /win[\s_-]*probability(?:[\s_-]*report)?\.docx$/i;

/**
 * Aggregate every filename that the tender's submission plan
 * explicitly demands. Includes:
 *   - tender.exactFileNaming (JSON array)
 *   - tender.exactFileOrder (JSON array)
 *   - each requirement.exactFileName when set
 *
 * Returns the list verbatim — no normalisation — so callers can
 * pattern-match against the original casing when needed.
 */
export function collectTenderRequiredFilenames(tender: FinalZipScopeInput["tender"]): string[] {
  const out = new Set<string>();
  for (const raw of [tender.exactFileNaming, tender.exactFileOrder]) {
    try {
      const parsed = safeParseJsonArray(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim().length > 0) out.add(item.trim());
        }
      }
    } catch { /* empty / invalid JSON — skip */ }
  }
  for (const req of tender.requirements ?? []) {
    const name = req.exactFileName?.trim();
    if (name && name.length > 0) out.add(name);
  }
  return Array.from(out);
}

/**
 * True iff the tender's submission plan explicitly demands a file
 * inside a CVs/ subfolder. Matching is case-insensitive on the
 * folder name (CVs/, cvs/, CV/, cv/). Without an explicit match,
 * CV documents go to the ZIP ROOT under their own filename, not
 * duplicated under CVs/.
 */
export function tenderRequiresCvFolder(tender: FinalZipScopeInput["tender"]): boolean {
  const names = collectTenderRequiredFilenames(tender);
  return names.some((name) => CV_PATH_PREFIX_RE.test(name));
}

/**
 * True iff the tender's submission plan explicitly demands a file
 * named like Win-Probability-Report.docx / WinProbabilityReport.docx
 * / win_probability.docx. Without an explicit match, the win-
 * probability report is an INTERNAL artifact and must not enter the
 * final tender ZIP.
 */
export function tenderRequiresWinProbabilityReport(tender: FinalZipScopeInput["tender"]): boolean {
  const names = collectTenderRequiredFilenames(tender);
  return names.some((name) => WIN_PROBABILITY_NAME_RE.test(name.replace(/^.*\//, "")));
}

/**
 * Identify a generated document as a CV. The two signals the legacy
 * code used (kept identical to avoid silently dropping CVs that the
 * old path included):
 *   - documentType === "EXPERT_CV_PACKAGE"
 *   - name starts with "CV-"
 */
export function isCvGeneratedDocument(doc: FinalZipScopeInput["generatedDocs"][number]): boolean {
  return doc.documentType === "EXPERT_CV_PACKAGE"
    || (typeof doc.name === "string" && doc.name.startsWith("CV-"));
}

/**
 * Build the canonical final ZIP entry list.
 *
 * Behaviour matrix:
 *
 *   tender.hasExplicitScope = false:
 *     - Each generated doc → 1 entry at ZIP root (sorted by exactOrder).
 *     - CV docs go to root, NOT duplicated under CVs/.
 *     - Win-probability report NOT included.
 *
 *   tender.hasExplicitScope = true (e.g. exactFileNaming declared):
 *     - Each generated doc that matches the planned names → 1 entry.
 *     - CV docs go to CVs/ ONLY when tenderRequiresCvFolder returns
 *       true; otherwise to root (matching legacy behaviour with no
 *       explicit CVs/ path).
 *     - Win-probability report included ONLY when
 *       tenderRequiresWinProbabilityReport returns true.
 *     - Generated docs not matching the plan → flagged as exclusions
 *       (the route also runs findExtraGeneratedDocuments earlier,
 *       which blocks the export when extras exist under explicit
 *       scope, so this branch is defence-in-depth).
 */
export function buildFinalZipEntries(input: FinalZipScopeInput): FinalZipScopeResult {
  const hasExplicitScope = collectTenderRequiredFilenames(input.tender).length > 0;
  const requireCvFolder = tenderRequiresCvFolder(input.tender);
  const requireWinProb = tenderRequiresWinProbabilityReport(input.tender);

  const entries: ZipEntry[] = [];
  const exclusions: Array<{ docId: string; docName: string; reason: string }> = [];

  // Sort by exactOrder (stable) so the engine's planned order is preserved.
  // Use MAX_SAFE_INTEGER as sentinel so that null-order docs sort LAST,
  // not at position 99 (which would misplace docs with exactOrder >= 100).
  const docsSorted = [...input.generatedDocs].sort((a, b) => (a.exactOrder ?? Number.MAX_SAFE_INTEGER) - (b.exactOrder ?? Number.MAX_SAFE_INTEGER));
  const maxExplicitOrder = docsSorted.reduce(
    (maximum, doc) => (
      Number.isInteger(doc.exactOrder) && (doc.exactOrder ?? 0) > 0
        ? Math.max(maximum, doc.exactOrder!)
        : maximum
    ),
    0,
  );
  let fallbackOrder = maxExplicitOrder;

  for (const doc of docsSorted) {
    const baseName = doc.exactFileName ?? doc.name;
    const isCv = isCvGeneratedDocument(doc);
    const order = Number.isInteger(doc.exactOrder) && (doc.exactOrder ?? 0) > 0
      ? doc.exactOrder!
      : ++fallbackOrder;
    const envelope = inferEnvelope(doc.documentType ?? "TECHNICAL", baseName);
    const format = inferSubmissionPlanFormat(baseName, doc.format);
    const entryAuthority = { order, envelope, format };

    // Drop the legacy unconditional Win-Probability-Report.docx if it
    // somehow shows up as a generated doc — the route synthesises it
    // separately, but defence-in-depth.
    if (WIN_PROBABILITY_NAME_RE.test(baseName.replace(/^.*\//, ""))) {
      if (requireWinProb) {
        entries.push({
          name: baseName,
          source: "WIN_PROBABILITY",
          generatedDocId: doc.id,
          ...entryAuthority,
        });
      } else {
        exclusions.push({
          docId: doc.id,
          docName: doc.name,
          reason: "Win-Probability-Report.docx is an internal scoring artifact and is excluded unless the tender explicitly requires it.",
        });
      }
      continue;
    }

    if (isCv && requireCvFolder) {
      // CVs/ folder explicitly required — place under CVs/.
      const baseNameNoPath = baseName.replace(/^.*\//, "");
      entries.push({
        name: `CVs/${baseNameNoPath}`,
        source: "CV_FOLDER",
        generatedDocId: doc.id,
        ...entryAuthority,
      });
    } else {
      // Default placement: root. Matches legacy behaviour when no
      // CVs/ path is declared.
      entries.push({
        name: baseName,
        source: "GENERATED_DOC",
        generatedDocId: doc.id,
        ...entryAuthority,
      });
    }
  }

  return { entries, exclusions, hasExplicitScope };
}

/**
 * Pure helper exported for test isolation — extract the bare
 * filename from a possibly-folder-prefixed path.
 */
export function bareFileName(path: string): string {
  return path.replace(/^.*\//, "");
}

export const __testing__ = { CV_PATH_PREFIX_RE, WIN_PROBABILITY_NAME_RE };
