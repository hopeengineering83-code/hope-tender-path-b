/**
 * Shared detection patterns for document quality validation, authority review,
 * and proposal scoring. Single source of truth so all three gates agree on
 * what constitutes a placeholder or AI-trace in final proposal output.
 */

export const PLACEHOLDER_PATTERNS: RegExp[] = [
  // Template fill-in brackets
  /\[insert [^\]]+\]/i,
  /\[TBD\]/i,
  /\[NAME\]/i,
  /\[DATE\]/i,
  /\[PLACEHOLDER[^\]]*\]/i,
  /\[INSERT[^\]]*\]/i,
  /\[COMPANY[^\]]*\]/i,
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
  /\bTBD\b/,
  /\bXXX\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /to\s+be\s+(?:added|filled|completed|provided|confirmed)\b/i,
  /n\/a\s+\(pending\)/i,
];

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
];

// Patterns for generic marketing boilerplate that reduces proposal quality.
// Used as a WARNING (>=3 hits) or BLOCKED (>=5 hits) signal — not a hard
// stop on its own. Exported so the scorer and validator share the same list.
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
