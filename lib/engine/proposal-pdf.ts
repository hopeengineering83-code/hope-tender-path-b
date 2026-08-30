import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import { createPdfFontSetFor, sanitizePdfText, type PdfFontSet, type PdfFontStyle } from "./pdf-unicode-fonts";

const PAGE_MARGIN = 56; // points (approx 20mm)
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const LINE_HEIGHT_BODY = 14;
const LINE_HEIGHT_H1 = 20;
const LINE_HEIGHT_H2 = 17;
const LINE_HEIGHT_H3 = 15;
const FONT_SIZE_BODY = 10;
const FONT_SIZE_H1 = 14;
const FONT_SIZE_H2 = 12;
const FONT_SIZE_H3 = 11;
const FONT_SIZE_SMALL = 9;
const FONT_SIZE_TABLE = 9;
const LINE_HEIGHT_TABLE = 12;
const PARAGRAPH_GAP = 6;
const SECTION_GAP = 16;

const BRAND_COLOR: [number, number, number] = [0.1, 0.18, 0.36];
const TEXT_COLOR: [number, number, number] = [0.05, 0.05, 0.05];
const MUTED_COLOR: [number, number, number] = [0.45, 0.45, 0.45];
const TABLE_BORDER: [number, number, number] = [0.7, 0.7, 0.7];
const TABLE_HEADER_BG: [number, number, number] = [0.94, 0.95, 0.97];

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
  drawHeaderFooter(ctx);
  return page;
}

function drawHeaderFooter(ctx: RenderContext): void {
  const page = currentPage(ctx);
  // Branded header — right-aligned small text
  if (ctx.headerText) {
    const headerText = sanitizePdfText(ctx.headerText);
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
    const fc = sanitizePdfText(ctx.footerContact).slice(0, 110);
    page.drawText(fc, {
      x: PAGE_MARGIN,
      y: 28,
      size: FONT_SIZE_SMALL - 1,
      font: ctx.fonts.fontFor(fc),
      color: rgb(...MUTED_COLOR),
    });
  }
  // Page number — right-aligned
  const idx = ctx.pages.length - 1;
  const num = `Page ${idx} of ${ctx.pages.length - 1}`;
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
  if (ctx.y - needed < PAGE_MARGIN + 30) addPage(ctx);
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
type InlineRun = { text: string; bold: boolean; italic: boolean };

function parseInlineRuns(input: string): InlineRun[] {
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

function drawInlineParagraph(
  ctx: RenderContext,
  text: string,
  opts: { size: number; lineHeight: number; indent?: number; color?: [number, number, number]; defaultBold?: boolean; defaultItalic?: boolean },
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
  type Word = { text: string; bold: boolean; italic: boolean };
  const words: Word[] = [];
  for (const run of runs) {
    const bold = run.bold || defaultBold;
    const italic = run.italic || defaultItalic;
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece === "") continue;
      if (/^\s+$/.test(piece)) {
        // whitespace — attach to the previous word as trailing space
        if (words.length > 0) words[words.length - 1].text += piece;
      } else {
        words.push({ text: piece, bold, italic });
      }
    }
  }

  // Body text reaches the font one word at a time, so it is sanitised here
  // rather than at each draw call. A control character anywhere in a paragraph
  // is the same hard export failure as one in the cover.
  for (const word of words) word.text = sanitizePdfText(word.text);

  const styleFor = (w: Word): PdfFontStyle => {
    if (w.bold) return "bold";
    if (w.italic) return "italic";
    return "regular";
  };

  // Greedy line fill
  let x = PAGE_MARGIN + indent;
  ensureSpace(ctx, opts.lineHeight);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const style = styleFor(w);
    const font = ctx.fonts.fontFor(w.text, style);
    const wordWidth = ctx.fonts.widthOf(w.text, opts.size, style);
    const spaceWidth = i < words.length - 1 ? ctx.fonts.widthOf(" ", opts.size) : 0;
    if (x + wordWidth > PAGE_MARGIN + indent + maxW && x > PAGE_MARGIN + indent) {
      // wrap
      ctx.y -= opts.lineHeight;
      ensureSpace(ctx, opts.lineHeight);
      x = PAGE_MARGIN + indent;
    }
    currentPage(ctx).drawText(w.text, {
      x,
      y: ctx.y - opts.lineHeight + 3,
      size: opts.size,
      font,
      color: rgb(...color),
    });
    x += wordWidth + spaceWidth;
  }
  ctx.y -= opts.lineHeight;
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

function drawHRule(ctx: RenderContext, color: [number, number, number] = [0.7, 0.7, 0.7]): void {
  ensureSpace(ctx, 8);
  currentPage(ctx).drawLine({
    start: { x: PAGE_MARGIN, y: ctx.y - 4 },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y: ctx.y - 4 },
    thickness: 0.5,
    color: rgb(...color),
  });
  ctx.y -= 8;
}

