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

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const MAX_CHARS_PER_CHUNK = 12000;
const MAX_CHUNKS_PER_REPAIR = 10;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function chunkText(text: string): string[] {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length && chunks.length < MAX_CHUNKS_PER_REPAIR; i += MAX_CHARS_PER_CHUNK) {
    chunks.push(normalized.slice(i, i + MAX_CHARS_PER_CHUNK));
  }
  return chunks;
}

function parseJsonObject(text: string): unknown {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI extraction did not return JSON");
  return JSON.parse(text.slice(first, last + 1));
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
    }).filter((expert) => expert.fullName.length >= 5 && expert.sourceQuote.length >= 10 && expert.confidence >= 0.55),
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
    }).filter((project) => project.name.length >= 8 && project.sourceQuote.length >= 10 && project.confidence >= 0.55),
    warnings: normalizeStringArray(raw.warnings),
  };
}

function merge<T extends { confidence: number }>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item).toLowerCase();
    const current = map.get(key);
    if (!current || item.confidence > current.confidence) map.set(key, item);
  }
  return [...map.values()];
}

export function isCompanyKnowledgeAIEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function extractCompanyKnowledgeWithAI(params: {
  expertText: string;
  projectText: string;
}): Promise<AIKnowledgeExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { experts: [], projects: [], warnings: ["ANTHROPIC_API_KEY is not configured; AI extraction skipped."] };

  const client = new Anthropic({ apiKey });
  const chunks = [
    ...chunkText(params.expertText).map((content, index) => ({ kind: "EXPERT_CV", index, content })),
    ...chunkText(params.projectText).map((content, index) => ({ kind: "PROJECT_REFERENCE", index, content })),
  ].slice(0, MAX_CHUNKS_PER_REPAIR);

  const allExperts: AIExpertDraft[] = [];
  const allProjects: AIProjectDraft[] = [];
  const warnings: string[] = [];

  for (const chunk of chunks) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [{
        role: "user",
        content: `You are a strict tender company-knowledge extraction engine.

Extract only facts that are explicitly present in the supplied text. Do not infer, guess, complete, rewrite, or invent anything.

Return only valid JSON with this exact structure:
{
  "experts": [
    {
      "fullName": "exact expert/person name",
      "title": "exact title/position if present, else null",
      "yearsExperience": number or null,
      "disciplines": ["explicit disciplines only"],
      "sectors": ["explicit sectors only"],
      "certifications": ["explicit certifications only"],
      "sourceQuote": "short exact quote proving this record",
      "confidence": number from 0 to 1
    }
  ],
  "projects": [
    {
      "name": "exact project/assignment name",
      "clientName": "exact client if present, else null",
      "country": "exact country if present, else null",
      "sector": "explicit sector/type if present, else null",
      "serviceAreas": ["explicit services only"],
      "contractValue": number or null,
      "currency": "currency code if present, else null",
      "summary": "one factual sentence using only the text, else null",
      "sourceQuote": "short exact quote proving this record",
      "confidence": number from 0 to 1
    }
  ],
  "warnings": ["anything important that could not be safely extracted"]
}

Hard rules:
- If the chunk is CV text, extract experts only unless project records are clearly present.
- If the chunk is project portfolio/reference text, extract projects only unless expert CV records are clearly present.
- Do not use project names as expert names.
- Do not use expert names as project names.
- Exclude records if you cannot quote evidence for the name.
- Confidence must be below 0.55 for uncertain records.

CHUNK TYPE: ${chunk.kind}
CHUNK INDEX: ${chunk.index}

TEXT:
${chunk.content}`,
      }],
    });

    const text = message.content[0]?.type === "text" ? message.content[0].text : "";
    try {
      const normalized = normalizeExtraction(parseJsonObject(text));
      allExperts.push(...normalized.experts);
      allProjects.push(...normalized.projects);
      warnings.push(...normalized.warnings);
    } catch (error) {
      warnings.push(`AI extraction JSON parse failed for ${chunk.kind} chunk ${chunk.index}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return {
    experts: merge(allExperts, (item) => item.fullName),
    projects: merge(allProjects, (item) => item.name),
    warnings,
  };
}
