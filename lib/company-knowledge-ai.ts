import { generateWithFallback, isAIEnabled } from "./ai";
import { redactSecrets } from "./sanitize-error";

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

// Per Pillar 3: increased from 12K/10 to 24K/20 to avoid silently truncating
// company-document text. The AI provider's token budget is the real limit —
// these caps are safety guards, not data-loss gates. Company-document text
// must be searchable and usable, not represented only by hashes.
const MAX_CHARS_PER_CHUNK = 24_000;
const MAX_CHUNKS = 20;
const MIN_CONFIDENCE = 0.55;
const MIN_EXPERT_CONFIDENCE = 0.65;

const COMPANY_KNOWLEDGE_SYSTEM_PROMPT = `You are a strict tender company-knowledge extraction engine for an engineering consultancy.
Extract ONLY facts explicitly present in the text. Never infer, guess, or invent anything.
Return ONLY valid JSON. No markdown fences, no commentary.
Every expert/project must include a sourceQuote copied from the source text.
When uncertain, lower confidence instead of fabricating.`;


// Credential-bearing patterns this module needs ON TOP of the shared redactor:
// connection-string credentials expressed as query parameters, which are not a
// provider key and so are not the shared redactor's business.
const CONNECTION_CREDENTIAL_REGEX = /(password|user(?:name)?)=([^\s&]+)/gi;

/**
 * Sanitize a provider error before it reaches a user-facing surface.
 *
 * Key redaction is delegated to lib/sanitize-error.ts. The single combined
 * regex that used to live here covered sk-, AIza, Bearer and DSNs — and missed
 * Groq's gsk_, Cerebras' csk_, DeepSeek's dsk- and Google's newer AQ keys, all
 * of which this app actually uses. It was written as a throughput optimisation
 * ("~40% better on large strings"), which is a poor trade on an error path: the
 * cost of the slower version is microseconds on a failure, and the cost of the
 * faster one is a live API key rendered to whoever reads the message.
 */
function sanitizeProviderMessage(value: string | null | undefined): string {
  if (!value) return "unknown error";
  // Truncate first — the result is sliced to 240 anyway, and 500 leaves ample
  // headroom for replacements to expand the string.
  return redactSecrets(value.slice(0, 500))
    .replace(CONNECTION_CREDENTIAL_REGEX, (_m, key: string) => `${key}=[REDACTED]`)
    .slice(0, 240);
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(String(item))).filter(Boolean).slice(0, 12);
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
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { /* fall through */ }
  }
  throw new Error("AI extraction did not return valid JSON");
}

