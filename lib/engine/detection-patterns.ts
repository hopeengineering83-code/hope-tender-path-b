/**
 * Shared detection patterns for document quality validation, authority review,
 * and proposal scoring. Single source of truth so all three gates agree on
 * what constitutes a placeholder or AI-trace in final proposal output.
 */

/** Metadata-specific placeholder patterns — phrases like "Bid-Team to confirm"
 *  common in extracted tender metadata. Used by tender-metadata-completeness.ts. */
export const METADATA_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bbid[\s-]?team\s+to\s+confirm\b/i,
  /\bto\s+be\s+(?:confirmed|determined|provided|completed|inserted)\b/i,
  /\b(?:tbd|tbc|tba)\b/i,
  /\b(?:not\s+provided|not\s+available|not\s+specified|unknown|pending)\b/i,
  /\bn\/?a\b/i,
  /\bplaceholder\b/i,
  /\b(?:insert|add|fill)\b.{0,40}\b(?:here|later|manually)\b/i,
  /\b\[?fill[\s_-]?in\]?/i,
  /\bexact\s+site\s+to\s+be\s+determined\b/i,
  /\bwith\s+consultant'?s\s+assistance\b/i,
];

// ─── Placeholder vocabulary: value-position vs anywhere ──────────────────────
//
// METADATA_PLACEHOLDER_PATTERNS above is correct for what it was written for:
// checking a single extracted FIELD VALUE. If a tender's "client name" field
// reads "not available", that is a placeholder, full stop.
//
// Scanning a whole DOCUMENT's prose is a different problem, and reusing the
// same list there produced a false block. Live evidence, tender
// 08e250af / Company Profile.docx, quality 75 / QUALITY_FAILED:
//
//   BID_TEAM_TO_CONFIRM: Document contains 1 internal placeholder
//   reference(s): "not available".
//
//   …through email to the designated contacts only. Hard copy submissions or
//   portal uploads are not available.
//
// That is the TENDER'S OWN sentence, quoted into the document because
// narrativeDraftContent() lists the requirements a file addresses. "Not
// available" there is a fact about submission channels, not an unfilled slot.
// One ordinary English phrase blocked the entire export.
//
// So the vocabulary splits by how much the phrase alone tells you:
//
//   ALWAYS  — no innocent reading in a proposal. "Bid-Team to confirm",
//             "placeholder", "fill in", "TBD". These match anywhere.
//   VALUE   — ordinary English that only signals an unfilled slot when it IS
//             the value: "Client: not available" is a placeholder,
//             "portal uploads are not available" is a sentence.
//
// This narrows WHERE the ambiguous half applies, never WHETHER it applies.
// A genuine "Contact person: unknown" still fails.

/** Placeholder markers with no innocent reading — match anywhere in prose. */
export const ALWAYS_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bbid[\s-]?team\s+to\s+confirm\b/i,
  /\b(?:tbd|tbc|tba)\b/i,
  /\bplaceholder\b/i,
  /\b(?:insert|add|fill)\b.{0,40}\b(?:here|later|manually)\b/i,
  /\b\[?fill[\s_-]?in\]?/i,
  /\bexact\s+site\s+to\s+be\s+determined\b/i,
  /\bwith\s+consultant'?s\s+assistance\b/i,
];

/**
 * Ordinary English that indicates an unfilled slot only in value position.
 * Source fragments (not anchored) so the position anchors can be composed
 * around them below.
 */
const VALUE_POSITION_PLACEHOLDER_SOURCES: string[] = [
  "not\\s+provided",
  "not\\s+available",
  "not\\s+specified",
  "unknown",
  "pending",
  "n\\/?a",
  "to\\s+be\\s+(?:confirmed|determined|provided|completed|inserted)",
];

/**
 * Value position, as it survives DOCX/PDF text extraction:
 *   "Client: not available"      → a labelled field whose value is the phrase
 *   "not available"              → a table cell, extracted as its own line
 *   "[not available]"            → an explicit bracketed slot
 * A phrase inside a running sentence is deliberately NOT value position.
 */
export function valuePositionPlaceholderMatches(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const source of VALUE_POSITION_PLACEHOLDER_SOURCES) {
    const anchors = [
      // "Label: <phrase>" ending the line (a label, not a whole sentence).
      new RegExp(`^[^\\n:]{1,60}:[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      // The phrase alone on its own line — how a table cell extracts.
      new RegExp(`^[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      // An explicit bracketed slot.
      new RegExp(`[\\[\\(<]{1,2}[ \\t]*(${source})[ \\t]*[\\]\\)>]{1,2}`, "gi"),
    ];
    for (const anchor of anchors) {
      for (const match of text.matchAll(anchor)) {
        const phrase = (match[1] ?? match[0]).trim();
        if (phrase && !found.includes(phrase)) found.push(phrase);
      }
    }
  }
  return found;
}

/** Sources already spelled out in the document list, so the unambiguous
 *  metadata patterns spread in below cannot duplicate one. */
const DOCUMENT_PLACEHOLDER_PATTERN_SOURCES = new Set<string>([
  /\[insert [^\]]+\]/i.source,
  /\[TBD\]/i.source,
  /\[NAME\]/i.source,
  /\[DATE\]/i.source,
  /\bplaceholder\b/i.source,
  /\bTBD\b/i.source,
]);

