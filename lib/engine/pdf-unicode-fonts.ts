import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StandardFonts, type PDFDocument, type PDFFont } from "pdf-lib";

/**
 * Fonts that can render what a tender actually contains.
 *
 * The renderer embedded only the three standard Helvetica faces. Those are
 * WinAnsi-encoded, which covers Latin-1 and nothing else, so the first
 * Ethiopic character in a real Ethiopian tender ended the whole export:
 *
 *   pdf-finalizer: WinAnsi cannot encode "ጊ" (0x130a)
 *   → PDF_GENERATION_FAILED → AUTO_FINALIZE_NOT_CONVERGED → ZIP 409
 *
 * A submission package for an Ethiopian procuring entity could therefore never
 * be produced, and the tender stopped one step from a ZIP.
 *
 * Stripping, transliterating or substituting the character is not a fix. The
 * client's name is not decoration; a proposal that silently drops it is wrong
 * in a way an evaluator will see, and inventing "?" where a source said "ጊዜ"
 * is the same defect class as any other value this application must never make
 * up. The renderer has to be able to draw the text.
 *
 * Two faces of Noto Sans Ethiopic are embedded for that. They cover Ethiopic
 * AND Latin — every glyph in the probe set, punctuation, currency and curly
 * quotes included — so a mixed string like "Hope Engineering — ጊዜ" renders in
 * one font, in one draw call, with correct metrics. Nothing is split mid-word
 * and no layout code has to know about scripts.
 *
 * Helvetica is still used for text WinAnsi can encode, which is almost every
 * document. That keeps existing output byte-comparable, keeps the standard
 * metrics the layout was tuned against, and means the 367 KB face is only
 * embedded in the PDFs that actually need it.
 */

/** Bundled faces, kept beside the repository rather than in node_modules. */
const FONT_FILES = {
  regular: "NotoSansEthiopic-Regular.ttf",
  bold: "NotoSansEthiopic-Bold.ttf",
} as const;

/**
 * Read a bundled face.
 *
 * The path is resolved from the project root and the directory is named in
 * next.config.js `outputFileTracingIncludes`, because serverless tracing does
 * not follow a runtime `readFileSync` on its own — and a font that traces
 * locally but is absent on the deployment would reintroduce exactly the
 * failure this module exists to remove, in the one environment that matters.
 */
function readBundledFont(file: string): Buffer {
  return readFileSync(join(process.cwd(), "assets", "fonts", file));
}

/**
 * WinAnsi covers U+0000–U+00FF plus a small set of typographic characters that
 * pdf-lib maps into the 0x80–0x9F range. Anything else needs the embedded
 * face.
 *
 * Deliberately a positive test of what the standard font CAN encode rather
 * than a list of scripts it cannot: a list would need extending for every new
 * script a tender arrives in, and the failure mode of forgetting one is a
 * dead export rather than a slightly wrong font.
 */
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function isWinAnsiEncodable(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if (code <= 0xff) continue;
    if (WIN_ANSI_EXTRA.has(code)) continue;
    return false;
  }
  return true;
}

export type PdfFontStyle = "regular" | "bold" | "italic";

export type PdfFontSet = {
  /**
   * The face to draw this exact text with.
   *
   * Callers pass the string they are about to draw or measure, so the same
   * decision is made in both places and a line can never be measured with one
   * face and drawn with another.
   */
  fontFor(text: string, style?: PdfFontStyle): PDFFont;
  /** Width of `text` at `size`, measured with the face that will draw it. */
  widthOf(text: string, size: number, style?: PdfFontStyle): number;
  /** True once a non-WinAnsi face has actually been embedded in the document. */
  readonly unicodeFallbackUsed: boolean;
};

function buildFontSet(
  standard: { regular: PDFFont; bold: PDFFont; italic: PDFFont },
  unicode: { regular: PDFFont; bold: PDFFont } | null,
): PdfFontSet {
  const pick = (text: string, style: PdfFontStyle): PDFFont => {
    if (unicode && !isWinAnsiEncodable(text)) {
      // Ethiopic has no italic tradition and the face ships none, so italic
      // resolves to regular rather than to a synthesised slant.
      return style === "bold" ? unicode.bold : unicode.regular;
    }
    if (style === "bold") return standard.bold;
    if (style === "italic") return standard.italic;
    return standard.regular;
  };

  return {
    fontFor: (text, style = "regular") => pick(text, style),
    widthOf: (text, size, style = "regular") => pick(text, style).widthOfTextAtSize(text, size),
    get unicodeFallbackUsed() {
      return unicode !== null;
    },
  };
}

/**
 * Build the font set for a document whose full text is already known.
 *
 * The Unicode faces are embedded only when that text needs them, so an
 * ordinary Latin proposal carries no extra 367 KB and its bytes are unchanged.
 */
export async function createPdfFontSetFor(doc: PDFDocument, fullText: string): Promise<PdfFontSet> {
  const [regular, bold, italic] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ]);

  if (isWinAnsiEncodable(fullText)) {
    return buildFontSet({ regular, bold, italic }, null);
  }

  const imported = require("@pdf-lib/fontkit");
  doc.registerFontkit(imported.default ?? imported);
  const [unicodeRegular, unicodeBold] = await Promise.all([
    doc.embedFont(readBundledFont(FONT_FILES.regular), { subset: true }),
    doc.embedFont(readBundledFont(FONT_FILES.bold), { subset: true }),
  ]);
  return buildFontSet({ regular, bold, italic }, { regular: unicodeRegular, bold: unicodeBold });
}
