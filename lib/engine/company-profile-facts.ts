// The firm's corporate facts as its own profile states them.
//
// A company profile summary commonly ends with "Label | Value" rows — legal
// name, category or grade, date of establishment, head office, branches,
// general manager, identifiers. A.1 of run 36074770709 used none of them: the
// summary opened with drafting notes for AI tools, so the whole text was
// refused and A.1 said only that the firm "is a professional consultancy
// operating in the Healthcare / Medical Facility Design sector" — the
// tender's sector, not the firm's — and that it "delivers end-to-end
// technical consultancy services ... combining sector-specialist expertise
// with evidence-anchored project delivery".
//
// The rows are the firm's own statements, so they are printed as the firm
// states them. Only the first document's rows are read (later digests in the
// same text restate or annotate them), a row whose label or value reads as a
// note about the document itself is skipped, and nothing is inferred.

export interface CorporateFact {
  label: string;
  value: string;
}

const NOTE_LABEL = /\b(?:note|cover|summary|purpose|instruction|caution|disclaimer|ai|prompt|records?\s+(?:appear|seen))\b/i;
const NOTE_VALUE = /\b(?:AI|prompt|summari[sz]ed|this\s+(?:document|summary)|should\s+(?:be|assume)|appear\s+in\s+several|for\s+simplicity)\b/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function corporateFactsFromProfile(summary: string | null | undefined): CorporateFact[] {
  const text = String(summary ?? "");
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  // The first document ends where its title line repeats.
  const title = lines.find((l) => l.length > 0) ?? "";
  const nextDoc = lines.findIndex((l, i) => i > 0 && l === title);
  const firstDoc = nextDoc > 0 ? lines.slice(0, nextDoc) : lines;

  const facts: CorporateFact[] = [];
  const seen = new Set<string>();
  for (const line of firstDoc) {
    const m = line.match(/^([A-Za-z][A-Za-z /&()'-]{2,40}?)\s*\|\s*(.+)$/);
    if (!m) continue;
    const label = clean(m[1]);
    const value = clean(m[2].split(/\s*\|\s*/).join("; "));
    if (!value || value.length > 220 || NOTE_LABEL.test(label) || NOTE_VALUE.test(value)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ label: label.charAt(0).toUpperCase() + label.slice(1), value });
  }
  return facts.slice(0, 12);
}
