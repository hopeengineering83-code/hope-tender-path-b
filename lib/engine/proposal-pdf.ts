import { PDFDocument, PDFHexString, rgb, type PDFPage } from "pdf-lib";
import { createHash } from "node:crypto";
import { createPdfFontSetFor, sanitizePdfText, type PdfFontSet, type PdfFontStyle } from "./pdf-unicode-fonts";

const PAGE_MARGIN = 56; // points (approx 20mm)
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
// Type scale. The body is 10.5 pt on a 15 pt line; each heading level is a
// clear step above the one below it (18 / 13.5 / 11.5 pt), so a section title,
// a subsection and a sub-subsection can be told apart at a glance. Headings
// used to be 14 / 12 / 11 pt over a 10 pt body — and, because the DOCX
// extractor handed this renderer no heading markers at all, every one of them
// was drawn as body text anyway.
const LINE_HEIGHT_BODY = 15;
const LINE_HEIGHT_H1 = 24;
const LINE_HEIGHT_H2 = 19;
const LINE_HEIGHT_H3 = 16;
const FONT_SIZE_BODY = 10.5;
const FONT_SIZE_H1 = 18;
const FONT_SIZE_H2 = 13.5;
const FONT_SIZE_H3 = 11.5;
const FONT_SIZE_SMALL = 9;
const FONT_SIZE_TABLE = 9;
const LINE_HEIGHT_TABLE = 12.5;
const PARAGRAPH_GAP = 6;
const SECTION_GAP = 16;
/** A heading is never left at the foot of a page without this much below it. */
const KEEP_WITH_NEXT = LINE_HEIGHT_BODY * 3;
/** The lowest a line may be drawn: clear of the footer rule and page number. */
const CONTENT_FLOOR = PAGE_MARGIN + 30;

const BRAND_COLOR: [number, number, number] = [0.1, 0.18, 0.36];
const ACCENT_COLOR: [number, number, number] = [0.72, 0.53, 0.16];
const TEXT_COLOR: [number, number, number] = [0.05, 0.05, 0.05];
const MUTED_COLOR: [number, number, number] = [0.45, 0.45, 0.45];
const TABLE_BORDER: [number, number, number] = [0.7, 0.7, 0.7];
const TABLE_ALT_BG: [number, number, number] = [0.975, 0.98, 0.988];
const HEADING3_COLOR: [number, number, number] = [0.2, 0.25, 0.33];

interface RenderContext {
  doc: PDFDocument;
  /**
   * Faces resolved per string rather than fixed per document.
   *
   * The three Helvetica faces were held directly here, and Helvetica is
   * WinAnsi-only, so the first Ethiopic character in a tender ended the export
   * with "WinAnsi cannot encode". Styles are now names and the set decides
   * which face can actually draw a given string, so measuring and drawing
   * always agree and no layout code has to know about scripts.
   */
  fonts: PdfFontSet;
  pages: PDFPage[];
  y: number;
  /** Branding header text — set after first content page is added. */
  headerText: string | null;
  /** Contact strip footer text. */
  footerContact: string | null;
}

function currentPage(ctx: RenderContext): PDFPage {
  return ctx.pages[ctx.pages.length - 1];
}

function addPage(ctx: RenderContext): PDFPage {
  const page = ctx.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  ctx.pages.push(page);
  ctx.y = PAGE_HEIGHT - PAGE_MARGIN;
  return page;
}

function fitTextToWidth(text: string, fonts: PdfFontSet, size: number, maxWidth: number): string {
  if (fonts.widthOf(text, size) <= maxWidth) return text;
  const ellipsis = "...";
  let fitted = text;
  while (fitted.length > 1 && fonts.widthOf(`${fitted}${ellipsis}`, size) > maxWidth) fitted = fitted.slice(0, -1);
  return `${fitted.trimEnd()}${ellipsis}`;
}

function drawHeaderFooter(ctx: RenderContext, page: PDFPage, pageIndex: number, totalPages: number): void {
  // The cover carries its own band and footer line. The running header used
  // to be drawn on it too, navy text over the navy band, with "Page 1 of N"
  // under the confidentiality note. It still counts as page 1, so the page
  // numbers the contents gives are the ones printed in the footer.
  if (pageIndex === 0) return;
  // Branded header — right-aligned small text
  if (ctx.headerText) {
    const headerText = fitTextToWidth(sanitizePdfText(ctx.headerText), ctx.fonts, FONT_SIZE_SMALL, CONTENT_WIDTH);
    const hw = ctx.fonts.widthOf(headerText, FONT_SIZE_SMALL);
    page.drawText(headerText, {
      x: PAGE_WIDTH - PAGE_MARGIN - hw,
      y: PAGE_HEIGHT - 30,
      size: FONT_SIZE_SMALL,
      font: ctx.fonts.fontFor(headerText),
      color: rgb(...BRAND_COLOR),
    });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: PAGE_HEIGHT - 38 },
      end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_HEIGHT - 38 },
      thickness: 0.6,
      color: rgb(...BRAND_COLOR),
    });
  }
  // Contact strip footer — left-aligned
  if (ctx.footerContact) {
    const fc = fitTextToWidth(sanitizePdfText(ctx.footerContact), ctx.fonts, FONT_SIZE_SMALL - 1, CONTENT_WIDTH - 75);
    page.drawText(fc, {
      x: PAGE_MARGIN,
      y: 28,
      size: FONT_SIZE_SMALL - 1,
      font: ctx.fonts.fontFor(fc),
      color: rgb(...MUTED_COLOR),
    });
  }
  // Page number — right-aligned
  const num = `Page ${pageIndex + 1} of ${totalPages}`;
  const nw = ctx.fonts.widthOf(num, FONT_SIZE_SMALL);
  page.drawText(num, {
    x: PAGE_WIDTH - PAGE_MARGIN - nw,
    y: 28,
    size: FONT_SIZE_SMALL,
    font: ctx.fonts.fontFor(num),
    color: rgb(...MUTED_COLOR),
  });
  // Footer rule
  page.drawLine({
    start: { x: PAGE_MARGIN, y: 42 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: 42 },
    thickness: 0.4,
    color: rgb(0.8, 0.8, 0.8),
  });
}

function ensureSpace(ctx: RenderContext, needed: number): void {
  if (ctx.y - needed < CONTENT_FLOOR) addPage(ctx);
}

