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
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
  } catch {
    return [];
  }
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
  const disciplines = safeArr(expert.disciplines);
  const sectors = safeArr(expert.sectors);
  const certs = safeArr(expert.certifications);

  // ── Header block ────────────────────────────────────────────────────────
  const headerRows: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: expert.fullName, bold: true, size: 36, color: BRAND_BLUE, font: "Calibri" })],
      spacing: { after: 60 },
    }),
  ];
  if (expert.title) {
    headerRows.push(new Paragraph({
      children: [new TextRun({ text: expert.title, size: 24, color: GRAY, font: "Calibri", italics: true })],
      spacing: { after: 40 },
    }));
  }
  const contactParts: string[] = [];
  if (expert.email) contactParts.push(expert.email);
  if (expert.phone) contactParts.push(expert.phone);
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
  if (expert.profile && expert.profile.trim().length > 0) {
    children.push(sectionHeading("Profile"));
    const profileParas = expert.profile.trim().split(/\n{2,}/).filter((p) => p.trim().length > 0);
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
