/**
 * The visible text of a generated DOCX or PDF, read from its stored bytes.
 *
 * ONE implementation, used by every caller that has to judge what a document
 * actually says. Authority Review asks whether the file the client receives
 * carries a placeholder, an internal note or an AI trace; only the document can
 * answer that. Its DocumentInput used to expose nothing but `contentSummary`
 * and `reviewNotes`, which are audit strings the generator writes ABOUT the
 * run — so a run reporting "missing critical sections were auto-injected ... to
 * be confirmed" blocked export as though the proposal itself said it, while a
 * real placeholder in the DOCX body was never looked at.
 *
 * This module exists so the download, export and authority-review routes cannot
 * drift apart on that question the way the pricing detectors did.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";
import { extractTextFromBuffer } from "../extract-text";

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The parts of a WordprocessingML package that carry client-visible text. */
const TEXT_PARTS = [
  "word/document.xml",
  "word/header1.xml",
  "word/footer1.xml",
  "word/footnotes.xml",
  "word/endnotes.xml",
] as const;

// 32 MiB of decoded artifact bytes (base64 expands by roughly 4/3). This is a
// validation-path memory guard, not a silent approval path: callers receive
// null and must fail closed for narrative artifacts they cannot inspect.
const MAX_GENERATED_ARTIFACT_BASE64_CHARS = 45_000_000;

/**
 * The <w:t> text runs of a WordprocessingML part.
 *
 * Scanned with indexOf, not matched with a regular expression. The natural
 * pattern is /<w:t[^>]*>[\s\S]*?<\/w:t>/g, but this input is a document body an
 * uploader controls and that shape backtracks quadratically on a long run that
 * never closes the tag. Every step here advances a cursor and never rescans, so
 * the cost stays linear whatever the part contains.
 */
export function wordTextRuns(xml: string): string[] {
  const runs: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const open = xml.indexOf("<w:t", cursor);
    if (open === -1) break;
    const openEnd = xml.indexOf(">", open + 4);
    if (openEnd === -1) break;
    // <w:t/> is self-closing and carries no text; <w:tab/>, <w:tbl> and other
    // tags that merely start with "<w:t" are skipped the same way.
    const nextChar = xml[open + 4];
    if (xml[openEnd - 1] === "/" || (nextChar !== ">" && nextChar !== " ")) {
      cursor = openEnd + 1;
      continue;
    }
    const close = xml.indexOf("</w:t>", openEnd + 1);
    if (close === -1) break;
    runs.push(xml.slice(openEnd + 1, close));
    cursor = close + 6;
  }
  return runs;
}

/**
 * Collapse whitespace runs to single spaces WITHIN each line, keeping the
 * line structure the extractor produced.
 *
 * Line boundaries are not cosmetic here. Two authorities downstream read them:
 *
 *   - the cover/title check anchors on `^` with the `m` flag, so it can only
 *     see a title that begins a line;
 *   - pricing hygiene splits text into fragments on `\n` and relies on `.`
 *     not matching a line terminator to keep its proximity windows
 *     fragment-local — the "a fragment ending in a number must not pair with a
 *     priced term starting the next fragment" rule that pricing-hygiene.ts
 *     documents at length.
 *
 * Both guarantees held for DOCX, whose chunks are joined with newlines, and
 * silently did not hold for PDF: this function used to flatten every newline
 * to a space, so a 2,155-line finalized PDF reached both checks as ONE line.
 * On a real owner run that produced, on the same document whose DOCX source
 * passed, a MISSING_TITLE_OR_COVER on a PDF whose cover page reads
 * "Subject: Technical Proposal for …", plus two pricing "leaks" that existed
 * in no row of the document — "Row 2: Contract Value" pairing with a digit
 * from a different table row. AUTO_FINALIZE could not converge.
 *
 * Nothing is relaxed: the same text, the same patterns, the same thresholds —
 * they are simply applied to the lines the document actually has.
 */