function normalizeExtraction(value: unknown): AIKnowledgeExtraction {
  const raw = value as Record<string, unknown>;
  const experts = Array.isArray(raw.experts) ? raw.experts : [];
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  return {
    experts: experts.map((item) => {
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
    }).filter((e) => {
      if (e.fullName.length < 5 || e.sourceQuote.length < 10) return false;
      if (e.confidence < MIN_EXPERT_CONFIDENCE) return false;
      const lastWord = e.fullName.split(/\s+/).pop()?.toLowerCase() ?? "";
      if (/^(senior|junior|principal|chief|lead|head|associate|assistant|deputy|registered|certified|licensed|funded)$/.test(lastWord)) return false;
      const parts = e.fullName.trim().split(/\s+/).filter((w) => /^[A-Za-z.'-]{2,}$/.test(w));
      return parts.length >= 2;
    }),
    projects: projects.map((item) => {
      const obj = item as Record<string, unknown>;
      return {
        name: clean(String(obj.name ?? "")),
        clientName: obj.clientName ? clean(String(obj.clientName)) : null,
        country: obj.country ? clean(String(obj.country)) : null,
        sector: obj.sector ? clean(String(obj.sector)) : null,
        serviceAreas: normalizeStringArray(obj.serviceAreas),
        contractValue: normalizeNumber(obj.contractValue),
        currency: obj.currency ? clean(String(obj.currency)).slice(0, 8).toUpperCase() : null,
        summary: obj.summary ? clean(String(obj.summary)).slice(0, 600) : null,
        sourceQuote: clean(String(obj.sourceQuote ?? "")).slice(0, 1600),
        confidence: normalizeConfidence(obj.confidence),
      };
    }).filter((p) => p.name.length >= 8 && p.sourceQuote.length >= 10 && p.confidence >= MIN_CONFIDENCE),
    warnings: normalizeStringArray(raw.warnings),
  };
}

function merge<T extends { confidence: number }>(items: T[], keyFn: (item: T) => string): T[] {
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
  for (let i = 0; i < normalized.length && chunks.length < MAX_CHUNKS; i += MAX_CHARS_PER_CHUNK) {
    chunks.push(normalized.slice(i, i + MAX_CHARS_PER_CHUNK));
  }
  return chunks;
}

export function isCompanyKnowledgeAIEnabled(): boolean {
  return isAIEnabled();
}

function buildExtractionPrompt(chunk: { kind: "EXPERT_CV" | "PROJECT_REFERENCE"; index: number; content: string }) {
  const isExpertChunk = chunk.kind === "EXPERT_CV";
  return `Return ONLY valid JSON with this structure:
{
  "experts": [${isExpertChunk ? `
    {
      "fullName": "exact personal name of a human being",
      "title": "exact job title or null",
      "yearsExperience": number or null,
      "disciplines": ["explicit disciplines only"],
      "sectors": ["explicit sectors only"],
      "certifications": ["explicit certifications only"],
      "sourceQuote": "verbatim quote proving this person (≤500 chars)",
      "confidence": 0.0-1.0
    }` : ""}
  ],
  "projects": [${!isExpertChunk ? `
    {
      "name": "exact project name",
      "clientName": "exact client or null",
      "country": "exact country or null",
      "sector": "explicit sector or null",
      "serviceAreas": ["explicit services only"],
      "contractValue": number or null,
      "currency": "currency code or null",
      "summary": "one factual sentence or null",
      "sourceQuote": "verbatim quote proving this project (≤500 chars)",
      "confidence": 0.0-1.0
    }` : ""}
  ],
  "warnings": ["anything that could not be safely extracted"]
}

Rules:
- ${isExpertChunk
    ? `Extract EXPERTS only. Leave projects array empty.
- fullName MUST be a real human personal name.
- fullName MUST NOT be a project name, location, company, region, city, organization, or position title.`
    : `Extract PROJECTS only. Leave experts array empty.
- A project is a specific assignment, contract, or job the firm performed.
- Extract project experience from work history, assignments, contracts, reference letters, and CV project lists.`}
- Exclude records where confidence < 0.55 or sourceQuote is missing.
- Never output facts not explicitly present in the text.

CHUNK TYPE: ${chunk.kind} (index ${chunk.index})

TEXT:
${chunk.content}`;
}

export async function extractCompanyKnowledgeWithAI(params: {
  expertText: string;
  projectText: string;
}): Promise<AIKnowledgeExtraction> {
  if (!isAIEnabled()) {
    return { experts: [], projects: [], warnings: ["No AI provider configured; set any of: ZAI_API_KEY, CEREBRAS_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, or ANTHROPIC_API_KEY. All 10 providers are automatic. AI extraction skipped."] };
  }

  const expertChunks = chunkText(params.expertText).slice(0, MAX_CHUNKS).map((content, index) => ({ kind: "EXPERT_CV" as const, index, content }));
  const projectChunks = chunkText(params.projectText).slice(0, MAX_CHUNKS).map((content, index) => ({ kind: "PROJECT_REFERENCE" as const, index, content }));
  const chunks = [...expertChunks, ...projectChunks];

  const allExperts: AIExpertDraft[] = [];
  const allProjects: AIProjectDraft[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    const isExpertChunk = chunk.kind === "EXPERT_CV";
    try {
      const text = await generateWithFallback(buildExtractionPrompt(chunk), {
        systemPrompt: COMPANY_KNOWLEDGE_SYSTEM_PROMPT,
      });
      const normalized = normalizeExtraction(parseJsonFromResponse(text));
      if (isExpertChunk) {
        allExperts.push(...normalized.experts);
        if (normalized.projects.length > 0) warnings.push(`Discarded ${normalized.projects.length} project record(s) from EXPERT_CV chunk ${chunk.index} (category enforcement).`);
      } else {
        allProjects.push(...normalized.projects);
        if (normalized.experts.length > 0) warnings.push(`Discarded ${normalized.experts.length} expert record(s) from PROJECT_REFERENCE chunk ${chunk.index} (category enforcement).`);
      }
      warnings.push(...normalized.warnings);
    } catch (error) {
      warnings.push(`AI extraction failed for ${chunk.kind} chunk ${chunk.index}: ${sanitizeProviderMessage(error instanceof Error ? error.message : "unknown error")}`);
    }
  }

  return {
    experts: merge(allExperts, (item) => item.fullName),
    projects: merge(allProjects, (item) => item.name),
    warnings,
  };
}
