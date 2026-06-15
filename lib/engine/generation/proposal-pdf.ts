import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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
const PARAGRAPH_GAP = 6;
const SECTION_GAP = 16;

interface RenderContext {
  doc: PDFDocument;
  bold: PDFFont;
  regular: PDFFont;
  italic: PDFFont;
  pages: PDFPage[];
  y: number;
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

function ensureSpace(ctx: RenderContext, needed: number): void {
  if (ctx.y - needed < PAGE_MARGIN) addPage(ctx);
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
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

function drawText(
  ctx: RenderContext,
  text: string,
  opts: { font: PDFFont; size: number; lineHeight: number; indent?: number; color?: [number, number, number] },
): void {
  const indent = opts.indent ?? 0;
  const maxW = CONTENT_WIDTH - indent;
  const lines = wrapText(text, opts.font, opts.size, maxW);
  for (const line of lines) {
    ensureSpace(ctx, opts.lineHeight);
    currentPage(ctx).drawText(line, {
      x: PAGE_MARGIN + indent,
      y: ctx.y - opts.lineHeight + 3,
      size: opts.size,
      font: opts.font,
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
  | { type: "blank" };

function parseMarkdownLines(markdown: string): LineToken[] {
  const tokens: LineToken[] = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) tokens.push({ type: "h3", text: line.replace(/^###\s+/, "") });
    else if (/^##\s+/.test(line)) tokens.push({ type: "h2", text: line.replace(/^##\s+/, "") });
    else if (/^#\s+/.test(line)) tokens.push({ type: "h1", text: line.replace(/^#\s+/, "") });
    else if (/^[-*]\s+/.test(line)) tokens.push({ type: "bullet", text: line.replace(/^[-*]\s+/, "") });
    else if (/^\d+\.\s+/.test(line)) tokens.push({ type: "bullet", text: line.replace(/^\d+\.\s+/, "") });
    else if (line.trim() === "") tokens.push({ type: "blank" });
    else tokens.push({ type: "body", text: line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1") });
  }
  return tokens;
}

async function buildCoverPage(
  ctx: RenderContext,
  opts: { title: string; clientName?: string | null; reference?: string | null; generatedAt: Date },
): Promise<void> {
  const page = ctx.pages[0];
  const cx = PAGE_WIDTH / 2;

  // Dark header band
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 120, width: PAGE_WIDTH, height: 120, color: rgb(0.1, 0.18, 0.36) });

  const titleLines = wrapText(opts.title, ctx.bold, 18, CONTENT_WIDTH - 20);
  let ty = PAGE_HEIGHT - 60;
  for (const ln of titleLines.slice(0, 3)) {
    const tw = ctx.bold.widthOfTextAtSize(ln, 18);
    page.drawText(ln, { x: cx - tw / 2, y: ty, size: 18, font: ctx.bold, color: rgb(1, 1, 1) });
    ty -= 24;
  }

  // Sub-line
  let sy = PAGE_HEIGHT - 155;
  if (opts.reference) {
    const ref = `Reference: ${opts.reference}`;
    const rw = ctx.regular.widthOfTextAtSize(ref, FONT_SIZE_BODY);
    page.drawText(ref, { x: cx - rw / 2, y: sy, size: FONT_SIZE_BODY, font: ctx.regular, color: rgb(0.35, 0.35, 0.35) });
    sy -= 18;
  }
  if (opts.clientName) {
    const cl = `Client: ${opts.clientName}`;
    const cw = ctx.regular.widthOfTextAtSize(cl, FONT_SIZE_BODY);
    page.drawText(cl, { x: cx - cw / 2, y: sy, size: FONT_SIZE_BODY, font: ctx.regular, color: rgb(0.35, 0.35, 0.35) });
    sy -= 18;
  }
  const dateStr = `Generated: ${opts.generatedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`;
  const dw = ctx.regular.widthOfTextAtSize(dateStr, FONT_SIZE_SMALL);
  page.drawText(dateStr, { x: cx - dw / 2, y: sy, size: FONT_SIZE_SMALL, font: ctx.regular, color: rgb(0.5, 0.5, 0.5) });

  // Confidentiality note
  const conf = "CONFIDENTIAL — Commercial-in-confidence. Not for redistribution.";
  const cfw = ctx.italic.widthOfTextAtSize(conf, FONT_SIZE_SMALL);
  page.drawText(conf, { x: cx - cfw / 2, y: PAGE_MARGIN + 20, size: FONT_SIZE_SMALL, font: ctx.italic, color: rgb(0.55, 0.55, 0.55) });

  // Footer line
  page.drawLine({ start: { x: PAGE_MARGIN, y: PAGE_MARGIN + 15 }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_MARGIN + 15 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
}

function addPageNumber(ctx: RenderContext): void {
  for (let i = 1; i < ctx.pages.length; i++) {
    const page = ctx.pages[i];
    const num = `Page ${i} of ${ctx.pages.length - 1}`;
    const nw = ctx.regular.widthOfTextAtSize(num, FONT_SIZE_SMALL);
    page.drawText(num, { x: PAGE_WIDTH - PAGE_MARGIN - nw, y: PAGE_MARGIN - 10, size: FONT_SIZE_SMALL, font: ctx.regular, color: rgb(0.55, 0.55, 0.55) });
    page.drawLine({ start: { x: PAGE_MARGIN, y: PAGE_MARGIN }, end: { x: PAGE_WIDTH - PAGE_MARGIN, y: PAGE_MARGIN }, thickness: 0.4, color: rgb(0.8, 0.8, 0.8) });
  }
}

export async function generateProposalPdf(opts: {
  title: string;
  clientName?: string | null;
  reference?: string | null;
  markdown: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const [bold, regular, italic] = await Promise.all([
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);

  // Cover page (page 0 — not numbered)
  const coverPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const ctx: RenderContext = { doc, bold, regular, italic, pages: [coverPage], y: PAGE_HEIGHT - PAGE_MARGIN };
  await buildCoverPage(ctx, { title: opts.title, clientName: opts.clientName, reference: opts.reference, generatedAt: new Date() });

  // Content pages start here
  addPage(ctx);
  ctx.y = PAGE_HEIGHT - PAGE_MARGIN;

  const tokens = parseMarkdownLines(opts.markdown);
  let prevType: string | null = null;

  for (const tok of tokens) {
    if (tok.type === "blank") {
      ctx.y -= PARAGRAPH_GAP;
      continue;
    }
    if (tok.type === "h1") {
      if (prevType && prevType !== "blank") ctx.y -= SECTION_GAP;
      ensureSpace(ctx, LINE_HEIGHT_H1 + 4);
      drawHRule(ctx, [0.1, 0.18, 0.36]);
      drawText(ctx, tok.text, { font: bold, size: FONT_SIZE_H1, lineHeight: LINE_HEIGHT_H1 });
      ctx.y -= 4;
    } else if (tok.type === "h2") {
      if (prevType && prevType !== "blank") ctx.y -= PARAGRAPH_GAP * 2;
      drawText(ctx, tok.text, { font: bold, size: FONT_SIZE_H2, lineHeight: LINE_HEIGHT_H2, color: [0.1, 0.18, 0.36] });
      ctx.y -= 2;
    } else if (tok.type === "h3") {
      if (prevType && prevType !== "blank") ctx.y -= PARAGRAPH_GAP;
      drawText(ctx, tok.text, { font: bold, size: FONT_SIZE_H3, lineHeight: LINE_HEIGHT_H3 });
    } else if (tok.type === "bullet") {
      drawText(ctx, `•  ${tok.text}`, { font: regular, size: FONT_SIZE_BODY, lineHeight: LINE_HEIGHT_BODY, indent: 12 });
    } else {
      drawText(ctx, tok.text, { font: regular, size: FONT_SIZE_BODY, lineHeight: LINE_HEIGHT_BODY });
    }
    prevType = tok.type;
  }

  addPageNumber(ctx);
  return doc.save();
}
