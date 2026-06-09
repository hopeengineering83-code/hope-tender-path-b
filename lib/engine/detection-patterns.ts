/**
 * Shared detection patterns for document quality validation, authority review,
 * and proposal scoring.
 */

export const PLACEHOLDER_PATTERNS = [
  /\[.*?\]/, // [Any square brackets]
  /<.*?>/,   // <Any angle brackets>
  /{.*?}/,   // {Any curly brackets}
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bHACK\b/i,
  /\bINSERT\b/i,
  /\bENTER\s+NAME\b/i,
  /\bMISSING\b/i,
  /\bPENDING\b/i,
  /\bTBD\b/i,
  /\bXXX\b/i,
  /\bN\/A\b/i,
  /_{3,}/,   // ___ underscores
  /\.{4,}/,   // .... dots
  /(\d+)\s*%\s*CONFIDENCE/i, // AI confidence traces
  /AS\s+AN\s+AI\b/i,
  /AI\s+LANGUAGE\s+MODEL\b/i,
  /\[INSERT.*?\]/i,
  /\[COMPANY.*?\]/i,
  /\[CLIENT.*?\]/i,
  /Bid-Team to confirm/i,
  /MISSING_SOURCE/i,
  /\[Bid-Team[^\]]*\]/i,
  /Source-evidence action/i,
];

/**
 * Combines all placeholder patterns into a single regex for efficient scanning.
 */
export const PLACEHOLDER_RE = new RegExp(
  PLACEHOLDER_PATTERNS.map((p) => p.source).join("|"),
  "i"
);

export const AI_TRACE_PATTERNS = [
  /as\s+an\s+ai\b/i,
  /ai\s+language\s+model\b/i,
  /I\s+don't\s+have\s+access\s+to\b/i,
  /my\s+knowledge\s+cutoff\b/i,
  /certainly!\s+I\s+can\s+help\b/i,
  /\b(as an AI|as a language model|I cannot|I don't have access|my training data|I was trained|ChatGPT|GPT-4|Claude|Gemini)\b/i,
  /I'?m sorry,? I/i,
];

export const AI_TRACE_RE = new RegExp(
  AI_TRACE_PATTERNS.map((p) => p.source).join("|"),
  "i"
);
