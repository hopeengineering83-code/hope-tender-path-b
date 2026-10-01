/**
 * Stop the same reviewed record being re-introduced over and over locally.
 *
 * THE DELIVERED DEFECT
 * --------------------
 * Several generators each append their own full proof sentence, and none of
 * them can see what the others just wrote. A submitted proposal's A.1 Company
 * Overview therefore cited one project four times inside ten lines, through
 * four different sentence templates:
 *
 *   "The same approach was applied on G+6 General Hospital – Dr Abdul Seid …"
 *   "Relevant lessons recorded for G+6 General Hospital – Dr Abdul Seid …"
 *   "G+6 General Hospital – Dr Abdul Seid … demonstrates the firm's prior …"
 *   "Comparable scope was completed on G+6 General Hospital – Dr Abdul Seid …"
 *
 * Template variety made it worse, not better: the reader sees the same fact
 * restated four ways and correctly reads it as padding.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a global "mention each project once" rule. A reviewed project legitimately
 * appears in the portfolio, in the team-to-project mapping and in the compliance
 * matrix, and required compliance references may repeat wherever the tender
 * demands them. What is being controlled is the *local re-introduction* of the
 * same record as fresh proof within a short span of prose.
 */


/**
 * Fold text the same way record names are folded — lower-case, punctuation
 * collapsed to single spaces — while keeping a map back to the original offset
 * of each folded character, so a match can still report where it really was.
 */
function foldWithOffsets(text: string): { folded: string; offsets: number[] } {
  let folded = "";
  const offsets: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i].toLowerCase();
    if (ch >= "a" && ch <= "z") {
      folded += ch;
      offsets.push(i);
      lastWasSpace = false;
    } else if (ch >= "0" && ch <= "9") {
      folded += ch;
      offsets.push(i);
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      folded += " ";
      offsets.push(i);
      lastWasSpace = true;
    }
  }
  return { folded, offsets };
}

/** Roughly a page of prose. Re-introducing inside this window reads as padding. */
export const DEFAULT_REPETITION_WINDOW_CHARS = 2_500;

function normalizeRecordKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(" ");
}

/**
 * Tracks where each reviewed record was last introduced, in character offsets
 * through the document, and refuses a re-introduction that lands too close to
 * the previous one.
 */
export class EvidenceRepetitionWindow {
  private readonly lastPosition = new Map<string, number>();

  constructor(private readonly windowChars: number = DEFAULT_REPETITION_WINDOW_CHARS) {}

  /** May this record be introduced as fresh proof at this offset? */
  canIntroduce(recordName: string | null | undefined, position: number): boolean {
    const key = normalizeRecordKey(recordName ?? "");
    if (!key) return false;
    const previous = this.lastPosition.get(key);
    if (previous === undefined) return true;
    return position - previous >= this.windowChars;
  }

  /** Record that this record was introduced at this offset. */
  record(recordName: string | null | undefined, position: number): void {
    const key = normalizeRecordKey(recordName ?? "");
    if (!key) return;
    this.lastPosition.set(key, position);
  }

  /**
   * Seed the window from text already written, so a pass that runs after
   * another generator does not re-introduce what that generator just cited.
   */
  seedFromMarkdown(markdown: string, recordNames: Array<string | null | undefined>): void {
    // Both sides are folded the same way before comparing. A project stored as
    // "G+6 General Hospital – Dr Abdul Seid" contains punctuation the key drops,
    // so searching the raw text for the folded key finds nothing.
    const { folded, offsets } = foldWithOffsets(markdown);
    for (const name of recordNames) {
      const key = normalizeRecordKey(name ?? "");
      if (!key) continue;
      const probe = key.split(" ").slice(0, 3).join(" ");
      if (probe.length < 6) continue;
      const idx = folded.lastIndexOf(probe);
      if (idx >= 0) this.lastPosition.set(key, offsets[idx] ?? idx);
    }
  }
}

/**
 * Does this span of prose already carry a citation for one of these records?
 *
 * Used to leave a section alone when it is already evidenced, rather than
 * stacking another generator's proof sentence on top.
 */
export function spanAlreadyCites(span: string, recordNames: Array<string | null | undefined>): boolean {
  const haystack = foldWithOffsets(span).folded;
  for (const name of recordNames) {
    const key = normalizeRecordKey(name ?? "");
    if (!key) continue;
    const probe = key.split(" ").slice(0, 3).join(" ");
    if (probe.length >= 6 && haystack.includes(probe)) return true;
  }
  return false;
}
