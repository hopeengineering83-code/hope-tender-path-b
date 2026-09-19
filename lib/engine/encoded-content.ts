// One predicate for "is this value encoded bytes rather than something a
// person wrote?"
//
// WHY THIS EXISTS
// ───────────────
// Three places needed the same answer and each carried its own version:
//
//   lib/engine/document-quality-validator.ts  — a strict anchored base64 test
//   lib/engine/export-readiness.ts            — documentHygieneIssues
//   lib/engine/export-readiness.ts            — checkDocumentQualityGate
//
// The validator's version was right. The two in export-readiness did not
// exist at all: they relied on `looksLikePlainText`, which asks "is this
// printable ASCII with letters in it" — and base64 passes that perfectly,
// being 100% printable and almost all letters.
//
// So the placeholder, AI-trace and pricing patterns were run over the raw
// base64 of PDFs and DOCX files. A match there means nothing about the
// document, but it can still happen: roughly one run in fifteen the encoded
// bytes of a generated PDF contained
//
//     ...aXNnX/tBd/SsHxR2aG...
//
// where `/` acts as a word boundary on both sides, so the case-insensitive
// /\b(TODO|TBD|FIXME|PLACEHOLDER)\b/ matched "tBd" and a perfectly clean
// Technical-Proposal.pdf was refused export with "Placeholder or unresolved
// drafting instruction is present". "todo", "prompt", "claude" and "gemini"
// can fire the same way. The owner saw a randomly-appearing blocker naming a
// defect that was not in the document, and it made
// tests/owner-workflow-complete-postgres.test.ts fail intermittently in CI
// for months without ever being named.
//
// WHY EXCLUDING IT WEAKENS NOTHING
// ────────────────────────────────
// A pattern hit inside encoded bytes carries no information about the text of
// the document, so removing it removes only false positives. The real content
// is still checked: checkDocxHygieneReadiness extracts and scans DOCX visible
// text, and a finalized PDF is rendered from a DOCX that has already passed
// that check.

/**
 * True when the value is a base64-encoded payload rather than prose.
 *
 * Prose is separated by whitespace and carries punctuation the base64
 * alphabet does not contain. A long, unbroken run of [A-Za-z0-9+/=] with
 * essentially no whitespace is encoded bytes.
 *
 * The 64-character floor matters: a terse line of real text ("TBD") must
 * still be scanned, so the exclusion only applies once the run is long enough
 * that no one typed it.
 */
export function looksLikeEncodedBytes(value: string | null | undefined): boolean {
  if (!value) return false;
  const sample = value.slice(0, 4096);
  if (sample.length < 64) return false;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(sample)) return false;
  const whitespace = (sample.match(/\s/g) ?? []).length;
  return whitespace / sample.length <= 0.02;
}
