// Packaging / format requirements — the rule vs. the proof.
//
// PROBLEM
// ───────
// The live tender showed the requirement "Submission in a Single PDF Technical
// File" supported by `Expert CVs.pdf.txt`. That evidence link is semantically
// wrong. A CV source file cannot demonstrate that the submission is a single
// PDF; nothing in a source document can. The requirement matched no
// evidence-kind branch, fell through to the GENERAL fallback, and GENERAL is a
// wildcard the selector admits every candidate for — so the highest-scoring
// unrelated file won, at FULL support.
//
// THE DISTINCTION
// ───────────────
// Two different questions get conflated, and they take different evidence:
//
//   "Does the tender REQUIRE this rule?"    → proven from the TENDER SOURCE
//                                             (sourceExactQuote, page, section).
//                                             Untouched by this module.
//
//   "Does our submission SATISFY the rule?" → proven from the GENERATED
//                                             ARTIFACT and the FINAL PACKAGE:
//                                             one technical PDF exists, it is
//                                             genuinely PDF, it carries the
//                                             required file name, it sits in the
//                                             right envelope, the package has
//                                             the required structure.
//
// A packaging/format requirement is therefore answerable only by output
// artifacts (a generated document or a confirmed build-plan item). Company
// vault records, expert CVs, project references and tender source files can
// never satisfy one, however well their text happens to score.
//
// This is a narrowing, not a weakening: a requirement that previously accepted
// an unrelated file as support now accepts only the artifact evidence that can
// actually prove it, and stays unsupported until that artifact exists.

/**
 * THE ONE NORMALISATION CONTRACT for requirement prose.
 *
 * Every phrase pattern in this module and in package-conformance.ts is written
 * against the output of THIS function. That sentence used to be false, and the
 * two halves of the rule engine disagreed about punctuation:
 *
 *   packaging-requirement-rule.normalise   stripped ":" to a space
 *   package-conformance.normalise          kept ":" verbatim
 *
 * while both tested the SAME shared phrase, /\bformat\s*:\s*(?:pdf|...)/.
 * That phrase could therefore never match here — the colon was gone before the
 * pattern ran — so "Format: PDF" failed isPackagingOrFormatRequirement, which
 * is the gate classifyPackageRule consults first, and the rule was classified
 * as an ordinary evidence requirement on every surface. An unreachable pattern
 * is invisible: it looks like coverage and provides none.
 *
 * THE CONTRACT
 *   1. lower case;
 *   2. every Unicode dash becomes "-";
 *   3. every character that is not a letter, digit, "%", "." or "-" becomes a
 *      SPACE — so ":", ",", ";", "/", "(" and quotes are separators, never
 *      literals. A pattern must never contain one of them;
 *   4. a hyphen used as a SEPARATOR — whitespace or a string edge on either
 *      side — becomes a space, so "Font - Arial 11" reads as "Font Arial 11".
 *      A hyphen INSIDE a word is spelling and survives, so "e-mail",
 *      "non-editable" and "spiral-bound" still read as themselves;
 *   5. whitespace collapses to one space.
 *
 * Consequence, and the point of the exercise: "Font: Arial 11",
 * "Font - Arial 11" and "Font Arial 11" all normalise to "font arial 11", so
 * one pattern classifies all three. A test pins that, and another test pins
 * that no pattern contains a character rule 3 removes.
 */
export function normaliseRequirementText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9%.\- ]+/g, " ")
    .replace(/(^|\s)-+/g, "$1 ")
    .replace(/-+(\s|$)/g, " $1")
    .replace(/\s+/g, " ")
    .trim();
}

const normalise = normaliseRequirementText;

/**
 * Phrases that make a requirement about the SHAPE of the submission rather
 * than about a document's content. Each is a rule the final package either
 * satisfies or violates.
 */