export function collapseWhitespacePerLine(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Rejoin the visual line wraps a PDF text layer emits, so a paragraph arrives
 * as a paragraph.
 *
 * A newline in extracted PDF text is where the renderer ran out of column, not
 * where the author ended a thought. Preserving those newlines is right — see
 * collapseWhitespacePerLine — but treating each one as a semantic boundary is
 * as wrong as flattening them all, and pricing hygiene splits on newlines:
 *
 *   3. Contract Administration & Construction Supervision Cost:
 *   8,700 USD/month 2024-2026 G.C. (Ongoing)
 *
 * is one line of a Company Vault project reference that the PDF wrapped in
 * two. Alone, the second half is an amount with no label — the reference
 * exemption cannot see the contract, the supervision or the client that make
 * it a PAST project, and the row reads as this bid's price. The DOCX of the
 * same proposal, whose paragraphs survive extraction intact, is exempt. One
 * document, two answers, and AUTO_FINALIZE stuck on the PDF.
 *
 * A continuation is recognised structurally, not by vocabulary. The previous
 * line must not have ended a sentence, and then either this line begins with
 * something that cannot begin one — a lowercase letter, a digit, or a currency
 * symbol — or the previous line ends on a character that cannot end one: a
 * comma, colon, semicolon, ampersand or dash. Both halves are needed, because
 * a PDF wraps wherever the column runs out, including after "Study," and
 * before a capitalised word. A heading, a table row and a new sentence begin
 * with a capital AND follow a line that ended cleanly, so none of them is
 * joined and the cover-page and per-row boundaries stay exactly where they
 * were.
 */
export function reflowExtractedPdfLines(value: string): string {
  const lines = value.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const previous = out[out.length - 1];
    const previousText = previous?.trim() ?? "";
    const continues =
      previous !== undefined
      && previousText.length > 0
      && !/[.!?]["'\u201d\u2019)\]]?$/.test(previousText)
      && (/^[a-z0-9$€£]/.test(line.trim()) || /[,:;&\u2013\u2014-]$/.test(previousText));
    if (continues) out[out.length - 1] = `${previous} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

/** Collapse every whitespace run — newlines included — to single spaces. */
export function collapseWhitespace(value: string): string {
  let out = "";
  let inWhitespace = false;
  for (const ch of value) {
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
    if (isSpace) { inWhitespace = true; continue; }
    if (inWhitespace && out.length > 0) out += " ";
    inWhitespace = false;
    out += ch;
  }
  return out;
}

/**
 * Decode the five predefined XML entities in ONE pass.
 *
 * A chain of replaces decodes its own output: resolving &amp; before &apos;
 * turns a literal "&amp;apos;" — the correct encoding of the text "&apos;" —
 * into an apostrophe, and the review would then scan a string the document does
 * not say. One pass cannot re-read what it just wrote, so ordering stops
 * mattering.
 */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => XML_ENTITIES[name]);
}

/**
 * Read a generated document's client-visible text from its persisted base64.
 *
 * Returns null when there are no bytes or the container cannot be read, which
 * leaves the caller on its metadata fallback rather than reporting a clean
 * document nothing ever opened.
 */
/**
 * Same bytes, same text — so read them once.
 *
 * The visible text of a document is a pure function of its bytes, but nothing
 * remembered that, and reading a PDF is not cheap: on a real 262 KB generated
 * Technical Proposal the three text-layer extractors cost 1.3 s (pdf2json),
 * 3.2 s (pdf-parse) and 4.4 s (pdfjs), and extractPdf waits for all of them.
 *
 * GET /api/tenders/[id]/export-readiness is read-only, is polled by the UI, and
 * runs three readiness models in parallel. Measured on a two-document package
 * (that PDF plus a DOCX cover letter), the SAME PDF was extracted twice in one
 * request — once by getCanonicalTenderWorkflowDecision and once by
 * getFinalSubmissionReadiness — and again on the next poll. The route declares
 * `maxDuration = 10`; the owner's Preview returned 504 "Vercel Runtime Timeout
 * after 10 seconds".
 *
 * Keying on a digest of the bytes makes the cache exact: different bytes are a
 * different key, so no stale text can survive a regenerated document, and the
 * verdict computed from the text is unchanged. The in-flight promise is cached
 * rather than only the result, because the duplicate readers run concurrently —
 * caching the result alone would let both start the work before either
 * finished. Failures are not cached: a read that threw is retried next time
 * rather than remembered as "no text", which is the difference between an
 * environment hiccup and a verdict about the document.
 *
 * The missing optional `@napi-rs/canvas` warnings that accompany the timeout
 * come from pdfjs-dist loading its canvas backend; they are a symptom of the
 * extraction running, not the cost, and are left alone.
 */
const VISIBLE_TEXT_CACHE_LIMIT = 32;
const visibleTextCache = new Map<string, Promise<string | null>>();

function rememberVisibleText(key: string, work: Promise<string | null>): Promise<string | null> {
  visibleTextCache.set(key, work);
  if (visibleTextCache.size > VISIBLE_TEXT_CACHE_LIMIT) {
    const oldest = visibleTextCache.keys().next();
    if (!oldest.done) visibleTextCache.delete(oldest.value);
  }
  // A failed read must not become a cached "no text" answer.
  void work.catch(() => visibleTextCache.delete(key));
  return work;
}

/** Test seam: drop everything remembered about previously read documents. */
export function clearGeneratedDocumentVisibleTextCache(): void {
  visibleTextCache.clear();
}

export async function generatedDocumentVisibleText(
  document: {
    fileContent?: string | null;
    exactFileName?: string | null;
    name?: string | null;
    contentMimeType?: string | null;
  } | null | undefined,
): Promise<string | null> {
  const base64 = typeof document?.fileContent === "string" ? document.fileContent : null;
  if (!base64 || base64.length > MAX_GENERATED_ARTIFACT_BASE64_CHARS) return null;
  const cacheKey = `${createHash("sha256").update(base64).digest("hex")}:${document?.contentMimeType ?? ""}:${document?.exactFileName ?? document?.name ?? ""}`;
  const remembered = visibleTextCache.get(cacheKey);
  if (remembered) return remembered;
  return rememberVisibleText(cacheKey, readVisibleText(document, base64));
}

async function readVisibleText(
  document: {
    fileContent?: string | null;
    exactFileName?: string | null;
    name?: string | null;
    contentMimeType?: string | null;
  } | null | undefined,
  base64: string,
): Promise<string | null> {
  try {
    const buffer = Buffer.from(base64, "base64");
    // PDF bytes must be opened and inspected too. Previously every finalized
    // PDF bypassed visible-content validation because this reader only knew
    // about OPC/DOCX containers. That allowed a converted PDF to become the
    // Build Plan artifact even when its actual pages still contained a
    // placeholder, AI trace, or current-bid pricing.
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
      const fileName = document?.exactFileName ?? document?.name ?? "generated-document.pdf";
      const text = await extractTextFromBuffer(buffer, document?.contentMimeType ?? "application/pdf", fileName);
      if (!text.trim() || text.startsWith("[Extraction failed for ")) return null;
      return reflowExtractedPdfLines(collapseWhitespacePerLine(text));
    }

    // PK\x03\x04 — anything else is not an OPC container.
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
    const zip = await JSZip.loadAsync(buffer);
    const chunks: string[] = [];
    for (const part of TEXT_PARTS) {
      const entry = zip.file(part);
      if (!entry) continue;
      const xml = await entry.async("string");
      // Split on paragraph/table-row/table-cell boundaries BEFORE extracting
      // text runs, mirroring visibleXmlText() in export-readiness.ts. Without
      // this, every run in a part was joined with nothing but a plain space,
      // so adjacent table cells fused into one run-on unit with no boundary —
      // a value in one cell could then defeat a pricing-leakage exemption
      // meant for an unrelated cell. This is the same incident documented
      // there (a compliance-matrix row put "Financial Proposal Controls" in
      // one cell and "3 selected expert(s)" in another; the row had no price
      // at all, but the fused text read as one line containing both a
      // financial term and a digit) — it was fixed for that extractor but not
      // for this one, so the export/validate path that actually calls
      // generatedDocumentVisibleText kept hitting it.
      for (const segment of xml.split(/<\/w:(?:p|tr|tc)>/)) {
        const runs = wordTextRuns(segment);
        if (runs.length > 0) chunks.push(runs.join(" "));
      }
    }
    if (chunks.length === 0) return null;
    return decodeXmlEntities(chunks.map(collapseWhitespace).join("\n"));
  } catch {
    return null;
  }
}
