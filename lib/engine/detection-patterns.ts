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
  /to\s+be\s+(?:added|filled|completed|provided|confirmed|determined)\b/i,
  /n\/a\s+\(pending\)/i,
  ...METADATA_PLACEHOLDER_PATTERNS,
];

/** Alias for backward compatibility with older modules. */
export const PLACEHOLDER_PATTERNS = DOCUMENT_PLACEHOLDER_PATTERNS;

/** Phrases identifying content as AI-generated.
 *  Merged from proposal-quality-scorer.ts and other gates. */
export const AI_TRACE_PATTERNS: RegExp[] = [
  /as an ai/i,
  /\bi am an ai\b/i,
  /\bas a language model\b/i,
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
  /\bBelow is\b/i,
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
