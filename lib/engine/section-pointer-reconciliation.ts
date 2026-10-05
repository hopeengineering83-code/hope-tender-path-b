// Every "where is this answered" pointer names a section the document has,
// and Section F agrees with Section E about the same requirement.
//
// The pointers are written before the document's final order is known, from
// fixed labels: "Section B.2 Project Portfolio", "Section C.5 Risk Register",
// "Section D Professional Certifications and Affiliations". A delivered EOI
// (2026-10-05) pointed its tower-experience row at a B.2 the document did not
// contain, pointed its audited-statements row at "Section D" where the heading
// was D.4, and its Section F rated the same tower-experience requirement
// "DIRECT" beside Section E's "PARTIALLY MET" — and three declarations
// "PARTIAL" beside E's "FULLY MET". An evaluator who follows a pointer, or
// reads the two tables side by side, finds the proposal contradicting itself.
//
// This pass runs on the final markdown, after the contents page is sealed:
//  1. a pointer is matched to a real heading by its title words and rewritten
//     with that heading's number and title; one that matches nothing is
//     dropped, and a cell left with no pointer says so;
//  2. a Section F row whose criterion is a Section E requirement takes E's
//     location and E's status, so the two tables cannot disagree.
// It only rewrites the location and strength columns of those two tables, and
// "(see Section X)" references the document cannot satisfy. It runs after
// document-structure-seal.ts, which renumbers a pointer whose title is a
// heading; this pass covers what the seal leaves by design — a pointer into a
// section the document does not contain at all, a letter-only pointer
// ("Section D Professional Certifications …"), a title that differs in its
// wording — and the agreement between Sections E and F.

type Heading = { code: string | null; title: string; words: Set<string> };

const STOPWORDS = new Set(["the", "and", "for", "of", "to", "in", "on", "a", "an", "this", "with", "by", "section", "proposal", "its"]);
const NOT_PRESENTED = "Not presented in this proposal";

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function collectHeadings(lines: readonly string[]): Heading[] {
  const headings: Heading[] = [];
  for (const line of lines) {
    const m = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (!m) continue;
    const text = m[1]!.replace(/\*\*/g, "").trim();
    const coded = text.match(/^(?:section\s+)?([A-H](?:\.\d+)*)(?:[.:)]|\s*[—–-])?\s+(.+)$/i);
    const code = coded ? coded[1]!.toUpperCase() : null;
    const title = coded ? coded[2]!.replace(/^[:—–-]\s*/, "").trim() : text;
    headings.push({ code, title, words: new Set(words(title)) });
  }
  return headings;
}

function titleCase(heading: Heading): string {
  // Keep the heading's own capitalisation unless it is shouted.
  const t = heading.title;
  if (t === t.toUpperCase() && /[A-Z]{4,}/.test(t)) {
    return t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return t;
}

function resolveOne(code: string, title: string, headings: readonly Heading[]): Heading | null {
  const wanted = words(title);
  if (wanted.length === 0) {
    return headings.find((h) => h.code === code.toUpperCase()) ?? null;
  }
  let best: Heading | null = null;
  let bestScore = 0;
  for (const h of headings) {
    if (!h.code) continue;
    const hit = wanted.filter((w) => h.words.has(w)).length;
    let score = hit / wanted.length;
    if (h.code === code.toUpperCase()) score += 0.01;
    if (score > bestScore) { best = h; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}

const POINTER = /(?:Sections?\s+)?\b([A-H](?:\.\d+)*)\s+([A-Z][^+]*?)(?=\s*(?:\+|\band\s+(?:Section\s+)?[A-H](?:\.\d+)*\s+[A-Z]|$))/g;

/** Rewrite one location cell against the document's real headings. */
export function resolveLocationCell(cell: string, headings: readonly Heading[]): string {
  const trimmed = cell.trim();
  if (!/\bSections?\s+[A-H]\b|^\s*[A-H]\.\d/.test(trimmed)) return cell;
  if (/^Sections?\s+[A-H]\s*[–-]\s*[A-H]\b/.test(trimmed)) return cell; // "Sections A–D" is a range, not a pointer
  const resolved: string[] = [];
  const extras: string[] = [];
  const consumed: Array<[number, number]> = [];
  for (const m of trimmed.matchAll(POINTER)) {
    consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    const target = resolveOne(m[1]!, m[2]!, headings);
    if (!target?.code) continue;
    const label = `Section ${target.code} ${titleCase(target)}`;
    if (!resolved.includes(label)) resolved.push(label);
  }
  if (consumed.length === 0) return cell;
  // Keep non-pointer parts ("cover letter submission confirmation",
  // "Compliance Matrix") except an appendix the document does not contain.
  let rest = trimmed;
  for (const [start, end] of [...consumed].reverse()) rest = `${rest.slice(0, start)}${rest.slice(end)}`;
  for (const part of rest.split(/\s*\+\s*|\s+and\s+/)) {
    const p = part.trim();
    if (!p || /^(?:and|\+)$/i.test(p)) continue;
    if (/^Appendix\b/i.test(p) && !headings.some((h) => /appendix/i.test(h.title))) continue;
    extras.push(p);
  }
  const all = [...resolved, ...extras];
  return all.length > 0 ? all.join(" + ") : NOT_PRESENTED;
}

type Table = { start: number; header: string[]; rows: Array<{ index: number; cells: string[] }> };

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function joinRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function collectTables(lines: readonly string[]): Table[] {
  const tables: Table[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]!) || !/^\s*\|\s*:?-{2,}/.test(lines[i + 1]!)) continue;
    const table: Table = { start: i, header: splitRow(lines[i]!), rows: [] };
    let j = i + 2;
    while (j < lines.length && /^\s*\|/.test(lines[j]!)) {
      table.rows.push({ index: j, cells: splitRow(lines[j]!) });
      j++;
    }
    tables.push(table);
    i = j - 1;
  }
  return tables;
}