/** True when nothing has been drawn on the current page yet. */
function atPageTop(ctx: RenderContext): boolean {
  return ctx.y >= PAGE_HEIGHT - PAGE_MARGIN - 12;
}

function wrapText(text: string, fonts: PdfFontSet, style: PdfFontStyle, fontSize: number, maxWidth: number): string[] {
  // Split on any whitespace run, not on the space character alone.
  //
  // A newline used to stay inside a "word" and reach the font as a glyph:
  // pdf-lib answered `WinAnsi cannot encode "\n" (0x000a)` and the export
  // died. Titles carry newlines routinely — a tender title extracted from a
  // document that wraps across two source lines keeps the break — so an
  // ordinary Latin tender could not produce its required PDFs. Breaking on
  // whitespace is also simply what wrapping means.
  //
  // Sanitised first so no control character can reach a font from here or
  // from any caller that measures with these lines.
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    // Measured with the face that will draw this exact text, so a line cannot
    // be laid out against Helvetica metrics and then rendered in Noto.
    const width = fonts.widthOf(test, fontSize, style);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ───────────────────────────────────────────────────────────────────────────
// Inline markdown parser — splits a paragraph into styled runs so bold and
// italic survive into the PDF (the DOCX preserves them, the PDF now does too).
// Supports **bold**, *italic*, and ***bold-italic*** markers.
// ───────────────────────────────────────────────────────────────────────────
export type InlineRun = { text: string; bold: boolean; italic: boolean };

export function parseInlineRuns(input: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Regex captures ***...*** first, then **...**, then *...*
  const re = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIndex) {
      runs.push({ text: input.slice(lastIndex, m.index), bold: false, italic: false });
    }
    const token = m[0];
    if (token.startsWith("***")) {
      runs.push({ text: token.slice(3, -3), bold: true, italic: true });
    } else if (token.startsWith("**")) {
      runs.push({ text: token.slice(2, -2), bold: true, italic: false });
    } else {
      runs.push({ text: token.slice(1, -1), bold: false, italic: true });
    }
    lastIndex = m.index + token.length;
  }
  if (lastIndex < input.length) {
    runs.push({ text: input.slice(lastIndex), bold: false, italic: false });
  }
  return runs.length ? runs : [{ text: input, bold: false, italic: false }];
}

/** One drawable word, plus whether the source put a space after it. */
export type LaidOutWord = { text: string; bold: boolean; italic: boolean; space: boolean };

/**
 * Split styled runs into drawable words, recording for each whether the source
 * actually had whitespace after it.
 *
 * The separator used to be unconditional — every word but the last advanced the
 * cursor by a full space — so two source-adjacent tokens were drawn apart. The
 * visible cases were a bold run ending immediately before punctuation, which
 * the delivered PDF rendered as "Ahmed Kebede Tekaw , General Manager" from
 * markdown that reads "**Ahmed Kebede Tekaw**, General Manager".
 *
 * Trailing whitespace is recorded rather than kept in the text, so a word's
 * measured width is the width of the word.
 */
export function layoutWords(
  runs: readonly InlineRun[],
  defaultBold = false,
  defaultItalic = false,
): LaidOutWord[] {
  const words: LaidOutWord[] = [];
  for (const run of runs) {
    const bold = run.bold || defaultBold;
    const italic = run.italic || defaultItalic;
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        if (words.length > 0) words[words.length - 1].space = true;
      } else {
        words.push({ text: piece, bold, italic, space: false });
      }
    }
  }
  return words;
}

function drawInlineParagraph(
  ctx: RenderContext,
  text: string,
  opts: {
    size: number;
    lineHeight: number;
    indent?: number;
    color?: [number, number, number];
    defaultBold?: boolean;
    defaultItalic?: boolean;
    /** A list marker drawn beside the first line, wherever that line lands. */
    marker?: { text: string; x: number; style: PdfFontStyle; color: [number, number, number] };
  },
): void {
  const indent = opts.indent ?? 0;
  const maxW = CONTENT_WIDTH - indent;
  const runs = parseInlineRuns(text);
  const defaultBold = opts.defaultBold ?? false;
  const defaultItalic = opts.defaultItalic ?? false;
  const color = opts.color ?? TEXT_COLOR;

  // Word-by-word wrap that respects run boundaries and uses the right font
  // for each word. This is a simplification (a word cannot span two runs),
  // but it produces correct visual output for the markdown the DOCX extractor
  // emits.
  const words: LaidOutWord[] = layoutWords(runs, defaultBold, defaultItalic);

  // Body text reaches the font one word at a time, so it is sanitised here
  // rather than at each draw call. A control character anywhere in a paragraph
  // is the same hard export failure as one in the cover.
  for (const word of words) word.text = sanitizePdfText(word.text);

  const styleFor = (w: LaidOutWord): PdfFontStyle => {
    if (w.bold) return "bold";
    if (w.italic) return "italic";
    return "regular";
  };

  // Lay the words out into lines first, so the page break can be chosen
  // before anything is drawn.
  type Placed = { word: LaidOutWord; style: PdfFontStyle; x: number };
  const lines: Placed[][] = [];
  let line: Placed[] = [];
  let x = PAGE_MARGIN + indent;
  for (const w of words) {
    const style = styleFor(w);
    const wordWidth = ctx.fonts.widthOf(w.text, opts.size, style);
    // A space is drawn only where the source had one. This used to add one
    // after every word except the last, so a bold run abutting punctuation
    // rendered as "Ahmed Kebede Tekaw , General Manager" and "Project Manager
    // (single-point-of-accountability) : Ahmed" in the delivered PDF — the
    // markdown has no space in either place.
    const spaceWidth = w.space ? ctx.fonts.widthOf(" ", opts.size) : 0;
    if (x + wordWidth > PAGE_MARGIN + indent + maxW && line.length > 0) {
      lines.push(line);
      line = [];
      x = PAGE_MARGIN + indent;
    }
    line.push({ word: w, style, x });
    x += wordWidth + spaceWidth;
  }
  if (line.length > 0) lines.push(line);
  if (lines.length === 0) lines.push([]);

  // Widows and orphans: a paragraph never leaves its first line alone at the
  // foot of a page, nor carries its last line alone onto the next one. The
  // delivered proposal opened a page with the single word "below." — the end
  // of a sentence whose table then followed.
  const fitsHere = Math.max(0, Math.floor((ctx.y - CONTENT_FLOOR) / opts.lineHeight));
  let breakAfter = lines.length; // lines drawn before the first page break
  if (lines.length > fitsHere) {
    if (fitsHere < 2) {
      addPage(ctx);
      breakAfter = Math.floor((ctx.y - CONTENT_FLOOR) / opts.lineHeight);
    } else {
      breakAfter = lines.length - fitsHere === 1 ? fitsHere - 1 : fitsHere;
      if (breakAfter < 2) {
        addPage(ctx);
        breakAfter = Math.floor((ctx.y - CONTENT_FLOOR) / opts.lineHeight);
      }
    }
  }
  lines.forEach((placed, li) => {
    if (li > 0 && (li === breakAfter || ctx.y - opts.lineHeight < CONTENT_FLOOR)) addPage(ctx);
    if (li === 0 && opts.marker) {
      const m = opts.marker;
      currentPage(ctx).drawText(m.text, { x: m.x, y: ctx.y - opts.lineHeight + 3, size: opts.size, font: ctx.fonts.fontFor(m.text, m.style), color: rgb(...m.color) });
    }
    for (const { word, style, x: wx } of placed) {
      currentPage(ctx).drawText(word.text, {
        x: wx,
        y: ctx.y - opts.lineHeight + 3,
        size: opts.size,
        font: ctx.fonts.fontFor(word.text, style),
        color: rgb(...color),
      });
    }
    ctx.y -= opts.lineHeight;
  });
}

