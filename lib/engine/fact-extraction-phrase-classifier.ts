export type FactPhraseClass = "STATED" | "NOT_STATED" | "CONDITIONAL" | "REJECTED";

const NOT_STATED = /\b(?:not\s+(?:stated|specified|provided|available)|no\s+information|silent\s+on)\b/i;
const CONDITIONAL = /\b(?:if|unless|subject\s+to|where\s+applicable|when\s+required|may\s+be|required\s+only)\b/i;
const REJECTED = /\b(?:not\s+accepted|shall\s+not|must\s+not|prohibited|ineligible|rejected|not\s+permitted)\b/i;

export function classifyFactExtractionPhrase(value: string | null | undefined): FactPhraseClass {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text || NOT_STATED.test(text)) return "NOT_STATED";
  if (REJECTED.test(text)) return "REJECTED";
  if (CONDITIONAL.test(text)) return "CONDITIONAL";
  return "STATED";
}
