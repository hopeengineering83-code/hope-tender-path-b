import { generateWithFallback, isAIEnabled } from "../ai";
import { logger } from "../observability";
import { sanitizeClientFacingText } from "./client-text-sanitizer";
import { markdownEndsMidSentence } from "./proposal-sections";

export { sanitizeClientFacingText } from "./client-text-sanitizer";

function basicCleanup(text: string): string {
  // Gap 8 — the canonical client-facing sanitiser handles the full
  // list of forbidden AI/provider/internal traces.
  // Centralised exportable-text sanitiser (Gap 8) now also includes
  // legacy AI_PATTERNS pass for performance and consistency.
  let out = sanitizeClientFacingText(text, { preserveTenderQuotes: true });

  // Normalize multiple blank lines
  out = out.replace(/\n{3,}/g, "\n\n");

  // Remove trailing spaces
  out = out.replace(/ +$/gm, "");

  // Trim
  out = out.trim();

  return out;
}

export function humanizeDeterministic(text: string): string {
  return basicCleanup(text);
}

const HUMANIZE_SYSTEM_PROMPT = `You are a senior proposal editor and brand strategist. Your specialization is "Tone & Voice" refinement — transforming stiff, robotic prose into active, persuasive business storytelling. You take draft proposal text written by a junior author or an AI assistant and rewrite it so it sounds like a senior consultant wrote it from scratch — professional, confident, business-grade, evidence-led, and free of AI traces.
Operating Principles:
1. ACTIVE VOICE. Replace "The project was delivered" with "We delivered the project."
2. RHYTHMIC VARIATION. Mix short, punchy sentences with detailed explanations.
3. CONFIDENT MODALITY. Use "will" and "can" instead of "would" or "could".
You preserve every fact in the source text. You never invent new claims, numbers, project names, or expert names. You return only the rewritten text — no commentary, no preamble, no explanation of what you changed.`;

async function humanizeWithAI(text: string): Promise<string> {
  const prompt = `The following text was drafted for a tender proposal. Rewrite it to sound like it was written by a senior consultant — professional, confident, and business-grade.

Rules:
- Remove any AI traces ("As an AI...", "Certainly!", "Of course!", etc.)
- Remove any placeholder text ([INSERT NAME], {date}, TODO, etc.)
- Improve sentence flow and vary structure
- Keep all factual content intact — do not invent or remove facts
- Do not add new sections or headings not in the original
- Return only the rewritten text, no commentary

TEXT TO REWRITE:
${text.slice(0, 6000)}`;

  const result = await generateWithFallback(prompt, { systemPrompt: HUMANIZE_SYSTEM_PROMPT, useCase: "reasoning" });
  return result || text;
}

export async function humanize(text: string): Promise<string> {
  const cleaned = basicCleanup(text);
  if (!isAIEnabled() || cleaned.length < 100) return cleaned;

  try {
    return await humanizeWithAI(cleaned);
  } catch {
    return cleaned;
  }
}

const OPENING_HUMANIZE_SYSTEM_PROMPT = `You are a senior bid director with 25 years of proposal writing experience. You polish the opening two sections of a technical proposal — the Cover Letter and Executive Summary — so they read as if a confident, evidence-led senior consultant wrote them from scratch. You never invent facts. You remove all AI traces. You return ONLY the polished text with the same headings — no commentary, no preamble.`;

function extractSection(markdown: string, headingPattern: RegExp): { text: string; start: number; end: number } | null {
  const lines = markdown.split("\n");
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingPattern.test(lines[i])) { startLine = i; break; }
  }
  if (startLine < 0) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i])) { endLine = i; break; }
  }

  const text = lines.slice(startLine, endLine).join("\n");
  const start = lines.slice(0, startLine).join("\n").length + (startLine > 0 ? 1 : 0);
  const end = start + text.length;
  return { text, start, end };
}

/**
 * Why a polished opening section cannot replace the one it rewrites, or null.
 *
 * The polish is optional: it may only restate what the section already says.
 * A hosted proposal delivered a Cover Letter that broke off mid-sentence
 * ("... stresses healthcare design experience, and mandates"). A rewrite
 * that ends mid-sentence, runs markedly shorter than its original, or drops
 * or adds a number (a count, year, registration or telephone digit) is not a
 * restatement, so the original stays.
 */
export function polishedOpeningProblem(original: string, polished: string): string | null {
  const cut = markdownEndsMidSentence(polished);
  if (cut) return cut;
  if (polished.trim().length < original.trim().length * 0.8) return "markedly shorter than the text it rewrites";
  const numbers = (text: string) => new Set((text.match(/\d[\d,./-]*\d|\d/g) ?? []).map((n) => n.replace(/,/g, "")));
  const before = numbers(original);
  const after = numbers(polished);
  const dropped = [...before].filter((n) => !after.has(n));
  if (dropped.length) return `drops ${dropped.slice(0, 3).join(", ")}`;
  const added = [...after].filter((n) => !before.has(n));
  if (added.length) return `adds ${added.slice(0, 3).join(", ")}`;
  return null;
}

// A cut input can only come back as a cut rewrite.
const OPENING_POLISH_INPUT_LIMIT = 5000;

export async function humanizeOpeningSections(markdown: string): Promise<string> {
  if (!isAIEnabled()) return markdown;

  const coverSection = extractSection(markdown, /^#\s+Cover\s+Letter/i);
  const execSection = extractSection(markdown, /^#\s+Executive\s+Summary/i);

  if (!coverSection && !execSection) return markdown;

  const combined = [coverSection?.text, execSection?.text].filter(Boolean).join("\n\n");
  if (combined.trim().length < 100 || combined.length > OPENING_POLISH_INPUT_LIMIT) return markdown;

  const prompt = `Polish the Cover Letter and Executive Summary below. Keep every fact, project name, expert name, contract value, and client name exactly as-is. Remove AI traces and awkward phrasing. Vary sentence length. Return the same two headings with the polished text under each — nothing else.

${combined}`;

  try {
    const polished = await generateWithFallback(prompt, { systemPrompt: OPENING_HUMANIZE_SYSTEM_PROMPT });
    if (!polished || polished.trim().length < 50) return markdown;

    let result = markdown;
    const polishedCover = extractSection(polished, /^#\s+Cover\s+Letter/i);
    const polishedExec = extractSection(polished, /^#\s+Executive\s+Summary/i);

    const keep = (label: string, original: { text: string } | null, rewrite: { text: string } | null) => {
      if (!original || !rewrite) return false;
      const problem = polishedOpeningProblem(original.text, rewrite.text);
      if (problem) logger.warn(`[humanize] polished ${label} not used (${problem}) — keeping the original.`);
      return !problem;
    };

    if (execSection && polishedExec && keep("Executive Summary", execSection, polishedExec)) {
      const before = result.slice(0, execSection.start);
      const after = result.slice(execSection.end);
      result = before + polishedExec.text + after;
    }
    if (coverSection && polishedCover && keep("Cover Letter", coverSection, polishedCover)) {
      const before = result.slice(0, coverSection.start);
      const after = result.slice(coverSection.end);
      result = before + polishedCover.text + after;
    }
    return result;
  } catch {
    return markdown;
  }
}
