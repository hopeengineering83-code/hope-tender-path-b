/**
 * lib/company-knowledge-ai.ts
 * Deep AI extraction of company knowledge from document chunks.
 *
 * Architecture:
 *  - Uses Anthropic Claude (claude-3-5-haiku) for structured JSON extraction
 *  - Chunks large documents to stay within context limits
 *  - Enforces strict category separation: CV chunks → experts only, project chunks → projects only
 *  - Requires sourceQuote for every record (no unanchored extractions)
 *  - Confidence < 0.55 is dropped automatically
 *  - Merges duplicates by name, keeping highest-confidence record
 */

import Anthropic from "@anthropic-ai/sdk";

export type AIExpertDraft = {
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: string[];
  sectors?: string[];
  certifications?: string[];
  sourceQuote: string;
  confidence: number;
};

export type AIProjectDraft = {
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: string[];
  contractValue?: number | null;
  currency?: string | null;
  summary?: string | null;
  sourceQuote: string;
  confidence: number;
};

export type AIKnowledgeExtraction = {
  experts: AIExpertDraft[];
  projects: AIProjectDraft[];
  warnings: string[];
};

const EXTRACT_MODEL = "claude-3-5-haiku-20241022";
const MAX_CHARS_PER_CHUNK = 12_000;
const MAX_CHUNKS = 10;
const MIN_CONFIDENCE = 0.55;

// ─── normalizers ──────────────────────────────────────────────────────────────

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clean(String(item)))
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseJsonFromResponse(text: string): unknown {
  // Try to extract a JSON object from the response
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  throw new Error("AI extraction did not return valid JSON");
}

function normalizeExtraction(value: unknown): AIKnowledgeExtraction {
  const raw = value as Record<string, unknown>;
  const experts = Array.isArray(raw.experts) ? raw.experts : [];
  const projects = Array.isArray(raw.projects) ? raw.projects : [];

  return {
    experts: experts
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          fullName: clean(String(obj.fullName ?? "")),
          title: obj.title ? clean(String(obj.title)) : null,
          yearsExperience: normalizeNumber(obj.yearsExperience),
          disciplines: normalizeStringArray(obj.disciplines),
          sectors: normalizeStringArray(obj.sectors),
          certifications: normalizeStringArray(obj.certifications),
          sourceQuote: clean(String(obj.sourceQuote ?? "")).slice(0, 1200),
          confidence: normalizeConfidence(obj.confidence),
        };
      })
      .filter(
        (e) =>
          e.fullName.length >= 5 &&
          e.sourceQuote.length >= 10 &&
          e.confidence >= MIN_CONFIDENCE,
      ),

    projects: projects
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          name: clean(String(obj.name ?? "")),
          clientName: obj.clientName ? clean(String(obj.clientName)) : null,
          country: obj.country ? clean(String(obj.country)) : null,
          sector: obj.sector ? clean(String(obj.sector)) : null,
          serviceAreas: normalizeStringArray(obj.serviceAreas),
          contractValue: normalizeNumber(obj.contractValue),
          currency: obj.currency
            ? clean(String(obj.currency)).slice(0, 8).toUpperCase()
            : null,
          summary: obj.summary ? clean(String(obj.summary)).slice(0, 600) : null,
          sourceQuote: clean(String(obj.sourceQuote ?? "")).slice(0, 1600),
          confidence: normalizeConfidence(obj.confidence),
        };
      })
      .filter(
        (p) =>
          p.name.length >= 8 &&
          p.sourceQuote.length >= 10 &&
          p.confidence >= MIN_CONFIDENCE,
      ),

    warnings: normalizeStringArray(raw.warnings),
  };
}

function merge<T extends { confidence: number }>(
  items: T[],
  keyFn: (item: T) => string,
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const k = keyFn(item).toLowerCase();
    const current = map.get(k);
    if (!current || item.confidence > current.confidence) map.set(k, item);
  }
  return [...map.values()];
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  for (
    let i = 0;
    i < normalized.length && chunks.length < MAX_CHUNKS;
    i += MAX_CHARS_PER_CHUNK
  ) {
    chunks.push(normalized.slice(i, i + MAX_CHARS_PER_CHUNK));
  }
  return chunks;
}

export function isCompanyKnowledgeAIEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ─── main extraction function ─────────────────────────────────────────────────