function drawText(
  ctx: RenderContext,
  text: string,
  opts: { style: PdfFontStyle; size: number; lineHeight: number; indent?: number; color?: [number, number, number] },
): void {
  // Legacy single-font draw — used for headings (no inline bold/italic needed).
  const indent = opts.indent ?? 0;
  const maxW = CONTENT_WIDTH - indent;
  const lines = wrapText(text, ctx.fonts, opts.style, opts.size, maxW);
  for (const line of lines) {
    ensureSpace(ctx, opts.lineHeight);
    currentPage(ctx).drawText(line, {
      x: PAGE_MARGIN + indent,
      y: ctx.y - opts.lineHeight + 3,
      size: opts.size,
      font: ctx.fonts.fontFor(line, opts.style),
      color: opts.color ? rgb(...opts.color) : rgb(0, 0, 0),
    });
    ctx.y -= opts.lineHeight;
  }
}

function drawHRule(ctx: RenderContext, color: [number, number, number] = [0.7, 0.7, 0.7], thickness = 0.5, width = CONTENT_WIDTH): void {
  ensureSpace(ctx, 8);
  currentPage(ctx).drawLine({
    start: { x: PAGE_MARGIN, y: ctx.y - 4 },
    end: { x: PAGE_MARGIN + width, y: ctx.y - 4 },
    thickness,
    color: rgb(...color),
  });
  ctx.y -= 8;
}

type LineToken =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "bullet"; text: string; marker: string; level: number }
  | { type: "body"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "blank" };

function parseMarkdownLine(line: string): LineToken {
  if (/^###\s+/.test(line)) return { type: "h3", text: line.replace(/^###\s+/, "") };
  if (/^##\s+/.test(line)) return { type: "h2", text: line.replace(/^##\s+/, "") };
  if (/^#\s+/.test(line)) return { type: "h1", text: line.replace(/^#\s+/, "") };
  // List items keep their own marker and nesting. A numbered item used to be
  // drawn with a bullet and its number deleted, so "1. ... 2. ... 3." lost the
  // order the text refers to; an indented item fell through to body text and
  // printed its literal "- ".
  const list = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
  if (list) {
    const level = Math.min(Math.floor(list[1].length / 2), 3);
    const marker = /^\d/.test(list[2]) ? list[2] : "•";
    return { type: "bullet", text: list[3], marker, level };
  }
  if (line.trim() === "") return { type: "blank" };
  // Inline bold/italic are preserved in the body token; drawInlineParagraph
  // parses them at render time. (Previously they were stripped here, which
  // caused PDF/DOCX content divergence.)
  return { type: "body", text: line };
}

function parseMarkdownBlocks(markdown: string): LineToken[] {
  const tokens: LineToken[] = [];
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect a markdown table: a line starting with "|", followed by a
    // separator row of |---|---|, followed by zero or more data rows.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows: string[][] = [];
      // Header row
      rows.push(
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim()),
      );
      // Skip separator
      i += 2;
      // Data rows
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(
          lines[i]
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim()),
        );
        i += 1;
      }
      tokens.push({ type: "table", rows });
      continue;
    }
    tokens.push(parseMarkdownLine(line));
    i += 1;
  }
  return tokens;
}

/** Table cell text without inline markdown markers (a cell is one face). */
function plainCell(cell: string): string {
  return cell.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1").replace(/\\\|/g, "|");
}

/**
 * Column widths from the content, the way a browser's automatic table layout
 * does it: every column gets at least its longest word, and the room left is
 * shared out in proportion to how much text each column holds.
 *
 * Every column used to be CONTENT_WIDTH / cols. A five-column team table gave
 * its "#" column the same 97 pt as the column holding each expert's
 * responsibilities, which then wrapped to eleven lines — the rows ran three
 * times taller than their content needed.
 */
export function tableColumnWidths(
  rows: readonly (readonly string[])[],
  measure: (text: string, bold: boolean) => number,
  totalWidth: number,
  cellPad: number,
): number[] {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (cols === 0) return [];
  const minW: number[] = Array(cols).fill(0);
  const wantW: number[] = Array(cols).fill(0);
  rows.forEach((row, ri) => {
    for (let ci = 0; ci < cols; ci++) {
      const text = plainCell(row[ci] ?? "");
      const bold = ri === 0;
      const longestWord = Math.max(0, ...text.split(/\s+/).filter(Boolean).map((w) => measure(w, bold)));
      minW[ci] = Math.max(minW[ci], longestWord + cellPad * 2);
      wantW[ci] = Math.max(wantW[ci], measure(text, bold) + cellPad * 2);
    }
  });
  // No column's minimum may crowd the rest off the page; an over-long word is
  // wrapped inside its cell instead.
  const cap = totalWidth / Math.min(cols, 3);
  for (let ci = 0; ci < cols; ci++) minW[ci] = Math.min(minW[ci], cap);
  const sumMin = minW.reduce((a, b) => a + b, 0);
  const sumWant = wantW.reduce((a, b) => a + b, 0);
  if (sumWant <= totalWidth) {
    // Everything fits on one line per cell: spread the slack in proportion.
    return wantW.map((w) => (w / sumWant) * totalWidth);
  }
  if (sumMin >= totalWidth) return minW.map((w) => (w / sumMin) * totalWidth);
  const spare = totalWidth - sumMin;
  // Share the room above the minimums by the square root of each column's
  // excess, so one very long column cannot starve the others to one word wide.
  const excess = wantW.map((w, ci) => Math.sqrt(Math.max(0, w - minW[ci])));
  const sumExcess = excess.reduce((a, b) => a + b, 0) || 1;
  return minW.map((w, ci) => w + (excess[ci] / sumExcess) * spare);
}

