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

// ─── Past-work claims ────────────────────────────────────────────────────────
//
// 2026-09-30, Preview, a telecom-tower EOI: every building project the firm
// holds was correctly excluded as not comparable, and the model-written
// Section A then supplied its own: "The firm's structural engineers have
// routinely performed condition assessments … for telecom and utility towers
// across Ethiopia", and a Team-to-Project table citing "Telecom Tower Audit &
// Strengthening, Addis Ababa (2022)" — a project that exists nowhere in the
// firm's records. Well-worded, so every phrase rule passed it.
//
// The tell is where the words come from. A claim of past work whose subject
// is vocabulary the tender uses and the firm's records never do was
// borrowed from the tender, not recalled from the record.

const PAST_WORK = /\b(?:ha(?:ve|s)\s+(?:\w+ly\s+)?(?:performed|delivered|completed|undertaken|carried\s+out|executed|designed|audited|supervised|assessed|inspected|strengthened|provided|managed|led)|track\s+record|proven\s+experience|extensive\s+experience|previous(?:ly)?\s+(?:delivered|completed|performed)|experience\s+(?:in|with|on)\s)/i;
const EXPERIENCE_TABLE_HEADER = /\b(?:previous|prior|past|comparable)\b/i;
const MIN_WORD = 5;

function stem(word: string): string {
  return word.toLowerCase().replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, "");
}

function vocabulary(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z][a-z-]{3,}/g)) words.add(stem(match[0]));
  return words;
}

/** The first word of a past-work claim the tender uses and the firm's record does not, or null. */
export function borrowedClaimWord(unit: string, record: Set<string>, tender: Set<string>): string | null {
  for (const match of unit.toLowerCase().matchAll(/[a-z][a-z-]{3,}/g)) {
    if (match[0].length < MIN_WORD) continue;
    const word = stem(match[0]);
    if (tender.has(word) && !record.has(word)) return match[0];
  }
  return null;
}

/**
 * Remove past-work claims built from the tender's vocabulary rather than the
 * firm's record: a prose sentence that claims past work, and every row of a
 * table whose header speaks of previous or comparable work. Credentials of the
 * firm that the record states are untouched.
 */
export function scrubUngroundedExperienceClaims(markdown: string, grounding: string, tenderText: string): CredentialScrubResult {
  const record = vocabulary(grounding);
  const tender = vocabulary(tenderText);
  const removed: string[] = [];
  const out: string[] = [];
  const lines = markdown.split("\n");
  let experienceTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isRow = /^\s*\|/.test(line);
    if (!isRow) experienceTable = false;
    if (isRow && !/^\s*\|/.test(lines[i - 1] ?? "")) {
      experienceTable = EXPERIENCE_TABLE_HEADER.test(line);
      out.push(line);
      continue;
    }
    if (isRow) {
      const separator = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
      const borrowed = !separator && (experienceTable || PAST_WORK.test(line)) ? borrowedClaimWord(line, record, tender) : null;
      if (borrowed) removed.push(`${borrowed}: ${line.trim().slice(0, 140)}`);
      else out.push(line);
      continue;
    }
    if (/^\s*#/.test(line) || !line.trim()) {
      out.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => {
      if (!PAST_WORK.test(sentence)) return true;
      const borrowed = borrowedClaimWord(sentence, record, tender);
      if (borrowed) removed.push(`${borrowed}: ${sentence.trim().slice(0, 140)}`);
      return !borrowed;
    });
    if (kept.length === sentences.length) out.push(line);
    else if (kept.join(" ").trim()) out.push(kept.join(" ").trim());
  }
  return { markdown: out.join("\n"), removed };
}

