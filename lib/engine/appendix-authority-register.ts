/**
 * Appendix Authority Register
 *
 * Removes hard-coded assumptions that Appendix A always means CVs or that
 * other letters have universal meanings. Every appendix label, title, and
 * content is derived from the confirmed Build Plan or the proposal's
 * approved appendix plan.
 *
 * For the Pharo acceptance fixture:
 *   - Appendix A: Company Profile and Registration Documents
 *   - Appendix B: Project Testimony Letters and Contracts
 *   - Appendix C: Expert CVs, Credentials and Licences
 *   - Appendix D: Selected Drawings and Photographs
 *   - Appendix E: Company Manuals and Audited Documents
 *
 * Validates every appendix reference in the narrative against the confirmed
 * appendix register. Blocks approval for conflicting labels such as
 * referring to project drawings as Appendix A when the approved register
 * assigns them to Appendix D.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type AppendixEntry = {
  letter: string;
  title: string;
  content: string;
};

export type AppendixRegister = {
  entries: AppendixEntry[];
};

export type AppendixReferenceViolation = {
  type: "conflicting_label" | "unknown_appendix" | "missing_register";
  message: string;
  /** The conflicting label found in the narrative (e.g. "Appendix A"). */
  referencedLabel: string;
  /** What the register says this label should be (if known). */
  expectedTitle: string | null;
  /** The narrative text that contains the violation. */
  excerpt: string;
};

// ─── Default register (Pharo acceptance fixture) ────────────────────────────

export const DEFAULT_APPENDIX_REGISTER: AppendixRegister = {
  entries: [
    { letter: "A", title: "Company Profile and Registration Documents", content: "Certificate of Incorporation, TIN, VAT, Business Licence, Company Profile" },
    { letter: "B", title: "Project Testimony Letters and Contracts", content: "Client reference letters, contract excerpts, completion certificates" },
    { letter: "C", title: "Expert CVs, Credentials and Licences", content: "CVs, academic credentials, professional licences, certifications" },
    { letter: "D", title: "Selected Drawings and Photographs", content: "Architectural drawings, photographs of completed projects" },
    { letter: "E", title: "Company Manuals and Audited Documents", content: "QA/QC manuals, audited financial statements, ISO certificates" },
  ],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get the title for an appendix letter from the register.
 * Returns null if the letter is not in the register.
 */
export function getAppendixTitle(register: AppendixRegister, letter: string): string | null {
  const entry = register.entries.find((e) => e.letter.toUpperCase() === letter.toUpperCase());
  return entry?.title ?? null;
}

/**
 * Find all appendix references in a piece of narrative text.
 * Returns an array of { label, excerpt } pairs.
 *
 * Matches patterns like:
 *   - "Appendix A"
 *   - "Appendix B:"
 *   - "Appendix C —"
 *   - "see Appendix D"
 *   - "(Appendix E)"
 */
export function findAppendixReferences(text: string): Array<{ letter: string; excerpt: string }> {
  const refs: Array<{ letter: string; excerpt: string }> = [];
  // Match "Appendix X" where X is a letter, optionally followed by punctuation
  const pattern = /Appendix\s+([A-Z])\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const letter = match[1].toUpperCase();
    // Get a short excerpt around the match for context
    const start = Math.max(0, match.index - 30);
    const end = Math.min(text.length, match.index + match[0].length + 30);
    const excerpt = text.slice(start, end).trim();
    refs.push({ letter, excerpt });
  }
  return refs;
}

/**
 * Validate appendix references in a narrative against the register.
 *
 * Detects:
 *   - conflicting_label: narrative refers to "Appendix A: Drawings" but the
 *     register says Appendix A is "Company Profile" and drawings are Appendix D.
 *   - unknown_appendix: narrative refers to "Appendix F" but the register
 *     only has A–E.
 *   - missing_register: no register is provided.
 */
export function validateAppendixReferences(
  text: string,
  register: AppendixRegister | null,
): AppendixReferenceViolation[] {
  if (!register || register.entries.length === 0) {
    // If there's no register, we can't validate — but we flag it
    const refs = findAppendixReferences(text);
    if (refs.length === 0) return [];
    return [{
      type: "missing_register",
      message: "Narrative contains appendix references but no appendix register is confirmed.",
      referencedLabel: refs[0].letter,
      expectedTitle: null,
      excerpt: refs[0].excerpt,
    }];
  }

  const violations: AppendixReferenceViolation[] = [];
  const refs = findAppendixReferences(text);
  const registerByLetter = new Map(register.entries.map((e) => [e.letter.toUpperCase(), e.title]));

  for (const ref of refs) {
    const expectedTitle = registerByLetter.get(ref.letter);
    if (!expectedTitle) {
      violations.push({
        type: "unknown_appendix",
        message: `Narrative references "Appendix ${ref.letter}" but the confirmed register does not include this letter.`,
        referencedLabel: ref.letter,
        expectedTitle: null,
        excerpt: ref.excerpt,
      });
      continue;
    }

    // Check if the narrative assigns a different title to this appendix
    // e.g. "Appendix A: Drawings" when the register says Appendix A is
    // "Company Profile" and drawings are Appendix D.
    const titleMatch = ref.excerpt.match(new RegExp(`Appendix\\s+${ref.letter}\\s*[:—–-]\\s*([^,.;\\n]{3,80})`, "i"));
    if (titleMatch) {
      const narrativeTitle = titleMatch[1].trim();
      // Check if the narrative title matches the register title (fuzzy)
      if (!titlesMatch(narrativeTitle, expectedTitle)) {
        // Check if this title belongs to a DIFFERENT appendix letter
        const conflictLetter = register.entries.find(
          (e) => titlesMatch(narrativeTitle, e.title) && e.letter.toUpperCase() !== ref.letter,
        );
        violations.push({
          type: "conflicting_label",
          message: conflictLetter
            ? `Narrative refers to "Appendix ${ref.letter}: ${narrativeTitle}" but the confirmed register assigns "${narrativeTitle}" to Appendix ${conflictLetter.letter}. Appendix ${ref.letter} should be "${expectedTitle}".`
            : `Narrative refers to "Appendix ${ref.letter}: ${narrativeTitle}" but the confirmed register says Appendix ${ref.letter} is "${expectedTitle}".`,
          referencedLabel: ref.letter,
          expectedTitle,
          excerpt: ref.excerpt,
        });
      }
    }
  }

  return violations;
}

/**
 * Fuzzy title match — checks if two titles are about the same content.
 * Compares key words (ignores case, articles, and common words).
 */
function titlesMatch(a: string, b: string): boolean {
  const stopWords = new Set(["the", "a", "an", "and", "or", "of", "for", "with", "to", "in", "on", "at", "by"]);
  const wordsA = a.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
  const wordsB = b.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
  // If at least 2 key words match, consider them the same
  const setB = new Set(wordsB);
  const matches = wordsA.filter((w) => setB.has(w)).length;
  return matches >= 2;
}

/**
 * Check if appendix reference violations block final export.
 * Final export is blocked when there are ANY conflicting or unknown appendix
 * references. Drafting is never blocked.
 */
export function appendixViolationsBlockFinalExport(violations: AppendixReferenceViolation[]): boolean {
  return violations.some((v) => v.type === "conflicting_label" || v.type === "unknown_appendix");
}