const PACKAGING_PHRASES: RegExp[] = [
  // Single-file / consolidation rules
  /\b(?:single|one|1)\s+(?:consolidated\s+)?(?:pdf|file|document|volume)\b/,
  /\bsingle\s+(?:pdf|technical|financial)\b/,
  /\bconsolidated\s+into\s+(?:a\s+)?(?:single|one)\b/,
  /\b(?:combined?|merged?|compiled)\s+into\s+(?:a\s+|one\s+)?(?:single\s+)?(?:pdf|file|document)\b/,
  /\bas\s+(?:a\s+)?single\s+\w+\b/,
  // File format rules
  /\b(?:submitted?|submission|provided?|uploaded?|saved?)\s+in\s+(?:pdf|docx?|word|excel|xlsx)\s*(?:format)?\b/,
  /\b(?:pdf|docx?|xlsx)\s+format\s+(?:only|is\s+required|required)\b/,
  // "Format: PDF". The colon is a SEPARATOR under the normalisation contract,
  // never a literal — this pattern used to spell it out and could not match.
  /\bformat\s+(?:pdf|docx?|word|excel)\b/,
  /\bsearchable\s+pdf\b/,
  /\bnon[-\s]?editable\s+(?:pdf|format)\b/,
  // File naming rules
  /\bfile\s+nam(?:e|ing)\b/,
  /\bnaming\s+(?:convention|format|rule)\b/,
  /\bnamed?\s+(?:exactly\s+)?as\s+follows\b/,
  // Packaging / envelope / copies rules
  /\b(?:sealed|separate|two)\s+envelopes?\b/,
  /\benvelope\s+(?:structure|marking|labell?ing)\b/,
  /\b(?:number\s+of\s+)?(?:hard\s+)?copies\b/,
  /\b(?:bound|binding|spiral\s+bound|ring\s+bound)\b/,
  /\btabbed?\s+(?:and\s+)?(?:indexed?|dividers?)\b/,
  /\bpackag(?:e|ing)\s+(?:rule|structure|instruction|requirement)/,
  // Layout limits that the artifact itself proves
  /\bpage\s+limit\b/,
  /\b(?:maximum|max|not\s+(?:to\s+)?exceed|no\s+more\s+than)\s+(?:of\s+)?\d+\s+pages?\b/,
  /\bwithin\s+\d+\s+pages?\b/,
  /\b\d+\s+pages?\s+(?:maximum|max|or\s+less|or\s+fewer|limit)\b/,
  // TYPOGRAPHY. A rule about the face, size or leading of the text is a
  // property of the produced artifact, exactly like a page limit — and like a
  // page limit, stored bytes cannot adjudicate it, so classifyPackageRule
  // lands it in NOT_MACHINE_DECIDABLE and the coverage denominator excludes
  // it. Before this, "All submissions shall be typed in Arial 11pt with 1.15
  // line spacing" matched NOTHING: it names no "font size" and no "font
  // type", so it fell through to the GENERAL evidence path and any vault
  // document with overlapping words could be offered as its proof.
  //
  // The SUBSTANTIVE_EVIDENCE_SIGNALS guard runs BEFORE these, so a
  // requirement that also asks for a CV, a licence or a methodology stays an
  // evidence requirement with its real evidence link intact.
  /\bfonts?\b/,
  /\b(?:arial|times\s+new\s+roman|calibri|helvetica|verdana|garamond|cambria|tahoma|courier\s+new)\b/,
  // "11pt", "12 pt". Deliberately NOT \d+\s*points?, which would claim
  // "a 5 point action plan".
  /\b\d{1,2}\s*pt\b/,
  /\btyped\s+in\b/,
  /\bline\s+spac(?:ing|ed)\b/,
  /\b(?:single|double|1\.5|1\.15)\s+spac(?:ing|ed)\b/,
  /\b(?:line\s+spacing|margins?)\s+(?:of|must|shall|should)\b/,
  // PAGE SIZE. "A4-size" keeps its intra-word hyphen under the contract, so
  // the separator here is [\s-]+ rather than \s+.
  /\b(?:a3|a4|letter|legal)[\s-]+(?:size|paper|format|sheets?)\b/,
  /\b(?:printed|produced|submitted|prepared)\s+on\s+(?:a3|a4|letter|legal)\b/,
  /\bpaper\s+size\b/,
  // File-size limits
  /\b(?:file\s+size|maximum\s+size)\b/,
  /\bnot\s+exceed(?:ing)?\s+\d+\s*(?:mb|kb|gb)\b/,
];

/**
 * Signals that the requirement asks for a substantive DOCUMENT or CREDENTIAL,
 * whose proof is a real record — a CV, a project reference, a licence, a signed
 * form. When one of these is present the requirement is not a packaging rule,
 * even if it also mentions a format ("submit the audited financial statements
 * in PDF" is an evidence requirement with a format note attached).
 */
const SUBSTANTIVE_EVIDENCE_SIGNALS: RegExp[] = [
  /\b(?:curriculum vitae|\bcvs?\b|expert|personnel|staff|team leader)\b/,
  /\b(?:project reference|similar project|past performance|track record|experience)\b/,
  /\b(?:audited|financial statement|turnover|balance sheet|bank (?:reference|guarantee|statement))\b/,
  /\b(?:trade|business|professional)\s+licen[cs]e\b/,
  /\b(?:registration|incorporation)\s+certificate\b/,
  /\btax\s+(?:clearance|identification)\b/,
  /\b(?:vat|tin)\s+certificate\b/,
  /\binsurance\s+certificate\b/,
  /\b(?:iso|quality)\s+certificat/,
  /\b(?:signed|completed|duly filled)\s+(?:form|declaration|undertaking)\b/,
  /\b(?:power of attorney|integrity pact|sworn statement)\b/,
  /\bbid\s+(?:bond|security)\b/,
  /\bmethodology\b/,
  /\bwork\s+plan\b/,
];

export type PackagingRequirementInput = {
  title?: string | null;
  description?: string | null;
  restrictions?: string | null;
  requirementType?: string | null;
  exactFileName?: string | null;
};

