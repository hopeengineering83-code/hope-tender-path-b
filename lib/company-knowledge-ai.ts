import { GoogleGenerativeAI } from "@google/generative-ai";

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

const MAX_CHARS_PER_CHUNK = 12_000;
const MAX_CHUNKS = 10;
const MIN_CONFIDENCE = 0.55;

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
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch { /* fall through */ }
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
    }).filter((e) => e.fullName.length >= 5 && e.sourceQuote.length >= 10 && e.confidence >= MIN_CONFIDENCE),
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
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function extractCompanyKnowledgeWithAI(params: {
  expertText: string;
  projectText: string;
}): Promise<AIKnowledgeExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { experts: [], projects: [], warnings: ["GEMINI_API_KEY is not configured; AI extraction skipped."] };
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });

  const expertChunks = chunkText(params.expertText).map((content, index) => ({ kind: "EXPERT_CV" as const, index, content }));
  const projectChunks = chunkText(params.projectText).map((content, index) => ({ kind: "PROJECT_REFERENCE" as const, index, content }));
  const chunks = [...expertChunks, ...projectChunks].slice(0, MAX_CHUNKS);

  const allExperts: AIExpertDraft[] = [];
  const allProjects: AIProjectDraft[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    const isExpertChunk = chunk.kind === "EXPERT_CV";
    const prompt = `You are a strict tender company-knowledge extraction engine for an engineering consultancy.

Extract ONLY facts explicitly present in the text. Never infer, guess, or invent anything.

Return ONLY valid JSON with this structure:
{
  "experts": [${isExpertChunk ? `
    {
      "fullName": "exact name",
      "title": "exact title or null",
      "yearsExperience": number or null,
      "disciplines": ["explicit disciplines only"],
      "sectors": ["explicit sectors only"],
      "certifications": ["explicit certifications only"],
      "sourceQuote": "verbatim quote proving this record (≤500 chars)",
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
      "sourceQuote": "verbatim quote proving this record (≤500 chars)",
      "confidence": 0.0-1.0
    }` : ""}
  ],
  "warnings": ["anything that could not be safely extracted"]
}

Rules:
- ${isExpertChunk ? "Extract EXPERTS only from this CV chunk. Leave projects array empty." : "Extract PROJECTS only from this portfolio chunk. Leave experts array empty."}
- Exclude records where confidence < 0.55 or sourceQuote is missing.
- Do NOT mix expert names and project names.

CHUNK TYPE: ${chunk.kind} (index ${chunk.index})

TEXT:
${chunk.content}`;

    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const normalized = normalizeExtraction(parseJsonFromResponse(text));
      allExperts.push(...normalized.experts);
      allProjects.push(...normalized.projects);
      warnings.push(...normalized.warnings);
    } catch (error) {
      warnings.push(`AI extraction failed for ${chunk.kind} chunk ${chunk.index}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return {
    experts: merge(allExperts, (item) => item.fullName),
    projects: merge(allProjects, (item) => item.name),
    warnings,
  };
}