/** Document-level placeholder patterns — superset of metadata patterns plus
 *  bracket/template markers common in generated proposal text.
 *  Commonly used in components/document-validator-panel.tsx. */
export const DOCUMENT_PLACEHOLDER_PATTERNS: RegExp[] = [
  // Template fill-in brackets
  /\[insert [^\]]+\]/i,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\[PLACEHOLDER[^\]]*\]/i,
  /\[INSERT[^\]]*\]/i,
  /\[COMPANY[^\]]*\]/i,
  /\[Company Name\]/i,        // explicit variant preserved for test compatibility
  /\[CLIENT(?:\s+TO\s+BE\s+CONFIRMED)?\]/i,
  /\[\s*\]/,
  /\{[A-Z_]{3,}\}/,              // {FIELD_NAME} template slots
  /<<(?:INSERT|NAME|DATE|COMPANY|PLACEHOLDER|YOUR)[^>]{0,60}>>/i, // <<INSERT NAME>>
  /\{\{(?:INSERT|NAME|DATE|COMPANY|PLACEHOLDER|YOUR)[^}]{0,60}\}\}/i, // {{INSERT NAME}}
  /_{4,}/,                       // ____ fill-in-the-blank underscores
  // Project-specific stubs
  /Bid-Team\s+to\s+confirm/i,
  /Bid-Team\s+Action/i,
  /MISSING_SOURCE/,
  /\[Bid-Team[^\]]*\]/i,
  /Source-evidence action/i,
  /Not\s+extracted\s*[—–-]\s*confirm\s+manually/i,
  // Generic stub words
  /\bplaceholder\b/i,
  /\blorem\s+ipsum\b/i,
  /\bsample\s+text\b/i,
  /\bTBD\b/i,
  /\bXXX\b/,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /n\/a\s+\(pending\)/i,
  // The UNAMBIGUOUS half of the metadata vocabulary belongs here — "TBC",
  // "TBA", "Bid-Team to confirm" and friends have no innocent reading in a
  // proposal, so they match anywhere in prose exactly as before. Only the
  // ambiguous half (ordinary English like "not available") is withheld, and
  // it is reachable through documentPlaceholderMatches() below. De-duplicated
  // by source because a few entries appear in both lists and a repeated
  // pattern would double-count occurrences.
  ...ALWAYS_PLACEHOLDER_PATTERNS.filter(
    (rx) => !DOCUMENT_PLACEHOLDER_PATTERN_SOURCES.has(rx.source),
  ),
];

// The ambiguous half deliberately does NOT live in the list above.
//
// DOCUMENT_PLACEHOLDER_PATTERNS used to end with
// `...METADATA_PLACEHOLDER_PATTERNS` plus a bare
// /to\s+be\s+(?:added|filled|completed|provided|confirmed|determined)\b/,
// so every consumer scanning a document's PROSE with this list inherited the
// field-value vocabulary and matched it anywhere. That is the same false
// positive that blocked Company Profile.docx on "…portal uploads are not
// available", and fixing only document-quality-gate.ts left it live in
// document-quality-validator.ts, which then blocked the very same document
// through a different path (qualityBlocked -> PLANNED_DOCUMENT_BLOCKED) while
// the gate scored it 100/PASSED. Two authorities, one sentence, opposite
// verdicts.
//
// So there is now ONE function every document-prose consumer calls, and the
// ambiguous vocabulary is reachable only through it.

/** The ambiguous half, as document-level prose sees it: value position only. */
const DOCUMENT_VALUE_POSITION_EXTRA_SOURCES: string[] = [
  "to\\s+be\\s+(?:added|filled|completed|provided|confirmed|determined)",
];

/**
 * Every placeholder a DOCUMENT's prose should be blocked for.
 *
 * Unambiguous markers match anywhere; ordinary English only where it is the
 * value of a field or cell. Returns the matched phrases so a caller can name
 * them — a fail-closed gate that cannot say what it matched is not actionable.
 */