type LineToken =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "bullet"; text: string }
  | { type: "body"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "blank" };

function parseMarkdownLine(line: string): LineToken {
  if (/^###\s+/.test(line)) return { type: "h3", text: line.replace(/^###\s+/, "") };
  if (/^##\s+/.test(line)) return { type: "h2", text: line.replace(/^##\s+/, "") };
  if (/^#\s+/.test(line)) return { type: "h1", text: line.replace(/^#\s+/, "") };
  if (/^[-*]\s+/.test(line)) return { type: "bullet", text: line.replace(/^[-*]\s+/, "") };
  if (/^\d+\.\s+/.test(line)) return { type: "bullet", text: line.replace(/^\d+\.\s+/, "") };
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

function drawTable(ctx: RenderContext, rows: string[][]): void {
  if (rows.length === 0) return;
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols === 0) return;
  const colWidth = CONTENT_WIDTH / cols;
  const cellPad = 4;

  // Pre-wrap cell text so we know how many lines each row needs.
  const wrappedRows = rows.map((r, ri) => {
    return r
      .slice(0, cols)
      .concat(Array(Math.max(0, cols - r.length)).fill(""))
      .map((cell) => {
        // Strip inline markdown for table cells — pdf-lib cannot mix fonts
        // within a single drawText call. Bold/italic in cells are rendered
        // as plain text (same as before), preserving content parity at the
        // cost of inline-style parity in tables.
        const clean = cell.replace(/\*\*\*([^*]+)\*\*\*/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
        return wrapText(clean, ctx.fonts, "regular", FONT_SIZE_TABLE, colWidth - cellPad * 2);
      });
  });
  const rowHeights = wrappedRows.map((wr) => Math.max(...wr.map((lines) => lines.length), 1) * LINE_HEIGHT_TABLE + cellPad * 2);

  for (let ri = 0; ri < rows.length; ri++) {
    const rowHeight = rowHeights[ri];
    ensureSpace(ctx, rowHeight);
    const yTop = ctx.y;
    const yBottom = ctx.y - rowHeight;
    // Header row gets a fill background
    if (ri === 0) {
      currentPage(ctx).drawRectangle({
        x: PAGE_MARGIN,
        y: yBottom,
        width: CONTENT_WIDTH,
        height: rowHeight,
        color: rgb(...TABLE_HEADER_BG),
      });
    }
    // Cell borders + text
    for (let ci = 0; ci < cols; ci++) {
      const xLeft = PAGE_MARGIN + ci * colWidth;
      // Right border of cell
      currentPage(ctx).drawLine({
        start: { x: xLeft, y: yTop },
        end: { x: xLeft, y: yBottom },
        thickness: 0.4,
        color: rgb(...TABLE_BORDER),
      });
      // Cell text (wrapped lines)
      const lines = wrappedRows[ri][ci] ?? [""];
      let ty = yTop - cellPad - LINE_HEIGHT_TABLE + 3;
      for (const ln of lines) {
        const cellStyle: PdfFontStyle = ri === 0 ? "bold" : "regular";
        currentPage(ctx).drawText(ln, {
          x: xLeft + cellPad,
          y: ty,
          size: FONT_SIZE_TABLE,
          font: ctx.fonts.fontFor(ln, cellStyle),
          color: rgb(...TEXT_COLOR),
        });
        ty -= LINE_HEIGHT_TABLE;
      }
    }
    // Bottom border of row
    currentPage(ctx).drawLine({
      start: { x: PAGE_MARGIN, y: yBottom },
      end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yBottom },
      thickness: 0.4,
      color: rgb(...TABLE_BORDER),
    });
    // Right border of last column
    currentPage(ctx).drawLine({
      start: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yTop },
      end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: yBottom },
      thickness: 0.4,
      color: rgb(...TABLE_BORDER),
    });
    ctx.y = yBottom;
  }
  // Top border of table (above first row's top)
  currentPage(ctx).drawLine({
    start: { x: PAGE_MARGIN, y: ctx.y + rowHeights[0] },
    end: { x: PAGE_MARGIN + CONTENT_WIDTH, y: ctx.y + rowHeights[0] },
    thickness: 0.4,
    color: rgb(...TABLE_BORDER),
  });
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
  },
): Promise<void> {
  const page = ctx.pages[0];
  const cx = PAGE_WIDTH / 2;

  // Dark header band
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 120, width: PAGE_WIDTH, height: 120, color: rgb(...BRAND_COLOR) });

  const titleLines = wrapText(opts.title, ctx.fonts, "bold", 18, CONTENT_WIDTH - 20);
  let ty = PAGE_HEIGHT - 60;
  for (const ln of titleLines.slice(0, 3)) {
    const tw = ctx.fonts.widthOf(ln, 18, "bold");
    page.drawText(ln, { x: cx - tw / 2, y: ty, size: 18, font: ctx.fonts.fontFor(ln, "bold"), color: rgb(1, 1, 1) });
    ty -= 24;
  }

  // Sub-line block — match DOCX cover block parity (reference, client, date,
  // company name, contact, email subject).
  let sy = PAGE_HEIGHT - 155;
  // Every sub-line here is external tender or company text — client name,
  // reference, submission subject — so it is sanitised once and then measured
  // and drawn as the same string. A newline in any of them used to end the
  // export at the font layer.
  const drawCentered = (raw: string, style: PdfFontStyle, size: number, color: [number, number, number]) => {
    const text = sanitizePdfText(raw);
    const w = ctx.fonts.widthOf(text, size, style);
    page.drawText(text, { x: cx - w / 2, y: sy, size, font: ctx.fonts.fontFor(text, style), color: rgb(...color) });
    sy -= size + 6;
  };
  if (opts.companyName) drawCentered(opts.companyName, "bold", FONT_SIZE_H2, BRAND_COLOR);
  if (opts.reference) drawCentered(`Reference: ${opts.reference}`, "regular", FONT_SIZE_BODY, MUTED_COLOR);
  if (opts.clientName) drawCentered(`Client: ${opts.clientName}`, "regular", FONT_SIZE_BODY, MUTED_COLOR);
  if (opts.companyAddress) drawCentered(opts.companyAddress, "regular", FONT_SIZE_SMALL, MUTED_COLOR);
  if (opts.companyContact) drawCentered(opts.companyContact, "regular", FONT_SIZE_SMALL, MUTED_COLOR);
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
    opts.markdown,
  ].join("\n"));

  // Header text — tender title or company name, right-aligned on every page.
  const headerText = opts.companyName
    ? `${opts.companyName} | ${opts.title}`
    : opts.title;

  // Footer contact strip — composed from any provided branding fields.
  const footerParts: string[] = [];
  if (opts.companyAddress) footerParts.push(opts.companyAddress);
  if (opts.companyContact) footerParts.push(opts.companyContact);
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
  });

  // Content pages start here
  addPage(ctx);
  ctx.y = PAGE_HEIGHT - PAGE_MARGIN - 10;

  const tokens = parseMarkdownBlocks(opts.markdown);
  let prevType: string | null = null;

  for (const tok of tokens) {
    if (tok.type === "blank") {
      ctx.y -= PARAGRAPH_GAP;
      continue;
    }
    if (tok.type === "h1") {
      if (prevType && prevType !== "blank") ctx.y -= SECTION_GAP;
      ensureSpace(ctx, LINE_HEIGHT_H1 + 4);
      drawHRule(ctx, BRAND_COLOR);
      drawText(ctx, tok.text, { style: "bold", size: FONT_SIZE_H1, lineHeight: LINE_HEIGHT_H1, color: TEXT_COLOR });
      ctx.y -= 4;
    } else if (tok.type === "h2") {
      if (prevType && prevType !== "blank") ctx.y -= PARAGRAPH_GAP * 2;
      drawText(ctx, tok.text, { style: "bold", size: FONT_SIZE_H2, lineHeight: LINE_HEIGHT_H2, color: BRAND_COLOR });
      ctx.y -= 2;
    } else if (tok.type === "h3") {
      if (prevType && prevType !== "blank") ctx.y -= PARAGRAPH_GAP;
      drawText(ctx, tok.text, { style: "bold", size: FONT_SIZE_H3, lineHeight: LINE_HEIGHT_H3, color: TEXT_COLOR });
    } else if (tok.type === "bullet") {
      // Bullets may carry inline bold/italic — use the inline paragraph
      // renderer with a bullet glyph prefix and indent.
      ensureSpace(ctx, LINE_HEIGHT_BODY);
      currentPage(ctx).drawText("•", {
        x: PAGE_MARGIN + 4,
        y: ctx.y - LINE_HEIGHT_BODY + 3,
        size: FONT_SIZE_BODY,
        font: ctx.fonts.fontFor("•"),
        color: rgb(...TEXT_COLOR),
      });
      drawInlineParagraph(ctx, tok.text, {
        size: FONT_SIZE_BODY,
        lineHeight: LINE_HEIGHT_BODY,
        indent: 18,
        color: TEXT_COLOR,
      });
    } else if (tok.type === "table") {
      if (prevType && prevType !== "blank") ctx.y -= PARAGRAPH_GAP;
      drawTable(ctx, tok.rows);
      ctx.y -= PARAGRAPH_GAP;
    } else {
      // body — use inline renderer so **bold** and *italic* survive
      drawInlineParagraph(ctx, tok.text, {
        size: FONT_SIZE_BODY,
        lineHeight: LINE_HEIGHT_BODY,
        color: TEXT_COLOR,
      });
    }
    prevType = tok.type;
  }

  // Header/footer already drawn on every content page as it was added.
  return doc.save();
}