function requirementKey(text: string): string {
  return text
    .split(/\s+[—–]\s+/)[0]!
    .replace(/\[p\.\s*\d+[^\]]*\]/gi, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function strengthFromStatus(status: string): string | null {
  if (/fully\s+met/i.test(status)) return "Full";
  if (/partial/i.test(status)) return "Partial";
  if (/not\s+met/i.test(status)) return "Gap";
  return null;
}

export interface SectionPointerResult {
  readonly markdown: string;
  readonly pointersRewritten: number;
  readonly rowsAlignedToComplianceMatrix: number;
}

export function reconcileSectionPointers(markdown: string): SectionPointerResult {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const headings = collectHeadings(lines);
  const tables = collectTables(lines);
  let pointersRewritten = 0;
  let rowsAlignedToComplianceMatrix = 0;

  const locationColumn = (header: string[]) => header.findIndex((h) => /\bwhere\b/i.test(h) && /address|answer|location/i.test(h));

  // Section E: requirement → (location, status).
  const compliance = new Map<string, { location: string; status: string }>();
  for (const table of tables) {
    const req = table.header.findIndex((h) => /requirement/i.test(h));
    const loc = locationColumn(table.header);
    const status = table.header.findIndex((h) => /compliance\s+status|^status$/i.test(h));
    if (req < 0 || loc < 0 || status < 0) continue;
    for (const row of table.rows) {
      const location = resolveLocationCell(row.cells[loc] ?? "", headings);
      if (location !== row.cells[loc]) {
        row.cells[loc] = location;
        lines[row.index] = joinRow(row.cells);
        pointersRewritten += 1;
      }
      compliance.set(requirementKey(row.cells[req] ?? ""), { location, status: row.cells[status] ?? "" });
    }
  }

  // Every other table with a location column: resolve it; a criterion that
  // is a Section E requirement takes E's location and status.
  for (const table of tables) {
    const loc = locationColumn(table.header);
    if (loc < 0) continue;
    if (table.header.some((h) => /compliance\s+status/i.test(h))) continue;
    const strength = table.header.findIndex((h) => /evidence\s+strength|strength/i.test(h));
    for (const row of table.rows) {
      const before = joinRow(row.cells);
      // A row with fewer cells than its header renders as a broken row.
      while (row.cells.length < table.header.length) row.cells.push("—");
      const fromE = compliance.get(requirementKey(row.cells[0] ?? ""));
      if (fromE) {
        row.cells[loc] = fromE.location;
        const mapped = strengthFromStatus(fromE.status);
        if (strength >= 0 && mapped) row.cells[strength] = mapped;
      } else {
        row.cells[loc] = resolveLocationCell(row.cells[loc] ?? "", headings);
      }
      const after = joinRow(row.cells);
      if (after !== before) {
        lines[row.index] = after;
        if (fromE) rowsAlignedToComplianceMatrix += 1;
        else pointersRewritten += 1;
      }
    }
  }

  // A "#" column counts its rows. A later pass that removes a row (the
  // client-language sweep deletes any line carrying owner instructions) left
  // a delivered Compliance Matrix numbered 1, 3, 4.
  for (const table of tables) {
    if (table.header[0] !== "#") continue;
    let n = 0;
    for (const row of table.rows) {
      if (!/^\d+$/.test(row.cells[0] ?? "")) continue;
      n += 1;
      if (row.cells[0] !== String(n)) {
        row.cells[0] = String(n);
        lines[row.index] = joinRow(row.cells);
        pointersRewritten += 1;
      }
    }
  }

  // "(see Section B.2)" when the document has no B.2.
  const codes = new Set(headings.map((h) => h.code).filter(Boolean) as string[]);
  const text = lines.join("\n").replace(/\s*\((?:see\s+)?Section\s+([A-H](?:\.\d+)*)\)/g, (whole, code: string) => {
    if (codes.has(code.toUpperCase())) return whole;
    pointersRewritten += 1;
    return "";
  });

  return { markdown: text, pointersRewritten, rowsAlignedToComplianceMatrix };
}