// Six points gives descenders and multi-line cells clear air above the
// border. The earlier four-point pad visibly struck through the final line of
// expert-profile rows after PDF rasterisation.
const CELL_PAD = 6;

interface TableLayout {
  cols: number;
  widths: number[];
  wrappedRows: string[][][];
  rowHeights: number[];
}

function measureTable(ctx: RenderContext, rows: string[][]): TableLayout | null {
  if (rows.length === 0) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) return null;
  const cellPad = CELL_PAD;
  const widths = tableColumnWidths(
    rows,
    (text, bold) => ctx.fonts.widthOf(sanitizePdfText(text), FONT_SIZE_TABLE, bold ? "bold" : "regular"),
    CONTENT_WIDTH,
    cellPad,
  );

  // Pre-wrap cell text so we know how many lines each row needs.
  const wrappedRows = rows.map((r, ri) =>
    r
      .slice(0, cols)
      .concat(Array(Math.max(0, cols - r.length)).fill(""))
      .map((cell, ci) => wrapText(plainCell(cell), ctx.fonts, ri === 0 ? "bold" : "regular", FONT_SIZE_TABLE, widths[ci] - cellPad * 2)),
  );
  // The last line's baseline sits LINE_HEIGHT_TABLE - 3 below its line top,
  // so a descender ends about one point below that and the row still keeps
  // cellPad of clear air to its border. The extra blank line every row used
  // to reserve on top of that made each row one line taller than its text.
  const rowHeights = wrappedRows.map((wr) => Math.max(...wr.map((lines) => lines.length), 1) * LINE_HEIGHT_TABLE + cellPad * 2);
  return { cols, widths, wrappedRows, rowHeights };
}

const USABLE_PAGE_HEIGHT = PAGE_HEIGHT - PAGE_MARGIN - CONTENT_FLOOR;
/** A table no taller than this is never split across pages. */
const KEEP_WHOLE_TABLE_HEIGHT = USABLE_PAGE_HEIGHT * 0.5;

/**
 * The height a table must start with on its page: all of it when it is short
 * enough to be kept whole (drawTable moves it as a unit), otherwise its header
 * and first row. This is what a heading above the table must keep with.
 */
function tableStartHeight(ctx: RenderContext, rows: string[][]): number {
  const layout = measureTable(ctx, rows);
  if (!layout) return 0;
  const total = layout.rowHeights.reduce((a, b) => a + b, 0);
  return total <= KEEP_WHOLE_TABLE_HEIGHT ? total : layout.rowHeights[0] + (layout.rowHeights[1] ?? 0);
}

function drawTable(ctx: RenderContext, rows: string[][]): void {
  const layout = measureTable(ctx, rows);
  if (!layout) return;
  const { cols, widths, wrappedRows, rowHeights } = layout;
  const cellPad = CELL_PAD;
  const lefts = widths.map((_, ci) => PAGE_MARGIN + widths.slice(0, ci).reduce((a, b) => a + b, 0));
  const headerHeight = rowHeights[0];
  const hasBody = rows.length > 1;
  const total = rowHeights.reduce((a, b) => a + b, 0);
  if (total > ctx.y - CONTENT_FLOOR && total <= KEEP_WHOLE_TABLE_HEIGHT) {
    // A short table is kept whole. The scope-plan tables of seven rows each
    // split with their last row — "Key risk and mitigation" — alone at the
    // top of the next page under a repeated header.
    addPage(ctx);
  } else {
    // A header is never left alone at the foot of a page: it moves with the
    // first data row.
    ensureSpace(ctx, headerHeight + (hasBody ? rowHeights[1] : 0));
  }

  let segmentTop = ctx.y;
  let segmentPage = currentPage(ctx);
  const closeSegment = () => {
    // Top border belongs at the segment's original top. Computing it from
    // the final ctx.y put this line inside the final row whenever a table
    // contained more than one row — the visible strike-through in delivered
    // expert tables.
    segmentPage.drawLine({
      start: { x: PAGE_MARGIN, y: segmentTop },
      end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: segmentTop },
      thickness: 0.4,
      color: rgb(...TABLE_BORDER),
    });
  };

  const drawRow = (ri: number) => {
    const rowHeight = rowHeights[ri];
    const page = currentPage(ctx);
    const yTop = ctx.y;
    const yBottom = ctx.y - rowHeight;
    // Strong navy header and subtle alternating rows improve scanability
    // without introducing unsupported content or relying on colour alone.
    if (ri === 0) {
      page.drawRectangle({ x: PAGE_MARGIN, y: yBottom, width: CONTENT_WIDTH, height: rowHeight, color: rgb(...BRAND_COLOR) });
    } else if (ri % 2 === 0) {
      page.drawRectangle({ x: PAGE_MARGIN, y: yBottom, width: CONTENT_WIDTH, height: rowHeight, color: rgb(...TABLE_ALT_BG) });
    }
    for (let ci = 0; ci < cols; ci++) {
      const xLeft = lefts[ci];
      page.drawLine({ start: { x: xLeft, y: yTop }, end: { x: xLeft, y: yBottom }, thickness: 0.4, color: rgb(...TABLE_BORDER) });
      const lines = wrappedRows[ri][ci] ?? [""];
      let ty = yTop - cellPad - LINE_HEIGHT_TABLE + 3;
      const cellStyle: PdfFontStyle = ri === 0 ? "bold" : "regular";
      for (const ln of lines) {
        page.drawText(ln, {
          x: xLeft + cellPad,
          y: ty,
          size: FONT_SIZE_TABLE,
          font: ctx.fonts.fontFor(ln, cellStyle),
          color: ri === 0 ? rgb(1, 1, 1) : rgb(...TEXT_COLOR),
        });
        ty -= LINE_HEIGHT_TABLE;
      }
    }
    page.drawLine({ start: { x: PAGE_MARGIN, y: yBottom }, end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yBottom }, thickness: 0.4, color: rgb(...TABLE_BORDER) });
    page.drawLine({ start: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yTop }, end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yBottom }, thickness: 0.4, color: rgb(...TABLE_BORDER) });
    ctx.y = yBottom;
  };

  drawRow(0);
  for (let ri = 1; ri < rows.length; ri++) {
    const room = ctx.y - CONTENT_FLOOR;
    // Nor does a long table carry a single last row onto a page of its own.
    const strandsLastRow = ri === rows.length - 2 && ri >= 2 && rowHeights[ri] <= room && rowHeights[ri] + rowHeights[ri + 1] > room;
    if (rowHeights[ri] > room || strandsLastRow) {
      // The table continues on a new page under its own header row again,
      // so every page of a long table says what its columns are.
      closeSegment();
      addPage(ctx);
      segmentTop = ctx.y;
      segmentPage = currentPage(ctx);
      drawRow(0);
    }
    drawRow(ri);
  }
  closeSegment();
}

