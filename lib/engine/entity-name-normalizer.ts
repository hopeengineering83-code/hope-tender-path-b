// Entity name normalizer — post-generation pass that replaces minor variations
// of canonical expert and project names with their authoritative database form.
//
// WHY THIS EXISTS
// ───────────────
// When generateProposalSectionsParallel fires 4 concurrent Claude calls, each
// section is generated independently. An expert whose canonical name is
// "Dr. Almaz Tadesse" may appear as "Almaz Tadesse" in the Cover Letter,
// "Dr. Almaz T." in Section A.4, and "Almaz" in Section C — all valid
// English usages, but inconsistent in a formal proposal and confusing to
// evaluators who compare expert lists across sections.
//
// This module does a fast post-assembly pass that:
//   1. Finds all expert name variations (first+last present, optional title
//      prefix, optional middle name/initial) and replaces them with the
//      canonical fullName from the Expert record.
//   2. Removes spurious "The [ProjectName]" article constructions that arise
//      when the AI adds an article to a proper noun.
//
// SAFETY RULES (to avoid corrupting valid text)
// ─────────────────────────────────────────────
//   • Only replaces when BOTH first name AND last name are present — single-name
//     matches are too risky (common words can collide with names).
//   • Skips names shorter than 4 characters total (likely initials or nicknames).
//   • Does NOT touch text inside Markdown table separator rows (|---|---|).
//   • Does NOT replace inside code blocks (```).
//   • Project name normalization only removes leading "The "/"the " articles.

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TITLE_PREFIXES = /^(?:Dr|Mr|Ms|Mrs|Eng|Prof|Ir|Er|Arch|Ato|W\/ro|Wt|Drs)\.?\s+/i;

function stripTitle(name: string): string {
  return name.replace(TITLE_PREFIXES, "").trim();
}

export function enforceCanonicalNames(
  markdown: string,
  experts: Array<{ fullName: string }>,
  projects: Array<{ name: string }>,
): string {
  // Skip code blocks — regex replacements inside ``` blocks can corrupt them.
  // We split on code fence markers, process only non-code segments, then rejoin.
  const segments = markdown.split(/(```[\s\S]*?```)/g);

  const processedSegments = segments.map((segment, idx) => {
    // Odd-indexed segments are code blocks — leave untouched.
    if (idx % 2 === 1) return segment;

    let result = segment;

    // ── Expert name normalization ──────────────────────────────────────────────
    for (const expert of experts) {
      const canonical = expert.fullName.trim();
      if (!canonical || canonical.length < 4) continue;

      // Strip title prefix to get the core name parts.
      const coreName = stripTitle(canonical);
      const parts = coreName.split(/\s+/).filter((p) => p.length > 1);
      if (parts.length < 2) continue;

      const firstName = parts[0];
      const lastName = parts[parts.length - 1];
      if (!firstName || !lastName || firstName === lastName) continue;

      // Build regex: optional title prefix + first name + optional middle
      // names/initials + last name. Word boundaries on both ends.
      const titleOpt = "(?:Dr\\.?|Mr\\.?|Ms\\.?|Mrs\\.?|Eng\\.?|Prof\\.?|Ir\\.?|Er\\.?|Arch\\.?|Ato\\.?)?\\s*";
      const middleOpt = "(?:[A-Z][a-zA-Z]*\\.?\\s+)*";
      const pattern = new RegExp(
        `\\b${titleOpt}${escapeRegex(firstName)}\\s+${middleOpt}${escapeRegex(lastName)}\\b`,
        "g",
      );

      result = result.replace(pattern, (match) => {
        // Don't replace if the match IS already the canonical form.
        if (match === canonical) return match;
        // Don't replace inside table separator rows.
        if (/^\|[\s\-:]+\|/.test(match)) return match;
        return canonical;
      });
    }

    // ── Project name normalization ─────────────────────────────────────────────
    // Only strip leading "The "/"the " articles — conservative, low collision risk.
    for (const project of projects) {
      const canonical = project.name.trim();
      if (!canonical || canonical.length < 6) continue;

      // Remove spurious leading article that the AI sometimes adds.
      const withArticle = new RegExp(`\\bthe\\s+${escapeRegex(canonical)}\\b`, "gi");
      result = result.replace(withArticle, canonical);
    }

    return result;
  });

  return processedSegments.join("");
}
