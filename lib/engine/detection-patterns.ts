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
  /\bTBD\b/,
  /\bXXX\b/,
  /\bTODO\b/,
  /\bFIXME\b/,
];

export const AI_TRACE_PATTERNS: RegExp[] = [
  /as an ai/i,
  /\bas a language model\b/i,
  /\bas a large language\b/i,
  /\bi cannot\b/i,
  /I don'?t have access/i,
  /I'?m sorry,? I/i,
  /my\s+knowledge\s+cutoff/i,
  /my\s+training\s+data/i,
  /I\s+was\s+trained/i,
  /\bChatGPT\b/i,
  /GPT-[3-4]/i,
  /certainly!\s*I\s+can\s+help/i,
];