export function documentPlaceholderMatches(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const rx of DOCUMENT_PLACEHOLDER_PATTERNS) {
    const global = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
    for (const match of text.matchAll(global)) {
      const phrase = match[0].trim();
      if (phrase && !found.includes(phrase)) found.push(phrase);
    }
  }
  for (const phrase of valuePositionPlaceholderMatches(text)) {
    if (!found.includes(phrase)) found.push(phrase);
  }
  for (const source of DOCUMENT_VALUE_POSITION_EXTRA_SOURCES) {
    for (const anchor of [
      new RegExp(`^[^\\n:]{1,60}:[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      new RegExp(`^[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      new RegExp(`[\\[\\(<]{1,2}[ \\t]*(${source})[ \\t]*[\\]\\)>]{1,2}`, "gi"),
    ]) {
      for (const match of text.matchAll(anchor)) {
        const phrase = (match[1] ?? match[0]).trim();
        if (phrase && !found.includes(phrase)) found.push(phrase);
      }
    }
  }
  return found;
}

/**
 * How MANY placeholder occurrences a document's prose contains.
 *
 * Same rules as documentPlaceholderMatches, but counting every hit rather
 * than distinct phrases: callers that report "N placeholder reference(s)"
 * mean occurrences, and collapsing two "Bid-Team to confirm" into one
 * understates the problem.
 */
export function documentPlaceholderOccurrences(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const rx of DOCUMENT_PLACEHOLDER_PATTERNS) {
    const global = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`);
    count += [...text.matchAll(global)].length;
  }
  for (const source of [...VALUE_POSITION_PLACEHOLDER_SOURCES, ...DOCUMENT_VALUE_POSITION_EXTRA_SOURCES]) {
    for (const anchor of [
      new RegExp(`^[^\\n:]{1,60}:[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      new RegExp(`^[ \\t]*(${source})[ \\t]*\\.?[ \\t]*$`, "gim"),
      new RegExp(`[\\[\\(<]{1,2}[ \\t]*(${source})[ \\t]*[\\]\\)>]{1,2}`, "gi"),
    ]) {
      count += [...text.matchAll(anchor)].length;
    }
  }
  return count;
}

/** Alias for backward compatibility with older modules. */
export const PLACEHOLDER_PATTERNS = DOCUMENT_PLACEHOLDER_PATTERNS;

/** Phrases identifying content as AI-generated.
 *  Merged from proposal-quality-scorer.ts and other gates. */
