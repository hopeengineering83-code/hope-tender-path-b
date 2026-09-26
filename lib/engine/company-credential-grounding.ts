// A model-written section may state a company credential only when the
// firm's own record states it.
//
// Run 36049851073 kept a model-written Section A that opened: "founded in
// 2012 and operates under a Grade A professional engineering licence issued by
// the Ethiopian Ministry of Urban Development ... Certifications include ISO
// 9001 (quality), ISO 45001 (occupational health & safety), and ISO 14001".
// The firm's record says "Date of establishment: 05 November 2019", "Category 1
// (Grade I), Ethiopian Construction Authority", and holds no ISO 45001 or
// 14001 certificate. Every other client-safety rule passed it, because each is
// a phrase list of bad wording and these are well-worded falsehoods.
//
// Credentials are the one kind of fact an evaluator checks against a
// certificate, so they are checked here against the text the writer was
// given: a sentence naming an ISO standard, a licence grade or a founding year
// that the record does not hold is removed. Only those three shapes are
// tested; a sentence is never rewritten.

export interface CredentialScrubResult {
  markdown: string;
  removed: string[];
}

const ISO_NUMBER = /\bISO\s*(\d{4,5})\b/gi;
const GRADE = /\bGrade[-\s]+(I{1,3}|IV|V|[A-D]|\d)\b/gi;
const FOUNDING = /\b(?:founded|established|incorporated)\s+(?:in\s+)?((?:19|20)\d{2})\b/gi;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The first credential in `sentence` that `grounding` does not state, or null. */
export function ungroundedCredential(sentence: string, grounding: string): string | null {
  for (const match of sentence.matchAll(ISO_NUMBER)) {
    if (!new RegExp(`\\bISO\\s*${match[1]}\\b`, "i").test(grounding)) return `ISO ${match[1]}`;
  }
  for (const match of sentence.matchAll(GRADE)) {
    if (!new RegExp(`\\bGrade[-\\s]*${escapeRegex(match[1])}\\b`, "i").test(grounding)) return `Grade ${match[1]}`;
  }
  for (const match of sentence.matchAll(FOUNDING)) {
    const year = match[1];
    const stated = new RegExp(`(?:found|establish|incorporat|since)[^\\n]{0,80}\\b${year}\\b`, "i").test(grounding);
    if (!stated) return `founded ${year}`;
  }
  return null;
}

// Sentence boundaries inside a prose line. A list item or table row is one
// unit: removing part of a row would misalign its cells.
function sentencesOf(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

export function scrubUngroundedCompanyCredentials(markdown: string, grounding: string): CredentialScrubResult {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^\s*#/.test(line) || !line.trim()) {
      out.push(line);
      continue;
    }
    if (/^\s*(?:\||[-*•]\s|\d+[.)]\s)/.test(line)) {
      const bad = ungroundedCredential(line, grounding);
      if (bad) removed.push(`${bad}: ${line.trim().slice(0, 140)}`);
      else out.push(line);
      continue;
    }
    const sentences = sentencesOf(line);
    const kept: string[] = [];
    for (const sentence of sentences) {
      const bad = ungroundedCredential(sentence, grounding);
      if (bad) removed.push(`${bad}: ${sentence.trim().slice(0, 140)}`);
      else kept.push(sentence);
    }
    if (kept.length === sentences.length) {
      out.push(line);
      continue;
    }
    const rebuilt = kept.join(" ").trim();
    if (rebuilt) out.push(rebuilt);
  }
  return { markdown: out.join("\n"), removed };
}
