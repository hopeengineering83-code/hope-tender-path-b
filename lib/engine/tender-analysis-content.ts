// Single source of truth for building the tender-analysis AI input content and
// its content hash.
//
// Previously this logic was duplicated inline in the synchronous AI Analyze
// route (streaming + non-streaming) AND diverged from the durable job service
// (lib/ai-jobs/analysis-job-service.ts), which built content from raw
// extractedText and hashed it differently. That divergence produced DISJOINT
// AiAnalyzeChunk rows between the two execution paths — the root cause of an
// earlier failed consolidation attempt.
//
// Both paths now call buildTenderAnalysisContent() + computeAnalysisContentHash()
// so they produce IDENTICAL content, hash, and (via the shared chunker) chunk
// identity — the foundation for unifying the two execution paths.

import crypto from "crypto";
import { formatTenderFileAnalysisMarker } from "./requirement-source-linkage";

// ─── Env-tunable limits (moved verbatim from the AI Analyze route) ────────────

export const MAX_FILE_CHARS_FOR_AI_ANALYSIS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_FILE_CHARS);
  if (Number.isFinite(raw) && raw >= 1_000 && raw <= 50_000) return raw;
  return 12_000;
})();

export const SECTION_SCAN_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_SECTION_SCAN_CHARS);
  if (Number.isFinite(raw) && raw >= 500 && raw <= 10_000) return raw;
  return 3_000;
})();

// Soft cap on total tender content sent to AI. Content above this threshold is
// chunked by analyzeWithAI. A max prevents OOM from extremely large tenders
// while still covering multi-file tenders well.
export const MAX_TOTAL_AI_CHARS = (() => {
  const raw = Number(process.env.TENDER_AI_MAX_TOTAL_CHARS);
  if (Number.isFinite(raw) && raw >= 10_000 && raw <= 500_000) return raw;
  return 300_000; // 6 × 50K chunks
})();

export const SECTION_KEYWORDS = /evaluation|scoring|criteria|submission|deadline|annex|appendix|form[s\s]|financial proposal|technical proposal|envelope|subject line|bid bond|eligibility|qualification|instructions to (bidders?|tenderers?)|evaluation matrix|scoring matrix|award criteria/i;

// ─── Structural input types (match what both callers already load) ────────────

export type AnalysisContentFile = {
  id: string;
  originalFileName: string;
  extractedText?: string | null;
  classification?: string | null;
  createdAt?: Date;
};

export type AnalysisContentCompanyDocument = {
  originalFileName: string;
  category: string;
  extractedText?: string | null;
};

export type AnalysisContentTender = {
  title?: string | null;
  description?: string | null;
  intakeSummary?: string | null;
  files: AnalysisContentFile[];
};

export type AnalysisContentCompany = {
  documents?: AnalysisContentCompanyDocument[] | null;
} | null | undefined;

// ─── Helpers (verbatim from the route) ────────────────────────────────────────

/**
 * For files larger than maxChars, extracts the first portion PLUS sections near
 * evaluation/submission/scoring keywords. Surfaces critical tender instructions
 * that appear deep in a document rather than always truncating from the start.
 */
export function extractRelevantSections(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, Math.floor(maxChars * 0.6));
  const scanBudget = maxChars - head.length;

  const tail = text.slice(head.length);
  const snippets: string[] = [];
  let budgetUsed = 0;

  let searchPos = 0;
  while (budgetUsed < scanBudget && searchPos < tail.length) {
    const nextMatch = tail.slice(searchPos).search(SECTION_KEYWORDS);
    if (nextMatch === -1) break;

    const matchStart = searchPos + nextMatch;
    const lineStart = tail.lastIndexOf("\n", matchStart) + 1;
    const snippetStart = Math.max(lineStart, matchStart - 200);
    const snippetEnd = Math.min(tail.length, snippetStart + SECTION_SCAN_CHARS);
    const snippet = tail.slice(snippetStart, snippetEnd);

    if (!head.includes(snippet.slice(0, 50))) {
      snippets.push(snippet);
      budgetUsed += snippet.length;
    }

    searchPos = snippetEnd;
    if (budgetUsed >= scanBudget) break;
  }

  if (snippets.length === 0) return head;
  return `${head}\n\n[... key sections extracted from remainder ...]\n\n${snippets.join("\n\n---\n\n")}`;
}

export function stripExtractionHeader(txt: string): string {
  return txt.replace(/^\[(?:PDF text|OCR text)[^\]]*\]\s*\n+/i, "").trim();
}

// ─── The shared builder + hash ────────────────────────────────────────────────

/**
 * Build the exact AI-analysis input content for a tender. Reproduces the
 * construction that the AI Analyze route used inline (title + capped
 * description/intake + per-file section-extracted text with FILE_ID markers +
 * a company-document digest), capped at MAX_TOTAL_AI_CHARS.
 *
 * Files are NOT re-sorted here — callers pass files in the order they want
 * (the route preserves load order). Pass `company` to include the vault-document
 * digest so the hash changes when vault content changes.
 */