// ─── Whole-section fabrication ───────────────────────────────────────────────
//
// 2026-10-01, Preview, the same telecom-tower EOI with more providers awake:
// the model-written cover letter, executive summary and Section B presented
// "the proposal team Confirmed Telecommunications Tower Audit Project (Client
// and contract value subject to proposal team confirmation)", two "Featured
// Project" cards with no project behind them, and a firm with no comparable
// project at all. The firm's record held no tower project; the engine had
// correctly selected none. A sentence-level scrub cannot rescue a section
// whose argument rests on invented work, so such a section takes its
// deterministic text, which states only what the record holds.

const CONFIRMATION_RESIDUE = /\b(?:subject\s+to\s+(?:the\s+)?(?:proposal|bid)[-\s]team\s+confirmation|(?:proposal|bid)[-\s]team\s+confirm(?:ed|ation)?|to\s+be\s+confirmed|\bTBC\b)/i;
const PROJECT_PRESENTATION = /\b(?:featured\s+project|previous\s+comparable\s+project|comparable\s+(?:projects?|undertakings?|assignments?)|anchors\s+this\s+tender|project\s+references?)\b/i;
// Leading words that make a phrase a description, not a name: "Proposed
// Project", "Each Project", "Overall Project".
const GENERIC_PROJECT_WORDS = /^(?:(?:The|Our|This|That|A|An|Each|Every|Any|Proposed|Overall|Entire|Whole|Current|Future|Subsequent|Previous|Same|Specific|Relevant|Comparable|Similar|Sample|Pilot|Successful|Recent|Total|Typical|Key|Major|Large|Small|Further|New|Main)\s+)+/;
const NAMED_PROJECT = /\b((?:[A-Z][\w&'’-]*\s+){1,8}(?:Project|Programme|Program))\b/g;

/**
 * Why a model-written section must not be kept, or null.
 * `hasSelectedProjects` is whether the engine selected any project for this
 * tender; `grounding` is the firm's record the writer was given.
 */
export function modelSectionFabrication(markdown: string, grounding: string, hasSelectedProjects: boolean): string | null {
  const text = String(markdown ?? "");
  const residue = text.match(CONFIRMATION_RESIDUE);
  if (residue) return `carries a confirmation placeholder ("${residue[0]}")`;
  if (!hasSelectedProjects) {
    const presented = text.match(PROJECT_PRESENTATION);
    if (presented) return `presents project experience ("${presented[0]}") although no project was selected for this tender`;
  }
  const record = grounding.toLowerCase();
  for (const match of text.matchAll(NAMED_PROJECT)) {
    const name = match[1]!.trim().replace(GENERIC_PROJECT_WORDS, "");
    if (name.split(/\s+/).length < 2) continue;
    if (!record.includes(name.toLowerCase())) return `names a project the firm's record does not hold ("${name}")`;
  }
  return null;
}

// A bidder's legal history is the owner's signed declaration, never the
// writer's: "a clean history of non-performing contracts, and a clear
// litigation history", "have not been convicted of professional misconduct".
const LEGAL_HISTORY_ASSERTION = /\b(?:litigation|non-performing|non-performance|debar(?:red|ment)|suspended|sanction(?:ed|s)?|convicted|misconduct|arbitra(?:l|tion)|court\s+(?:case|award|decision)s?)\b/i;
const ASSERTIVE = /\b(?:no|zero|clean|clear|free\s+of|never|not\s+(?:been|under|subject)|without\s+any|have\s+not|has\s+not)\b/i;

/** Remove sentences in which a model asserts the firm's legal history. */
export function scrubLegalHistoryAssertions(markdown: string): CredentialScrubResult {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    if (/^\s*(?:#|\|)/.test(line) || !line.trim()) {
      out.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((sentence) => {
      const assertion = LEGAL_HISTORY_ASSERTION.test(sentence) && ASSERTIVE.test(sentence);
      if (assertion) removed.push(sentence.trim().slice(0, 140));
      return !assertion;
    });
    if (kept.length === sentences.length) out.push(line);
    else if (kept.join(" ").trim()) out.push(kept.join(" ").trim());
  }
  return { markdown: out.join("\n"), removed };
}
