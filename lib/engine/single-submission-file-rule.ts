// A tender that says the WHOLE submission is one named file.
//
// Live requirement on the 2026-09-23 Preview tender (MANDATORY, "PDF
// Submission"):
//
//   "All documents must be submitted as a single PDF file named
//    'Technical Proposal.pdf'."
//
// The Build Plan nevertheless listed three technical files — Technical
// Proposal.pdf, Cover Letter.docx and Company Profile.docx — because each
// bidder-produced deliverable the tender mentions became its own file. Package
// conformance then correctly reported SUBMISSION_RULE_BROKEN_BY_PACKAGE ("the
// current package holds 3 … must be consolidated into a single file"), and no
// automatic step could ever satisfy it: the plan itself required the very
// files the rule forbids.
//
// The rule is a statement about the PLAN, so it is applied where the plan is
// built. When the tender names the one file, bidder-produced deliverables in
// the same (non-financial) scope are contents of that file, not files beside
// it. Their requirement ids move to the named file, so nothing loses its
// provenance. Tender-issued forms and original evidence are NOT folded: they
// are not produced by writing prose, and folding them would hide a real gap the
// conformance check must keep reporting.

import type { TenderRequirementLike } from "./submission-plan";

export type SingleSubmissionFileRule = {
  /** The file name the tender says the whole submission must be. */
  fileName: string;
  /** Requirements that state the rule. */
  requirementIds: string[];
};

const QUOTE = String.raw`["'‘’“”]`;
const NAMED_FILE = String.raw`(?:named|called|titled|entitled|with\s+the\s+(?:file\s+)?name)\s*:?\s*${QUOTE}?([^"'‘’“”\n]{1,120}?\.(?:pdf|docx?))${QUOTE}?`;
const SINGLE_FILE = String.raw`(?:a\s+|one\s+)?(?:single|one)\s+(?:consolidated\s+)?(?:pdf|docx?|word)?\s*(?:file|document|volume)`;
// "All documents / the entire submission / the whole bid … single … file named X"
const WHOLE_SUBMISSION = String.raw`\b(?:all\s+(?:the\s+)?(?:documents?|files?|submissions?|attachments?|components?)|(?:the\s+)?(?:entire|whole|complete|full)\s+(?:submission|bid|proposal|package|offer))\b`;

const RULE = new RegExp(`${WHOLE_SUBMISSION}[^.;]{0,120}?${SINGLE_FILE}[^.;]{0,40}?${NAMED_FILE}`, "i");

export function statedSingleSubmissionFile(
  requirements: readonly TenderRequirementLike[],
): SingleSubmissionFileRule | null {
  let fileName: string | null = null;
  const requirementIds: string[] = [];
  for (const requirement of requirements) {
    const text = [requirement.title, requirement.description, requirement.restrictions]
      .filter(Boolean)
      .join(". ")
      .replace(/\s+/g, " ");
    const match = RULE.exec(text);
    if (!match) continue;
    const named = match[1]!.trim();
    // Two requirements naming DIFFERENT single files is a contradiction the
    // planner must not resolve by picking one.
    if (fileName && fileName.toLowerCase() !== named.toLowerCase()) return null;
    fileName = named;
    requirementIds.push(requirement.id);
  }
  return fileName ? { fileName, requirementIds } : null;
}