async function buildCoverPage(
  ctx: RenderContext,
  opts: {
    title: string;
    clientName?: string | null;
    reference?: string | null;
    generatedAt: Date;
    companyName?: string | null;
    companyAddress?: string | null;
    companyContact?: string | null;
    submissionEmailSubject?: string | null;
    coverDetails?: readonly string[];
  },
): Promise<void> {
  const page = ctx.pages[0];
  const cx = PAGE_WIDTH / 2;

  // Navy title band with a gold rule beneath it. The band grows with the
  // title, so a long tender title is never clipped.
  const titleLines = wrapText(opts.title, ctx.fonts, "bold", 22, CONTENT_WIDTH - 20).slice(0, 4);
  const bandHeight = 150 + titleLines.length * 28;
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bandHeight, width: PAGE_WIDTH, height: bandHeight, color: rgb(...BRAND_COLOR) });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - bandHeight - 6, width: PAGE_WIDTH, height: 6, color: rgb(...ACCENT_COLOR) });

  const label = "TECHNICAL PROPOSAL";
  const lw = ctx.fonts.widthOf(label, 11, "bold");
  page.drawText(label, { x: cx - lw / 2, y: PAGE_HEIGHT - 90, size: 11, font: ctx.fonts.fontFor(label, "bold"), color: rgb(...ACCENT_COLOR) });
  let ty = PAGE_HEIGHT - 130;
  for (const ln of titleLines) {
    const tw = ctx.fonts.widthOf(ln, 22, "bold");
    page.drawText(ln, { x: cx - tw / 2, y: ty, size: 22, font: ctx.fonts.fontFor(ln, "bold"), color: rgb(1, 1, 1) });
    ty -= 28;
  }

  // Every sub-line here is external tender or company text — client name,
  // reference, submission subject — so it is sanitised once and then measured
  // and drawn as the same string. A newline in any of them used to end the
  // export at the font layer.
  let sy = PAGE_HEIGHT - bandHeight - 70;
  const drawCentered = (raw: string, style: PdfFontStyle, size: number, color: [number, number, number]) => {
    const lines = wrapText(sanitizePdfText(raw), ctx.fonts, style, size, CONTENT_WIDTH);
    for (const text of lines) {
      const w = ctx.fonts.widthOf(text, size, style);
      page.drawText(text, { x: cx - w / 2, y: sy, size, font: ctx.fonts.fontFor(text, style), color: rgb(...color) });
      sy -= size + 6;
    }
  };
  const caption = (text: string) => {
    drawCentered(text.toUpperCase(), "bold", FONT_SIZE_SMALL, ACCENT_COLOR);
    sy -= 2;
  };

  if (opts.clientName || opts.reference) {
    caption("Submitted to");
    if (opts.clientName) drawCentered(opts.clientName, "bold", FONT_SIZE_H2, TEXT_COLOR);
    if (opts.reference) drawCentered(`Reference: ${opts.reference}`, "regular", FONT_SIZE_BODY, MUTED_COLOR);
    sy -= 34;
  }
  if (opts.companyName) {
    caption("Prepared by");
    drawCentered(opts.companyName, "bold", FONT_SIZE_H2, BRAND_COLOR);
  }
  if (opts.companyAddress) drawCentered(opts.companyAddress, "regular", FONT_SIZE_SMALL, MUTED_COLOR);
  if (opts.companyContact) drawCentered(opts.companyContact, "regular", FONT_SIZE_SMALL, MUTED_COLOR);
  // Company-record facts the DOCX cover carries (registration, signatory,
  // submission date and validity). They reach the PDF as the DOCX's cover
  // detail lines and are printed here rather than as body text on page 2.
  for (const detail of opts.coverDetails ?? []) drawCentered(detail, "regular", FONT_SIZE_SMALL, MUTED_COLOR);
  sy -= 24;
  if (opts.submissionEmailSubject) drawCentered(`Subject: ${opts.submissionEmailSubject}`, "italic", FONT_SIZE_SMALL, MUTED_COLOR);
  const dateStr = `Generated: ${opts.generatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`;
  drawCentered(dateStr, "regular", FONT_SIZE_SMALL, MUTED_COLOR);

  // Confidentiality note
  const conf = "CONFIDENTIAL — Commercial-in-confidence. Not for redistribution.";
  const cfw = ctx.fonts.widthOf(conf, FONT_SIZE_SMALL, "italic");
  page.drawText(conf, { x: cx - cfw / 2, y: PAGE_MARGIN + 20, size: FONT_SIZE_SMALL, font: ctx.fonts.fontFor(conf, "italic"), color: rgb(0.55, 0.55, 0.55) });

  // Footer line
  page.drawLine({
    start: { x: PAGE_MARGIN, y: PAGE_MARGIN + 15 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_MARGIN + 15 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });
}


