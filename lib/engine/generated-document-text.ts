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

/** Collapse whitespace runs to single spaces without backtracking. */
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
      return collapseWhitespace(text);
    }

    // PK\x03\x04 — anything else is not an OPC container.
    if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return null;
    const zip = await JSZip.loadAsync(buffer);
    const chunks: string[] = [];
    for (const part of TEXT_PARTS) {
      const entry = zip.file(part);
      if (!entry) continue;
      chunks.push(...wordTextRuns(await entry.async("string")));
    }
    if (chunks.length === 0) return null;
    return decodeXmlEntities(collapseWhitespace(chunks.join(" ")));
  } catch {
    return null;
  }
}