/**
 * Extract company knowledge from text.
 *
 * @param params.expertText   - Raw text from CV / staff profile documents
 * @param params.projectText  - Raw text from project portfolio / reference documents
 *
 * Category enforcement is strict:
 *   expertText chunks → only experts extracted (projects ignored)
 *   projectText chunks → only projects extracted (experts ignored)
 */
export async function extractCompanyKnowledgeWithAI(params: {
  expertText: string;
  projectText: string;
}): Promise<AIKnowledgeExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      experts: [],
      projects: [],
      warnings: ["ANTHROPIC_API_KEY is not configured; AI extraction skipped."],
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build chunks with enforced category
  const expertChunks = chunkText(params.expertText).map((content, index) => ({
    kind: "EXPERT_CV" as const,
    index,
    content,
  }));
  const projectChunks = chunkText(params.projectText).map((content, index) => ({
    kind: "PROJECT_REFERENCE" as const,
    index,
    content,
  }));

  const chunks = [...expertChunks, ...projectChunks].slice(0, MAX_CHUNKS);

  const allExperts: AIExpertDraft[] = [];
  const allProjects: AIProjectDraft[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    const isExpertChunk = chunk.kind === "EXPERT_CV";

    const prompt = `You are a strict tender company-knowledge extraction engine for an engineering consultancy.

Extract ONLY facts that are EXPLICITLY present in the supplied text. Never infer, guess, complete, rewrite, or invent anything.

${isExpertChunk ? `THIS IS A CV / STAFF PROFILE CHUNK. Extract ONLY expert records. Do NOT extract project records.` : `THIS IS A PROJECT PORTFOLIO / REFERENCE CHUNK. Extract ONLY project records. Do NOT extract expert records.`}

Return only valid JSON with this exact structure:
{
  ${isExpertChunk ? `"experts": [
    {
      "fullName": "exact expert/person name — REQUIRED",
      "title": "exact title/position if present, else null",
      "yearsExperience": number or null,
      "disciplines": ["explicit disciplines only — do not invent"],
      "sectors": ["explicit sectors only — do not invent"],
      "certifications": ["explicit certifications only — do not invent"],
      "sourceQuote": "short exact verbatim quote from the text proving this person — REQUIRED",
      "confidence": number from 0 to 1
    }
  ],
  "projects": [],` : `"experts": [],
  "projects": [
    {
      "name": "exact project/assignment name — REQUIRED",
      "clientName": "exact client if present, else null",
      "country": "exact country if present, else null",
      "sector": "explicit sector/type if present, else null",
      "serviceAreas": ["explicit services only — do not invent"],
      "contractValue": number or null,
      "currency": "currency code if present, else null",
      "summary": "one factual sentence using only the text, else null",
      "sourceQuote": "short exact verbatim quote from the text proving this project — REQUIRED",
      "confidence": number from 0 to 1
    }
  ],`}
  "warnings": ["anything important that could not be safely extracted"]
}

Hard rules:
- Confidence < 0.55 means omit the record entirely.
- If you cannot quote evidence for a name, omit that record.
- Do not use project names as expert names or vice versa.
- Never hallucinate values. Null is always better than invented data.

CHUNK TYPE: ${chunk.kind}
CHUNK INDEX: ${chunk.index}

TEXT:
${chunk.content}`;

    try {
      const message = await client.messages.create({
        model: EXTRACT_MODEL,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      const block = message.content[0];
      if (!block || block.type !== "text") {
        warnings.push(`Unexpected response type for ${chunk.kind} chunk ${chunk.index}`);
        continue;
      }

      const parsed = parseJsonFromResponse(block.text);
      const normalized = normalizeExtraction(parsed);

      // Enforce category — only accept the type matching the chunk
      if (isExpertChunk) {
        allExperts.push(...normalized.experts);
        // Discard any projects that leaked through
        if (normalized.projects.length > 0) {
          warnings.push(
            `Discarded ${normalized.projects.length} project record(s) found in EXPERT_CV chunk ${chunk.index} (category enforcement).`,
          );
        }
      } else {
        allProjects.push(...normalized.projects);
        if (normalized.experts.length > 0) {
          warnings.push(
            `Discarded ${normalized.experts.length} expert record(s) found in PROJECT_REFERENCE chunk ${chunk.index} (category enforcement).`,
          );
        }
      }

      warnings.push(...normalized.warnings);
    } catch (error) {
      warnings.push(
        `AI extraction failed for ${chunk.kind} chunk ${chunk.index}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return {
    experts: merge(allExperts, (item) => item.fullName),
    projects: merge(allProjects, (item) => item.name),
    warnings,
  };
}