/**
 * The authorised signature and company stamp, drawn where a signature belongs.
 *
 * WHY THIS IS HERE AND NOT IN THE DOCX APPLIER
 * --------------------------------------------
 * apply-signature-stamp.ts embeds both images into the generated DOCX and does
 * it correctly. pdf-finalizer then renders the delivered PDF from the DOCX's
 * extracted markdown TEXT rather than by converting the DOCX bytes, so images
 * cannot survive that step: the delivered proposal carried 36 XObject
 * references and not one of them was an image, while the vault held an ACTIVE,
 * integrity-VERIFIED signature (3,246 bytes) and stamp (103,155 bytes). No
 * tender of any sector could deliver a signed or stamped PDF.
 *
 * The renderer therefore draws them itself, anchored to the declaration's own
 * signature rule so they land on whatever page the declaration reaches and
 * cannot overlap the text around them.
 */
export interface PdfBrandImage {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}

/** Height in points for a drawn brand image; width follows the aspect ratio. */
const SIGNATURE_HEIGHT = 46;
const STAMP_HEIGHT = 74;

async function embedBrandImage(doc: PDFDocument, image: PdfBrandImage) {
  const isPng = /png/i.test(image.mimeType);
  return isPng ? doc.embedPng(image.bytes) : doc.embedJpg(image.bytes);
}

async function drawSignatureAndStamp(
  ctx: RenderContext,
  signature: PdfBrandImage | null,
  stamp: PdfBrandImage | null,
): Promise<void> {
  if (!signature && !stamp) return;

  const drawn: Array<{ embedded: Awaited<ReturnType<typeof embedBrandImage>>; height: number }> = [];
  for (const [image, height] of [[signature, SIGNATURE_HEIGHT], [stamp, STAMP_HEIGHT]] as const) {
    if (!image) continue;
    try {
      drawn.push({ embedded: await embedBrandImage(ctx.doc, image), height });
    } catch {
      // A corrupt or unsupported image must never cost the client the whole
      // proposal. The signature rule below still gives somewhere to sign.
    }
  }
  if (drawn.length === 0) return;

  const blockHeight = Math.max(...drawn.map((d) => d.height));
  ensureSpace(ctx, blockHeight + 12);
  const page = currentPage(ctx);
  let x = PAGE_MARGIN;
  for (const { embedded, height } of drawn) {
    const width = (embedded.width / embedded.height) * height;
    // Never let a wide asset run into the margin.
    const scale = Math.min(1, (CONTENT_WIDTH / 2 - 12) / width);
    page.drawImage(embedded, {
      x,
      y: ctx.y - height * scale,
      width: width * scale,
      height: height * scale,
    });
    x += width * scale + 28;
  }
  ctx.y -= blockHeight + 12;
}

/**
 * The declaration's own signature rule — the line carrying all three labels.
 * Matches keepDeclarationSignatureRule in generate-elite.ts, which is what
 * decides that this line survives sanitisation.
 */
function isDeclarationSignatureRule(text: string): boolean {
  return /\bSignature\s*:/i.test(text)
    && /\bStamp\s*:/i.test(text)
    && /\bDate\s*:/i.test(text);
}

type HeadingToken = Extract<LineToken, { type: "h1" | "h2" | "h3" }>;

/** A top-level section title: navy, with a gold rule beneath it. */
function drawSectionHeading(ctx: RenderContext, text: string): void {
  drawText(ctx, text, { style: "bold", size: FONT_SIZE_H1, lineHeight: LINE_HEIGHT_H1, color: BRAND_COLOR });
  ctx.y += 2;
  drawHRule(ctx, ACCENT_COLOR, 1.4, 72);
  ctx.y -= 6;
}

/**
 * Headings. Every top-level section opens a page, as it does in the DOCX
 * (pageBreakBefore on each Heading 1 after the first). No heading is left at
 * the foot of a page: it moves to the next one with the lines it introduces.
 */
function renderHeading(ctx: RenderContext, tok: HeadingToken, prevType: string | null, keepWithNext = KEEP_WITH_NEXT): void {
  if (tok.type === "h1") {
    if (!atPageTop(ctx)) addPage(ctx);
    drawSectionHeading(ctx, tok.text);
    return;
  }
  const size = tok.type === "h2" ? FONT_SIZE_H2 : FONT_SIZE_H3;
  const lineHeight = tok.type === "h2" ? LINE_HEIGHT_H2 : LINE_HEIGHT_H3;
  const lines = wrapText(tok.text, ctx.fonts, "bold", size, CONTENT_WIDTH);
  const gap = atPageTop(ctx) ? 0 : tok.type === "h2" ? (prevType && prevType !== "blank" ? 12 : 8) : (prevType && prevType !== "blank" ? 8 : 4);
  if (ctx.y - gap - lines.length * lineHeight - keepWithNext < CONTENT_FLOOR) addPage(ctx);
  else ctx.y -= gap;
  drawText(ctx, tok.text, { style: "bold", size, lineHeight, color: tok.type === "h2" ? BRAND_COLOR : HEADING3_COLOR });
  ctx.y -= 3;
}

interface TocEntry {
  tokenIndex: number;
  level: 1 | 2;
  text: string;
  /** Filled in once the heading has been drawn. */
  pageIndex: number | null;
  /** Where the entry's page number goes. */
  slot: { page: PDFPage; y: number; textEnd: number } | null;
}

interface TocPlan {
  tokenIndex: number;
  entries: TocEntry[];
}

/**
 * The contents, planned from the headings the document really has.
 *
 * The PDF used to print whatever lines followed "Table of Contents" as body
 * text — a plain list with no page numbers, in the same face and size as the
 * paragraphs. The entries are now the document's own top two heading levels,
 * and each gets the page its heading is drawn on.
 */
export function planTableOfContents(tokens: readonly LineToken[]): TocPlan | null {
  const tokenIndex = tokens.findIndex((t) => (t.type === "h1" || t.type === "h2") && /^table of contents$/i.test(t.text.trim()));
  if (tokenIndex < 0) return null;
  const entries: TocEntry[] = [];
  for (let i = tokenIndex + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "h1" || t.type === "h2") {
      entries.push({ tokenIndex: i, level: t.type === "h1" ? 1 : 2, text: t.text.replace(/\*+/g, "").trim(), pageIndex: null, slot: null });
    }
  }
  return entries.length > 0 ? { tokenIndex, entries } : null;
}

const TOC_NUMBER_WIDTH = 28;