/**
 * True when the requirement states a SUBMISSION FORMAT or PACKAGING rule whose
 * satisfaction is a property of the produced artifact and final package, not of
 * any company record or tender source file.
 *
 * Deliberately conservative: when a requirement also asks for substantive
 * evidence (a CV, a licence, audited accounts, a signed form), it is treated as
 * an evidence requirement so its real evidence link is preserved.
 */
export function isPackagingOrFormatRequirement(requirement: PackagingRequirementInput): boolean {
  const type = normalise(requirement.requirementType).replace(/ /g, "_").toUpperCase();
  const text = normalise(
    [requirement.title, requirement.description, requirement.restrictions].filter(Boolean).join(" "),
  );
  if (!text) return false;

  const explicitType = type === "SUBMISSION_FORMAT" || type === "PACKAGING" || type === "FILE_FORMAT";
  if (!explicitType && SUBSTANTIVE_EVIDENCE_SIGNALS.some((rx) => rx.test(text))) return false;

  return explicitType || PACKAGING_PHRASES.some((rx) => rx.test(text));
}

/**
 * Phrases that make a requirement about HOW THE BID IS DELIVERED — the
 * channel, the address, the subject line — rather than about the content of
 * any document.
 *
 * The module above solved this for the SHAPE of the submission. It did not
 * solve it for the ADDRESSING of the submission, and the live tender shows the
 * same failure in the half that was left:
 *
 *   Email Submission Only        evidence: Expert CVS.pdf.txt
 *   Required Email Subject Line  evidence: Expert CVS.pdf.txt
 *
 * The same file named in this module's own PROBLEM note, attached to two more
 * requirements it cannot possibly prove. "Submission Method: Email submission
 * only" matches no PACKAGING_PHRASE — it is not about single files, formats,
 * naming, envelopes or page limits — so it still falls through to GENERAL, and
 * GENERAL admits everything. Every CV contains an email address, so a CV wins.
 *
 * Generic: any tender that names a submission channel, against any vault
 * holding a document with ordinary words in it.
 */
const SUBMISSION_INSTRUCTION_PHRASES: RegExp[] = [
  /\bemail\s+submissions?\s+only\b/,
  /\bsubmissions?\s+(?:by|via|through)\s+email\b/,
  /\b(?:submit|send|deliver)(?:ted|ed)?\s+(?:only\s+)?(?:by|via|to|through)\s+e-?mail\b/,
  /\bsubmission\s+method\b/,
  /\bsubmission\s+(?:e-?mail|address|portal|link|channel)\b/,
  /\b(?:required\s+)?e-?mail\s+subject(?:\s+line)?\b/,
  /\bsubject\s+line\s+(?:must|shall|should)\b/,
  /\bupload(?:ed)?\s+(?:to|via|through)\s+(?:the\s+)?(?:portal|platform|e-?procurement)\b/,
  /\bhand\s+deliver(?:y|ed)\b/,
  /\b(?:courier|registered\s+post|postal\s+submission)\b/,
  /\bsubmitted?\s+to\s+the\s+(?:following\s+)?address\b/,
];

/**
 * True when the requirement states HOW the bid must reach the client.
 *
 * Satisfying such a rule is a property of the submission plan and the produced
 * package — the artifact says where it goes and under what subject. No company
 * vault record can ever prove it, however well its text scores.
 *
 * Deliberately NOT folded into `isPackagingOrFormatRequirement`: that predicate
 * resolves to the PACKAGE_FORMAT evidence family alone, and a submission
 * instruction must remain provable by the generated artifact's own validated
 * text. `tests/generated-artifact-content-coverage.test.ts` pins exactly that,
 * and an earlier attempt of mine to route these rules away from artifact
 * evidence was reverted in 8f2eed4b for breaking it. The fix is to stop these
 * requirements reaching the GENERAL wildcard — not to narrow them past the
 * evidence that genuinely answers them.
 */
export function isSubmissionInstructionRequirement(requirement: PackagingRequirementInput): boolean {
  const type = normalise(requirement.requirementType).replace(/ /g, "_").toUpperCase();
  const text = normalise(
    [requirement.title, requirement.description, requirement.restrictions].filter(Boolean).join(" "),
  );
  if (!text) return false;

  // Same conservatism as above: a requirement that also asks for substantive
  // evidence keeps its real evidence link. "Email the audited accounts" is an
  // accounts requirement with a delivery note attached.
  if (SUBSTANTIVE_EVIDENCE_SIGNALS.some((rx) => rx.test(text))) return false;

  const explicitType = type === "SUBMISSION_RULE" || type === "SUBMISSION";
  return SUBMISSION_INSTRUCTION_PHRASES.some((rx) => rx.test(text))
    // An explicitly typed submission rule is about the submission by
    // definition; requiring it to also match a phrase would leave the same
    // hole for the next wording a procuring entity invents.
    || explicitType;
}