export const AI_TRACE_PATTERNS: RegExp[] = [
  /\bAI[-\s]assisted\s+(?:tender\s+)?proposal\s+generation\b/i,
  /\b(?:tender\s+)?proposal\s+AI[-\s]ready\s+summary\b/i,
  /\bproposal\s+evaluator\s+loop\b/i,
  /\bproposal\s+self[-\s]score\b/i,
  /\bcompliance\s+and\s+bid\s+review\s+strategy\b/i,
  /\b(?:bid[-\s]team|internal)\s+(?:review|strategy|scoring|evaluation)\b/i,
  /\bprepared\s+for\s+(?:AI|model)[-\s]assisted\b/i,
  /as an ai/i,
  /\bi am an ai\b/i,
  /\bas a language model\b/i,
  // Bare "language model" with no "as a"/"AI" prefix. The generators already
  // strip this exact phrase before rendering — FORBIDDEN_TRACE_PATTERNS in
  // lib/engine/expert-cv-docx.ts carries /\blanguage model\b/gi and its comment
  // states that the export quality gate "rejects any CV that still carries it".
  // The gate only ever matched the prefixed forms, so a stripped-prefix
  // leftover such as "I am a language model." passed every gate, while the
  // Document Validator panel's own private copy of these patterns caught it.
  // Unifying the panel onto this list would have LOST that detection.
  /\blanguage\s+model\b/i,
  /\bas a large language\b/i,
  /\bi cannot\b/i,
  /\bi'?m sorry,? i\b/i,
  /I don'?t have access/i,
  /I'?m sorry,? I/i,
  /my\s+knowledge\s+cutoff/i,
  /my\s+training\s+data/i,
  /I\s+was\s+trained/i,
  /\bChatGPT\b/i,
  /GPT-[3-4]/i,
  /\banthropic\b/i,
  /claude(?:\.ai)?/i,
  /\bgemini\b/i,
  /certainly!\s*I\s+can\s+help/i,
  /\bOpenAI\b/i,
  /\bClaude\b(?:\s+AI|\s+by\s+Anthropic)?/i,
  /\bI\s+do\s+not\s+have\s+access\b/i,
  /\bgenerated\s+by\s+AI\b/i,
  /\bAI\s+language\s+model\b/i,
  /\bprompt\s+(?:instruction|template|engineering)\b/i,
  /\bdraft\s+note\b/i,
  /\bsubmission\s+note\b/i,
  /\bregex\s+fallback\b/i,
  /\bdeterministic\s+fallback\b/i,
  /\bAI\s+provider\b/i,
  /\bBenchmark\s+trace\b/i,
  /\bpreparation\s+trace\b/i,
  // Round 4 expansion items from scorer
  /\bI have prepared\b/i,
  // NOT a bare /\bBelow is\b/: "below" is an ordinary adverb and the bare
  // pattern condemned correct English — "The methodology below is tailored to
  // the following identified service streams", "The table below is
  // indicative". The AI tell is the PREAMBLE shape, which the precise
  // /\bbelow is (?:a|the|my)\b/ further down already matches; the bare
  // duplicate added nothing but false positives. It cost a delivered proposal
  // a real sentence: a rewrite existed only to satisfy this pattern, and it
  // turned that sentence into "The methodology the following provides
  // tailored to the following identified service streams".
  /\bPlease find\b/i,
  /\bat the end of the day\b/i,
  /\bgoing forward\b/i,
  /\bin this day and age\b/i,
  /\bcertainly[!.]/i,
  /\bof course[!.]/i,
  /\bi(?:'d| would) be happy to\b/i,
  /\bi(?:'m| am) pleased to\b/i,
  /\bi(?:'ve| have) prepared\b/i,
  /\bi(?:'ll| will) (?:now\s+)?(?:provide|generate|create|draft|write)\b/i,
  /\bbelow is (?:a|the|my)\b/i,
  /\bplease find (?:attached|below|enclosed)\b/i,
  /\bhere(?:'s| is) (?:a|the|my|your)\b/i,
];

/** Internal working notes and boilerplate that shouldn't be in final text. */
export const INTERNAL_BOILERPLATE_PATTERNS: RegExp[] = [
  /\bsource[-_\s]?id\b/i,
  /\bevidence[-_\s]?id\b/i,
  /\bmatch[-_\s]?score\b/i,
  /\bwin\s+probability\b/i,
  /\bevaluator[-_\s]?score\b/i,
  // Genuine internal-annotation markers only. This was
  // /\b(?:internal\s+(?:use|note|review)|reviewer\s+note)\b/i, whose bare
  // "internal review" alternative fired on ordinary QA-process prose — "quality
  // assurance is applied through independent internal review before any
  // deliverable is issued" is a description of how the firm works, not a
  // working note leaking into a submission. It failed a real technical proposal
  // at HIGH severity, which is a refusal the owner cannot act on because there
  // is nothing wrong with the sentence.
  /\b(?:internal\s+use(?:\s+only)?|internal\s+notes?|for\s+internal\s+review|internal\s+review\s+only|reviewer\s+notes?)\b/i,
  /\btraceability\s+map\b/i,
  /\baudit\s+metadata\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bREFERENCE NEEDED\b/i,
  /\bCHECK SOURCE\b/i,
  /\bVERIFY\b/i,
  /\bPROMPT:\b/i,
  /\bREWRITE\b/i,
];

/** Patterns for generic marketing boilerplate that reduces proposal quality.
 *  Used as a WARNING (>=3 hits) or BLOCKED (>=5 hits) signal. */
export const GENERIC_BOILERPLATE_PATTERNS: RegExp[] = [
  /committed to excellence/i,
  /leading firm in the region/i,
  /team of qualified professionals/i,
  /we look forward to the opportunity/i,
  /we (?:are )?(?:excited|delighted|honou?red) to (?:submit|present|offer)/i,
  /it (?:is|would be) (?:an?\s+)?(?:honou?r|privilege) to/i,
  /\bworld[\s-]class\b/i,
  /\binnovative solutions?\b/i,
  /\bstreamlined operations?\b/i,
  /\benhanced efficiency\b/i,
  /\bbest practices\b/i,
  /\bstate[\s-]of[\s-]the[\s-]art\b/i,
  /\bsecond to none\b/i,
  /\b(?:unparalleled|unmatched|unrivalled|unrivaled)\b/i,
  /\bproven track record\b/i,
  /\bcutting[\s-]edge\b/i,
  /\bsynergi(?:es|stic)\b/i,
];

/** Official-original document patterns — used by multiple gates to identify
 *  rows that require the actual tender-issued source. */
export const OFFICIAL_ORIGINAL_LABEL_PATTERNS: RegExp[] = [
  /\bbid\s+form\b/i,
  /\btender\s+form\b/i,
  /\bdeclaration\s+(?:of|form)\b/i,
  /\bundertaking\b/i,
  /\bintegrity\s+pact\b/i,
  /\bbid\s+bond\b/i,
  /\bbank\s+statement\b/i,
  /\btin\s+cert/i,
  /\bvat\s+cert/i,
  /\btax\s+clearance\b/i,
  /\baudited\s+financial\b/i,
  /\btrade\s+license\b/i,
  /\bbusiness\s+licen/i,
  /\bregistration\s+certificate\b/i,
];