function drawTableOfContentsEntries(ctx: RenderContext, toc: TocPlan): void {
  for (const entry of toc.entries) {
    const top = entry.level === 1;
    const size = top ? FONT_SIZE_BODY : FONT_SIZE_BODY - 0.5;
    const lineHeight = top ? LINE_HEIGHT_BODY + 3 : LINE_HEIGHT_BODY;
    const indent = top ? 0 : 16;
    const style: PdfFontStyle = top ? "bold" : "regular";
    ensureSpace(ctx, lineHeight);
    const text = fitTextToWidth(sanitizePdfText(entry.text), ctx.fonts, size, CONTENT_WIDTH - indent - TOC_NUMBER_WIDTH - 12);
    const y = ctx.y - lineHeight + 3;
    currentPage(ctx).drawText(text, {
      x: PAGE_MARGIN + indent,
      y,
      size,
      font: ctx.fonts.fontFor(text, style),
      color: rgb(...(top ? BRAND_COLOR : TEXT_COLOR)),
    });
    entry.slot = { page: currentPage(ctx), y, textEnd: PAGE_MARGIN + indent + ctx.fonts.widthOf(text, size, style) };
    ctx.y -= lineHeight;
  }
  ctx.y -= PARAGRAPH_GAP;
}

function drawTableOfContentsPageNumbers(ctx: RenderContext, toc: TocPlan): void {
  const right = PAGE_WIDTH - PAGE_MARGIN;
  for (const entry of toc.entries) {
    if (!entry.slot || entry.pageIndex === null) continue;
    const num = String(entry.pageIndex + 1);
    const size = FONT_SIZE_BODY;
    const nw = ctx.fonts.widthOf(num, size);
    entry.slot.page.drawText(num, { x: right - nw, y: entry.slot.y, size, font: ctx.fonts.fontFor(num), color: rgb(...TEXT_COLOR) });
    // Dot leader from the entry to its number.
    const dotW = ctx.fonts.widthOf(".", size) + 1.6;
    const from = entry.slot.textEnd + 6;
    const to = right - nw - 4;
    const count = Math.floor((to - from) / dotW);
    if (count > 2) {
      let x = to - count * dotW;
      for (let i = 0; i < count; i++) {
        entry.slot.page.drawText(".", { x, y: entry.slot.y, size, font: ctx.fonts.fontFor("."), color: rgb(...MUTED_COLOR) });
        x += dotW;
      }
    }
  }
}

/**
 * The declaration's "Signature: ___ Stamp: ___ Date: ___" rule, drawn as
 * three labelled lines to sign on. As text it arrived with its underscores
 * shortened by upstream cleaning and printed as three stubs too short to sign.
 */
function drawSigningLines(ctx: RenderContext): void {
  const labels = ["Signature", "Stamp", "Date"];
  const gap = 18;
  const slot = (CONTENT_WIDTH - gap * (labels.length - 1)) / labels.length;
  ensureSpace(ctx, 44);
  const page = currentPage(ctx);
  const lineY = ctx.y - 26;
  labels.forEach((label, i) => {
    const x = PAGE_MARGIN + i * (slot + gap);
    page.drawLine({ start: { x, y: lineY }, end: { x: x + slot, y: lineY }, thickness: 0.6, color: rgb(...TEXT_COLOR) });
    page.drawText(label, { x, y: lineY - 12, size: FONT_SIZE_SMALL, font: ctx.fonts.fontFor(label), color: rgb(...MUTED_COLOR) });
  });
  ctx.y = lineY - 20;
}

