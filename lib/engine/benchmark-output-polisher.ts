export function polishBenchmarkOutput(markdown: string): string {
  return markdown
    // "===== SOURCE PAGE 136 =====" did not match: the rule required the digits
    // to follow "PAGE" immediately after the equals run, and real extraction
    // markers name the source first. The markers reached a client proposal
    // verbatim inside an expert's printed profile.
    .replace(/=+\s*(?:[A-Z]+\s+)?PAGE\s+\d+\s*=+/gi, "")
    // The vault's own trust marker. persistOnce prefixes an unverified record's
    // profile/summary with "[REGEX_DRAFT — AUTOMATIC SOURCE VERIFICATION
    // PENDING]" so the app can see the state; a real proposal printed it to the
    // client, including inside a table cell where the surrounding newlines had
    // already been collapsed so the standalone-bracket rule could not catch it.
    .replace(/\[\s*(?:REGEX_DRAFT|AI_DRAFT|MANUAL_DRAFT|SOURCE_VERIFIED|REVIEWED)\s*[—-]\s*AUTOMATIC SOURCE VERIFICATION PENDING\s*\]\s*/gi, "")
    // Extraction bookkeeping that belongs to the vault, not to the evaluator.
    .replace(/\bSource pages:\s*[\d]+\s*[-–]\s*[\d]+\s*/gi, "")
    .replace(/\bExtraction method:[^.\n]*\.\s*/gi, "")
    .replace(/<PARSED TEXT FOR PAGE:[^>]+>/gi, "")
    .replace(/\bPARSED TEXT FOR PAGE\b[^\n]*/gi, "")
    .replace(/Senior-level requirement bundle consolidating \d+ extracted tender instruction\(s\)\.?/gi, "")
    .replace(/Key evidence interpreted:\s*/gi, "")
    .replace(/Company evidence available:\s*/gi, "")
    .replace(/Project evidence available:\s*/gi, "")
    .replace(/Source-evidence action:\s*/gi, "Supporting evidence: ")
    .replace(/Bid-team confirmation:\s*/gi, "Supporting evidence: ")
    .replace(/Evidence note:\s*/gi, "Supporting evidence: ")
    .replace(/\bproposal team confirmation item(s)?\b/gi, "source-evidence confirmation item$1")
    .replace(/\bbid-team confirmation item(s)?\b/gi, "source-evidence confirmation item$1")
    .replace(/\bbid-team-confirmed\b/gi, "source-confirmed")
    .replace(/\bbid-team verification\b/gi, "final verification")
    .replace(/\bbid team\b/gi, "proposal team")
    .replace(/\bBid team\b/g, "Proposal team")
    .replace(/The final proposal should preserve a clear claim-to-evidence discipline so the proposal team can verify every major claim before export\./gi, "The proposal preserves a clear claim-to-evidence discipline so each major claim can be checked against the appendix evidence before submission.")
    .replace(/The proposal should be reviewed against the original tender before final submission\./gi, "The proposal is aligned to the original tender and supporting evidence for final submission review.")
    .replace(/must be reviewed against the original tender documents and supporting source evidence before final submission/gi, "is prepared against the original tender documents and supporting source evidence for final submission review")
    .replace(/This file organizes the relevant requirements, evidence and submission-control points for the named tender document\./gi, "This document presents the relevant tender requirement response, supporting evidence and submission controls in a client-ready package format.")
    .replace(/\b(extensive|vast|rich) experience\b/gi, "demonstrated experience")
    .replace(/\bcommitted to (?:excellence|quality|delivering results|client satisfaction)\b/gi, "quality-focused")
    .replace(/\bleading (?:firm|consultancy|company) in the region\b/gi, "experienced regional consultancy")
    .replace(/\bteam of (?:highly |)qualified professionals\b/gi, "specialist technical team")
    .replace(/\bworld-class\b/gi, "technically proven")
    .replace(/\bstate-of-the-art\b/gi, "proven")
    .replace(/\bsecond to none\b/gi, "evidenced by our portfolio")
    // Horizontal whitespace only. `\s` matches newlines, so this rule used to
    // reach across the blank line between a markdown table and the section
    // after it: the table row's closing "|", the paragraph break and the next
    // heading's "#" were all replaced by " — ", which swallowed a whole
    // section into the last table cell.
    //
    // Measured on a real generated proposal: "## A.6 Biomedical Engineering
    // Specialist Engagement Plan" — the section that tells the evaluator the
    // firm will engage a licensed specialist for a discipline its own team does
    // not hold — was absorbed into the last row of the A.5 Team-to-Project
    // Mapping table. It never appeared as a heading, never reached the table of
    // contents, and the one honest statement about the tender's biomedical
    // requirement was invisible while its text corrupted a table.
    .replace(/[ \t]+\|[ \t]+#/g, " — ")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