export function buildTenderAnalysisContent(
  tender: AnalysisContentTender,
  company?: AnalysisContentCompany,
): string {
  // Canonical, deterministic file order (createdAt ascending, id tiebreak) so
  // every caller produces byte-identical content regardless of how it loaded
  // the files. This is what makes the route and the durable job service share
  // one content hash and chunk identity.
  const orderedFiles = [...tender.files].sort((a, b) => {
    const at = a.createdAt ? a.createdAt.getTime() : 0;
    const bt = b.createdAt ? b.createdAt.getTime() : 0;
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const fileTexts = orderedFiles
    .map((f) => f.extractedText
      ? `${formatTenderFileAnalysisMarker(f)}\n${extractRelevantSections(stripExtractionHeader(f.extractedText), MAX_FILE_CHARS_FOR_AI_ANALYSIS)}`
      : `${formatTenderFileAnalysisMarker(f)} ${f.classification ?? ""}`)
    .join("\n\n");

  const companyContext = company?.documents?.length
    ? `\n\nCOMPANY DOCUMENTS AVAILABLE:\n${company.documents
        .map((d) => {
          const textDigest = d.extractedText
            ? crypto.createHash("sha256").update(d.extractedText.slice(0, 10_000)).digest("hex").slice(0, 8)
            : "no-text";
          return `- ${d.originalFileName} (${d.category}) [digest:${textDigest}]`;
        })
        // Deterministic vault-document order. Company.documents is loaded
        // WITHOUT an orderBy in the AI Analyze route, the release snapshot, and
        // the generation gate, so PostgreSQL may return the rows in different
        // physical orders across calls. Without this sort the stored
        // analysisInputHash (computed by the route) and the recomputed hash
        // (snapshot/gate) can differ purely because the vault documents came
        // back in a different sequence — resurfacing the false "content changed
        // since the last analysis" blocker that this fix removes. Sorting the
        // fully-rendered digest lines keys off filename + category + text digest
        // in one stable lexicographic pass.
        .sort()
        .join("\n")}`
    : "";

  return [
    `TENDER: ${tender.title ?? "[Untitled Tender]"}`,
    tender.description ? `DESCRIPTION: ${tender.description.slice(0, 2_000)}` : null,
    tender.intakeSummary ? `INTAKE NOTES: ${tender.intakeSummary.slice(0, 2_000)}` : null,
    fileTexts || null,
    companyContext || null,
  ].filter(Boolean).join("\n\n").slice(0, MAX_TOTAL_AI_CHARS);
}

// The leading `TENDER: <title>` line that buildTenderAnalysisContent always
// emits first, pinned to a constant for hashing purposes only.
const HASH_TITLE_PLACEHOLDER = "TENDER: [title-excluded-from-hash]";

/**
 * Project built analysis content onto the form used for hashing.
 *
 * Tender.title is an ANALYSIS OUTPUT, not an analysis input: a successful AI
 * Analyze overwrites it via buildCanonicalAnalysisTenderUpdate
 * (`title: aiResult.tenderTitle` in lib/engine/canonical-analysis-update.ts).
 * When the live title participates in the hash, every FIRST successful analysis
 * invalidates itself: the job stamps analysisInputHash BEFORE the write-back,
 * the write-back replaces the title, and the gate then recomputes a different
 * hash and reports ANALYSIS_HASH_MISMATCH — "Tender content changed since the
 * last analysis" — for a tender nobody touched. Build Plan, generation and
 * export were unreachable until AI Analyze was run a SECOND time (the second
 * write-back is idempotent, so the hash finally settles).
 *
 * Normalising here rather than in buildTenderAnalysisContent is deliberate: the
 * title still reaches the model as prompt context, and every one of the ten
 * call sites that hashes analysis content is corrected at a single point. An
 * opt-in flag per call site would reintroduce exactly the stamp/recompute
 * divergence this function exists to prevent (see the vault-ordering note in
 * buildTenderAnalysisContent for a previous instance of that same bug).
 *
 * The hash therefore tracks genuine analysis inputs — source-file text, the
 * description/intake notes and the vault-document digest. Renaming a tender no
 * longer discards its extracted requirements.
 */
function projectContentForHash(content: string): string {
  if (!content.startsWith("TENDER: ")) return content;
  // buildTenderAnalysisContent joins its sections with a blank line, so the
  // title section runs to the first "\n\n" — NOT merely to the first newline.
  // Extracted tender titles are routinely multi-line (they are lifted verbatim
  // from the source document, e.g. "Consultancy Services for Detailed Design
  // and Construction\nSupervision of Rural Water Supply Schemes"), so trimming
  // only the first physical line would leave the remaining title lines in the
  // hashed text and the self-invalidation would persist.
  const sectionBreak = content.indexOf("\n\n");
  const rest = sectionBreak === -1 ? "" : content.slice(sectionBreak);
  return `${HASH_TITLE_PLACEHOLDER}${rest}`;
}

/**
 * The canonical content hash used to key AiAnalyzeChunk rows and AiJob
 * analysisInputHash. 16-char truncated sha256 of the built content — the same
 * scheme the route's checkpoint system uses, so the durable job service and the
 * route share one chunk-state identity.
 */
export function computeAnalysisContentHash(content: string): string {
  return crypto.createHash("sha256").update(projectContentForHash(content)).digest("hex").slice(0, 16);
}