export async function generateProposalPdf(opts: {
  title: string;
  clientName?: string | null;
  reference?: string | null;
  markdown: string;
  /** Optional branding context — emitted on the cover page and in the header. */
  companyName?: string | null;
  companyAddress?: string | null;
  companyContact?: string | null;
  submissionEmailSubject?: string | null;
  /** Authorised signature image, when the tender permits one. */
  signature?: PdfBrandImage | null;
  /** Company stamp/seal image, when the tender permits one. */
  stamp?: PdfBrandImage | null;
  /** Cover-page facts from the DOCX cover (docx-paragraph-styles.ts). */
  coverDetails?: readonly string[];
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // The font set is built from everything this document will contain — cover
  // fields, header, footer and body — so the decision to embed a Unicode face
  // is made once, from the real text, before a single glyph is measured. A
  // face chosen per draw call would embed nothing until the first Ethiopic
  // string and then measure earlier lines against different metrics.
  const fonts = await createPdfFontSetFor(doc, [
    opts.title,
    opts.clientName ?? "",
    opts.reference ?? "",
    opts.companyName ?? "",
    opts.companyAddress ?? "",
    opts.companyContact ?? "",
    opts.submissionEmailSubject ?? "",
    ...(opts.coverDetails ?? []),
    opts.markdown,
  ].join("\n"));

  // Repeating the full company name plus tender title cannot fit an A4 header
  // and previously ended every page in a visible ellipsis. The cover already
  // carries the complete tender title; the running header identifies the
  // bidder without clipping or silently abbreviating client-facing text.
  const headerText = opts.companyName ?? opts.title;

  // Footer contact strip — composed from any provided branding fields.
  const footerParts: string[] = [];
  // Prefer the concise contact strip. The full address remains on the cover;
  // combining both here overflowed the footer on every page.
  if (opts.companyContact) footerParts.push(opts.companyContact);
  else if (opts.companyAddress) footerParts.push(opts.companyAddress);
  const footerContact = footerParts.length ? footerParts.join("  |  ") : null;

  // Cover page (page 0 — not numbered)
  const coverPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: RenderContext = {
    doc,
    fonts,
    pages: [coverPage],
    y: PAGE_HEIGHT - PAGE_MARGIN,
    headerText,
    footerContact,
  };
  await buildCoverPage(ctx, {
    title: opts.title,
    clientName: opts.clientName,
    reference: opts.reference,
    generatedAt: new Date(),
    companyName: opts.companyName ?? null,
    companyAddress: opts.companyAddress ?? null,
    companyContact: opts.companyContact ?? null,
    submissionEmailSubject: opts.submissionEmailSubject ?? null,
    coverDetails: opts.coverDetails ?? [],
  });

  // Content pages start here
  addPage(ctx);
  ctx.y = PAGE_HEIGHT - PAGE_MARGIN - 10;

  const tokens = parseMarkdownBlocks(opts.markdown);
  const toc = planTableOfContents(tokens);
  let prevType: string | null = null;
  let skippingStaticToc = false;
  let tocEntryCursor = 0;

  // What a heading must keep with it: the next block's opening, whether that
  // is three lines of text or a table's header and first row. A heading kept
  // with three lines of text alone was left at the foot of a page above a
  // project card whose table moved to the next.
  //
  // A short lead-in between a heading and its table ("Tender scope: ..." above
  // each scope-plan table) travels with both: the heading and lead-in used to
  // sit at the foot of one page with the table they introduce on the next.
  const bodyHeight = (text: string, indent = 0) =>
    wrapText(text.replace(/\*+/g, ""), ctx.fonts, "regular", FONT_SIZE_BODY, CONTENT_WIDTH - indent).length * LINE_HEIGHT_BODY + 2;
  const keepWithNextFor = (ti: number): number => {
    let need = 0;
    let leadIns = 0;
    for (let j = ti + 1; j < tokens.length; j++) {
      const next = tokens[j];
      if (next.type === "blank") { need += PARAGRAPH_GAP; continue; }
      if (next.type === "table") {
        need += tableStartHeight(ctx, next.rows) + PARAGRAPH_GAP;
        break;
      }
      if (next.type === "h2" || next.type === "h3") {
        // A heading directly under a heading keeps the pair together.
        if (leadIns === 0) need += LINE_HEIGHT_H2 + KEEP_WITH_NEXT;
        else need = Math.max(need, KEEP_WITH_NEXT);
        break;
      }
      if (next.type === "h1") break;
      const height = bodyHeight(next.text, next.type === "bullet" ? 18 : 0);
      leadIns++;
      if (leadIns > 2 || height > LINE_HEIGHT_BODY * 5) {
        // A real passage of text follows, not a lead-in: keep three lines.
        need = Math.max(need - height, 0) + KEEP_WITH_NEXT;
        break;
      }
      need += height;
    }
    return Math.min(Math.max(need, KEEP_WITH_NEXT), USABLE_PAGE_HEIGHT * 0.6);
  };

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    const isHeading = tok.type === "h1" || tok.type === "h2" || tok.type === "h3";
    if (skippingStaticToc) {
      // The markdown's own contents list, if it has one, is replaced by the
      // generated one below, which knows the page numbers.
      if (!isHeading) continue;
      skippingStaticToc = false;
    }
    if (tok.type === "blank") {
      if (!atPageTop(ctx)) ctx.y -= PARAGRAPH_GAP;
      continue;
    }
    if (toc && ti === toc.tokenIndex) {
      if (!atPageTop(ctx)) addPage(ctx);
      drawSectionHeading(ctx, "Table of Contents");
      drawTableOfContentsEntries(ctx, toc);
      skippingStaticToc = true;
      prevType = "toc";
      continue;
    }
    if (isHeading && toc && ti > toc.tokenIndex && tocEntryCursor < toc.entries.length && toc.entries[tocEntryCursor].tokenIndex === ti) {
      // Where this heading lands is where the contents says it is.
      const entry = toc.entries[tocEntryCursor++];
      renderHeading(ctx, tok, prevType, keepWithNextFor(ti));
      entry.pageIndex = ctx.pages.length - 1;
      prevType = tok.type;
      continue;
    }
    if (isHeading) {
      renderHeading(ctx, tok, prevType, keepWithNextFor(ti));
    } else if (tok.type === "bullet") {
      const indent = 18 + tok.level * 16;
      const markerX = PAGE_MARGIN + indent - (tok.marker === "•" ? 12 : 16);
      drawInlineParagraph(ctx, tok.text, {
        size: FONT_SIZE_BODY,
        lineHeight: LINE_HEIGHT_BODY,
        indent,
        color: TEXT_COLOR,
        marker: {
          text: tok.marker,
          x: markerX,
          style: tok.marker === "•" ? "regular" : "bold",
          color: tok.marker === "•" ? ACCENT_COLOR : BRAND_COLOR,
        },
      });
      ctx.y -= 2;
    } else if (tok.type === "table") {
      if (prevType && prevType !== "blank" && !atPageTop(ctx)) ctx.y -= PARAGRAPH_GAP;
      drawTable(ctx, tok.rows);
      ctx.y -= PARAGRAPH_GAP;
    } else {
      // The signature and stamp go immediately above the declaration's own
      // signature rule, so they land wherever the declaration lands.
      if (isDeclarationSignatureRule(tok.text)) {
        await drawSignatureAndStamp(ctx, opts.signature ?? null, opts.stamp ?? null);
        drawSigningLines(ctx);
        prevType = tok.type;
        continue;
      }
      // body — use inline renderer so **bold** and *italic* survive
      drawInlineParagraph(ctx, tok.text, {
        size: FONT_SIZE_BODY,
        lineHeight: LINE_HEIGHT_BODY,
        color: TEXT_COLOR,
      });
      ctx.y -= 2;
    }
    prevType = tok.type;
  }
  if (toc) drawTableOfContentsPageNumbers(ctx, toc);

  // Give the file the trailer /ID the PDF specification asks every document to
  // carry. pdf-lib emits none, so every proposal this app produced was
  // identity-less, and a reader that keys anything on document identity sees
  // two different proposals as the same file. Measured: pdf2json, one of the
  // three text-layer extractors, returned the FIRST document's text when asked
  // to parse a second, structurally similar one — so a validator could judge a
  // regenerated proposal against the bytes of the previous version. Two
  // obviously different PDFs (different page counts and sizes) did not
  // collide, which is what made this invisible until two near-identical
  // proposals were read in one process.
  //
  // The identity is derived from the document's own content, so identical
  // bytes keep an identical id and a changed document gets a new one.
  const identitySource = [opts.title, opts.clientName ?? "", opts.reference ?? "", opts.companyName ?? "", opts.markdown].join("\u0000");
  const documentId = PDFHexString.of(createHash("sha256").update(identitySource, "utf8").digest("hex").slice(0, 32).toUpperCase());
  doc.context.trailerInfo.ID = doc.context.obj([documentId, documentId]);

  const totalPages = ctx.pages.length;
  ctx.pages.forEach((page, pageIndex) => drawHeaderFooter(ctx, page, pageIndex, totalPages));
  return doc.save();
}

export const __testing__ = { fitTextToWidth };
