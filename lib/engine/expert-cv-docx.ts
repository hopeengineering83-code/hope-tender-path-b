import { safeParseJsonArray } from "../safe-json";
// Expert CV DOCX generator.
//
// Produces a professional one-to-two-page Word document for each selected
// expert in the firm's vault. CVs are generated alongside the main Technical
// Proposal and saved as separate GeneratedDocument records with
// documentType="EXPERT_CV_PACKAGE". Most formal tender submissions require
// individual CVs as appendices (Appendix C or similar) with a standard layout.
//
// Each CV covers:
//   • Name, title, years of experience
//   • Contact details (email/phone — omit if absent)
//   • Professional disciplines and sector experience
//   • Certifications / professional memberships
//   • Profile narrative (from expert.profile field)
//
// The layout mirrors the standard World Bank / FIDIC CV template:
//   header block (name, title, experience) → two-column skills tables →
//   profile narrative → certifications list.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

const BRAND_BLUE = "1F4E79";
const LIGHT_BLUE = "D9EAF7";
const GRAY = "595959";

function safeArr(json: string | null | undefined): string[] {
  if (!json) return [];
  return safeParseJsonArray<string>(json).filter((s): s is string => typeof s === "string" && s.trim().length > 0).map(stripForbiddenTraces);
}

// ─── Forbidden-trace sanitizer (CV-DOCX export-blocker fix) ───────────────────
// The export validator (app/api/tenders/[id]/download/route.ts) refuses to
// ship any DOCX that contains markers like "==PAGE 5==", "PARSED TEXT FOR
// PAGE", "AI_DRAFT", "remove before submission", "[INSERT NAME]", etc. These
// markers come from PDF extraction headers in the source CV files and from
// AI prep notes embedded in the user's company profile / expert profile
// fields.
//
// Before this fix, every Expert CV the engine generated carried the source
// PDF's "==PAGE N==" page-number markers verbatim into the output Word
// document — which then failed final validation, blocking the entire ZIP
// export. We now strip the same set of patterns the validator looks for
// PRIOR to rendering, so the generated CV cannot trip the gate.
//
// This list is a pre-render sanitizer, not the authority. The authoritative
// detector is AI_TRACE_PATTERNS / PLACEHOLDER_PATTERNS in
// lib/engine/detection-patterns.ts, enforced at export time by
// validateGeneratedDocumentQuality() via checkFullExportReadiness(), which
// extracts the DOCX visible text and fails the export closed. Anything this
// sanitizer misses is therefore blocked rather than shipped — keep it broad
// enough that a legitimately generated CV never trips that gate.
const FORBIDDEN_TRACE_PATTERNS: RegExp[] = [
  /=+\s*PAGE\s+\d+\s*=+/gi,
  /PARSED TEXT FOR PAGE[^\n]*/gi,
  /<PARSED TEXT FOR PAGE:[^>]+>/gi,
  /\[(?:PDF text|OCR text)[^\]]*\]/gi,
  /\bAI_DRAFT\b/gi,
  /\bREGEX_DRAFT\b/gi,
  /remove before submission/gi,
  /sample text/gi,
  /lorem ipsum/gi,
  /as an AI/gi,
  // "As an AI language model, ..." — /as an AI/ alone removes only the
  // prefix and leaves "language model, ..." rendered in the CV. The sibling
  // sanitizers (lib/engine/export-gap-repair.ts and
  // app/api/tenders/[id]/repair-export-gaps/route.ts) already strip
  // "language model" for exactly this reason, and AI_TRACE_PATTERNS in
  // lib/engine/detection-patterns.ts detects "as a language model", so the
  // export quality gate rejects any CV that still carries it.
  /as a language model/gi,
  /\blanguage model\b/gi,
  /AI-generated/gi,
  /source snippet/gi,
  /deterministic safety import/gi,
  /Company evidence available:/gi,
  /Project evidence available:/gi,
  /\[\s*(?:INSERT|TBD|TBA|TODO|FILL[-_\s]*IN|PLACEHOLDER|YOUR\s+\w+\s+HERE|DATE|NAME|CLIENT|VALUE|AMOUNT)\b[^\]]*\]/gi,
];

export function stripForbiddenTraces(text: string | null | undefined): string {
  if (!text) return "";
  let out = String(text);
  for (const p of FORBIDDEN_TRACE_PATTERNS) out = out.replace(p, " ");
  // Collapse run-on whitespace produced by the substitutions.
  return out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function para(text: string, opts?: { bold?: boolean; size?: number; color?: string; italic?: boolean; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] }): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts?.bold, size: opts?.size ?? 22, color: opts?.color ?? "222222", italics: opts?.italic, font: "Calibri" })],
    alignment: opts?.alignment,
    spacing: { after: 80, line: 260 },
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    border: { bottom: { color: LIGHT_BLUE, space: 1, style: BorderStyle.SINGLE, size: 6 } },
  });
}

function twoColTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TableBorders.NONE,
    rows: rows.map(([label, value]) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3200, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: "Calibri", color: BRAND_BLUE })], spacing: { after: 60 } })],
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
          }),
          new TableCell({
            width: { size: 5400, type: WidthType.DXA },
            children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: "Calibri", color: "222222" })], spacing: { after: 60 } })],
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
          }),
        ],
      })
    ),
  });
}

function bulletListParagraphs(items: string[]): Paragraph[] {
  return items.map((item) =>
    new Paragraph({
      children: [new TextRun({ text: item.trim(), size: 20, font: "Calibri" })],
      bullet: { level: 0 },
      spacing: { after: 60, line: 260 },
    })
  );
}

export type ExpertCvInput = {
  fullName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  yearsExperience?: number | null;
  disciplines?: string | null;   // JSON array
  sectors?: string | null;       // JSON array
  certifications?: string | null; // JSON array
  profile?: string | null;
};

export async function generateExpertCvDocx(expert: ExpertCvInput): Promise<Buffer> {
  // ── Sanitize every input field BEFORE rendering ────────────────────────
  // Strips forbidden-output traces (PDF page markers, AI prep notes, draft
  // labels) that would otherwise cause the export validator to reject the
  // generated DOCX. Mirrors the validator's pattern list exactly.
  const fullName = stripForbiddenTraces(expert.fullName) || "Proposed Expert";
  const title = expert.title ? stripForbiddenTraces(expert.title) : null;
  const email = expert.email ? stripForbiddenTraces(expert.email) : null;
  const phone = expert.phone ? stripForbiddenTraces(expert.phone) : null;
  const profileSan = expert.profile ? stripForbiddenTraces(expert.profile) : null;

  const disciplines = safeArr(expert.disciplines);
  const sectors = safeArr(expert.sectors);
  const certs = safeArr(expert.certifications);

  // ── Header block ────────────────────────────────────────────────────────
  const headerRows: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: fullName, bold: true, size: 36, color: BRAND_BLUE, font: "Calibri" })],
      spacing: { after: 60 },
    }),
  ];
  if (title) {
    headerRows.push(new Paragraph({
      children: [new TextRun({ text: title, size: 24, color: GRAY, font: "Calibri", italics: true })],
      spacing: { after: 40 },
    }));
  }
  const contactParts: string[] = [];
  if (email) contactParts.push(email);
  if (phone) contactParts.push(phone);
  if (contactParts.length > 0) {
    headerRows.push(para(contactParts.join("  |  "), { color: GRAY, size: 20 }));
  }
  if (expert.yearsExperience) {
    headerRows.push(para(`${expert.yearsExperience} years of professional experience`, { bold: true, size: 20 }));
  }
  headerRows.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 100 } }));

  // ── Professional summary table ────────────────────────────────────────
  const summaryRows: [string, string][] = [];
  if (expert.yearsExperience) summaryRows.push(["Experience", `${expert.yearsExperience} years`]);
  if (disciplines.length > 0) summaryRows.push(["Disciplines", disciplines.join(", ")]);
  if (sectors.length > 0) summaryRows.push(["Sectors", sectors.join(", ")]);

  const children: (Paragraph | Table)[] = [
    ...headerRows,
  ];

  if (summaryRows.length > 0) {
    children.push(sectionHeading("Professional Summary"));
    children.push(twoColTable(summaryRows));
    children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
  }

  // ── Profile narrative ────────────────────────────────────────────────
  if (profileSan && profileSan.trim().length > 0) {
    children.push(sectionHeading("Profile"));
    const profileParas = profileSan.trim().split(/\n{2,}/).filter((p) => p.trim().length > 0);
    for (const profilePara of profileParas) {
      children.push(para(profilePara.trim(), { size: 20 }));
    }
    children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
  }

  // ── Disciplines ──────────────────────────────────────────────────────
  if (disciplines.length > 0) {
    children.push(sectionHeading("Areas of Expertise"));
    children.push(...bulletListParagraphs(disciplines));
    children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
  }

  // ── Sectors ─────────────────────────────────────────────────────────
  if (sectors.length > 0) {
    children.push(sectionHeading("Sector Experience"));
    children.push(...bulletListParagraphs(sectors));
    children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
  }

  // ── Certifications ──────────────────────────────────────────────────
  if (certs.length > 0) {
    children.push(sectionHeading("Certifications & Professional Memberships"));
    children.push(...bulletListParagraphs(certs));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// Sanitize expert name for use as a filename.
export function expertCvFileName(fullName: string): string {
  return `CV-${fullName.trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 60)}.docx`;
}
