import fs from "fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content, "utf8");
}

function replaceOnce(source, search, replacement, label) {
  if (source.includes(replacement)) return source;
  if (!source.includes(search)) {
    throw new Error(`[patch-resumable-ai-analyze] Could not find patch target: ${label}`);
  }
  return source.replace(search, replacement);
}

function patchAiLibrary() {
  const path = "lib/ai.ts";
  let source = read(path);
  // Early-exit: all changes already integrated into the source file
  if (source.includes("chunkResults: AnalysisChunkCacheEntry[]")) {
    console.log("[patch-resumable-ai-analyze] patchAiLibrary: already applied, skipping.");
    return;
  }

  source = replaceOnce(
    source,
`export type AnalysisWithMeta = {
  result: AIAnalysisResult;
  isPartial: boolean;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  skippedChunks: number; // stopped by deadline
  chunkProviders: Array<string | null>; // provider that succeeded per chunk (null = failed/skipped)
};`,
`export type AnalysisChunkCacheEntry = {
  index: number;
  result: AIAnalysisResult;
  provider?: string | null;
};

export type AnalysisWithMeta = {
  result: AIAnalysisResult;
  isPartial: boolean;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  skippedChunks: number; // stopped by deadline
  chunkProviders: Array<string | null>; // provider that succeeded per chunk (null = failed/skipped)
  chunkResults: AnalysisChunkCacheEntry[]; // successful per-chunk results, persisted for resume
};`,
    "AnalysisWithMeta chunkResults type",
  );

  source = replaceOnce(
    source,
`export async function analyzeWithAI(
  tenderContent: string,
  opts?: { deadlineAt?: number; startFromChunk?: number },
): Promise<AnalysisWithMeta> {`,
`export async function analyzeWithAI(
  tenderContent: string,
  opts?: { deadlineAt?: number; startFromChunk?: number; previousChunkResults?: AnalysisChunkCacheEntry[] },
): Promise<AnalysisWithMeta> {`,
    "analyzeWithAI options",
  );

  source = replaceOnce(
    source,
`    return { result, isPartial: false, totalChunks: 1, completedChunks: 1, failedChunks: 0, skippedChunks: 0, chunkProviders: [chunkProvider] };`,
`    return { result, isPartial: false, totalChunks: 1, completedChunks: 1, failedChunks: 0, skippedChunks: 0, chunkProviders: [chunkProvider], chunkResults: [{ index: 0, result, provider: chunkProvider }] };`,
    "single chunk return",
  );

  source = replaceOnce(
    source,
`  const successesWithIdx: Array<{ index: number; result: AIAnalysisResult }> = [];
  const failures: string[] = [];
  const chunkProviders: Array<string | null> = Array(chunks.length).fill(null);
  let completedChunks = 0;
  let failedChunks = 0;
  let skippedChunks = 0;

  const startIndex = opts?.startFromChunk ?? 0;
  const queue = chunks
    .map((content, index) => ({ content, index }))
    .filter((c) => c.index >= startIndex);`,
`  const previousChunkResults = (opts?.previousChunkResults ?? [])
    .filter((entry): entry is AnalysisChunkCacheEntry => {
      return Number.isInteger(entry?.index)
        && entry.index >= 0
        && entry.index < chunks.length
        && Boolean(entry.result?.summary)
        && Array.isArray(entry.result?.requirements);
    })
    .sort((a, b) => a.index - b.index);
  const previousIndexes = new Set(previousChunkResults.map((entry) => entry.index));
  const successesWithIdx: Array<{ index: number; result: AIAnalysisResult }> = previousChunkResults.map((entry) => ({ index: entry.index, result: entry.result }));
  const failures: string[] = [];
  const chunkProviders: Array<string | null> = Array(chunks.length).fill(null);
  for (const entry of previousChunkResults) chunkProviders[entry.index] = entry.provider ?? null;
  let completedChunks = previousChunkResults.length;
  let failedChunks = 0;
  let skippedChunks = 0;

  const startIndex = Math.max(opts?.startFromChunk ?? 0, previousChunkResults.length > 0 ? Math.max(...previousChunkResults.map((entry) => entry.index)) + 1 : 0);
  const queue = chunks
    .map((content, index) => ({ content, index }))
    .filter((c) => c.index >= startIndex && !previousIndexes.has(c.index));`,
    "multi chunk resume queue",
  );

  source = replaceOnce(
    source,
`  const sortedSuccesses = successesWithIdx
    .sort((a, b) => a.index - b.index)
    .map((s) => s.result);

  const result = mergeAnalysisResults(sortedSuccesses);
  return { result, isPartial, totalChunks: chunks.length, completedChunks, failedChunks, skippedChunks, chunkProviders };`,
`  const chunkResults: AnalysisChunkCacheEntry[] = successesWithIdx
    .sort((a, b) => a.index - b.index)
    .map((s) => ({ index: s.index, result: s.result, provider: chunkProviders[s.index] ?? null }));
  const sortedSuccesses = chunkResults.map((s) => s.result);

  const result = mergeAnalysisResults(sortedSuccesses);
  return { result, isPartial, totalChunks: chunks.length, completedChunks, failedChunks, skippedChunks, chunkProviders, chunkResults };`,
    "multi chunk return with cache",
  );

  write(path, source);
}

function routeHelper() {
  return `
function parseAiAnalyzeJobOutput(output: string | null | undefined): Record<string, unknown> | null {
  if (!output) return null;
  return safeParseJsonObject(output);
}

function normalizePreviousChunkResults(raw: unknown): Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> {
  if (!Array.isArray(raw)) return [];
  const cleaned: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const result = row.result as AIAnalysisResult | undefined;
    if (!Number.isInteger(row.index) || !result || typeof result.summary !== "string" || !Array.isArray(result.requirements)) continue;
    cleaned.push({ index: row.index as number, result, provider: typeof row.provider === "string" ? row.provider : null });
  }
  return cleaned.sort((a, b) => a.index - b.index);
}
`;
}

function resumeBootstrapBlock() {
  return `  const reqUrl = new URL(req.url);
  const force = reqUrl.searchParams.get("force") === "true";
  let continueJobId: string | null = reqUrl.searchParams.get("continue");
  let startFromChunk: number | undefined;
  let existingContentHash: string | undefined;
  let previousChunkResults: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];
  if (continueJobId) {
    const existingJob = await prisma.aiJob.findFirst({
      where: { id: continueJobId, tenderId: id, userId },
    });
    const savedOutput = parseAiAnalyzeJobOutput(existingJob?.output);
    if (savedOutput) {
      previousChunkResults = normalizePreviousChunkResults(savedOutput.chunkResults);
      startFromChunk = previousChunkResults.length > 0
        ? Math.max(...previousChunkResults.map((entry) => entry.index)) + 1
        : (typeof savedOutput.completedChunks === "number" ? savedOutput.completedChunks : 0);
      existingContentHash = typeof savedOutput.contentHash === "string" ? savedOutput.contentHash : undefined;
    }
  }`;
}

function contentHashResumeBlock() {
  return `        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
        if (!continueJobId && !force) {
          const latestPartialJob = await prisma.aiJob.findFirst({
            where: { tenderId: id, userId, jobType: "AI_ANALYZE", status: "PARTIAL_SUCCESS" },
            orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
          }).catch(() => null);
          const savedOutput = parseAiAnalyzeJobOutput(latestPartialJob?.output);
          if (savedOutput?.contentHash === contentHash) {
            const cachedChunks = normalizePreviousChunkResults(savedOutput.chunkResults);
            if (cachedChunks.length > 0) {
              continueJobId = latestPartialJob?.id ?? null;
              previousChunkResults = cachedChunks;
              startFromChunk = Math.max(...cachedChunks.map((entry) => entry.index)) + 1;
              existingContentHash = contentHash;
            }
          }
        }
        if (existingContentHash && existingContentHash !== contentHash) {
          startFromChunk = undefined;
          previousChunkResults = [];
        }`;
}

function patchAnalyzeRoute() {
  const path = "app/api/tenders/[id]/ai-analyze/route.ts";
  let source = read(path);
  // Early-exit: all changes already integrated into the source file
  if (source.includes("normalizePreviousChunkResults") && source.includes("parseAiAnalyzeJobOutput")) {
    console.log("[patch-resumable-ai-analyze] patchAnalyzeRoute: already applied, skipping.");
    return;
  }

  source = replaceOnce(
    source,
`import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta } from "../../../../../lib/ai";`,
`import { analyzeWithAI, isAIEnabled, type AnalysisWithMeta, type AIAnalysisResult } from "../../../../../lib/ai";`,
    "route import AIAnalysisResult",
  );

  source = replaceOnce(
    source,
`import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";`,
`import { restoreHealthFromDb, persistAllHealthToDb } from "../../../../../lib/ai-provider-health-db";
import { safeParseJsonObject } from "../../../../../lib/safe-json";`,
    "route import safeParseJsonObject",
  );

  source = replaceOnce(
    source,
`function parseAiAnalyzeJobOutput(output: string | null | undefined): Record<string, unknown> | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}`,
`function parseAiAnalyzeJobOutput(output: string | null | undefined): Record<string, unknown> | null {
  if (!output) return null;
  return safeParseJsonObject(output);
}`,
    "route parseAiAnalyzeJobOutput upgrade",
  );

  source = replaceOnce(
    source,
`}

const AI_ANALYSIS_TIMEOUT_MS = (() => {`,
`}
${routeHelper()}
const AI_ANALYSIS_TIMEOUT_MS = (() => {`,
    "route helper insertion",
  );

  const originalBootstrap = `  await prismaReady;
  const { id } = await params;
  const reqUrl = new URL(req.url);
  const force = reqUrl.searchParams.get("force") === "true";
  const continueJobId = reqUrl.searchParams.get("continue");
  let startFromChunk: number | undefined;
  let existingContentHash: string | undefined;
  if (continueJobId) {
    const existingJob = await prisma.aiJob.findFirst({
      where: { id: continueJobId, tenderId: id, userId },
    });
    if (existingJob?.output) {
      try {
        const savedOutput = JSON.parse(existingJob.output) as { completedChunks?: number; contentHash?: string };
        startFromChunk = savedOutput.completedChunks ?? 0;
        existingContentHash = savedOutput.contentHash;
      } catch { /* ignore parse errors — do a full re-run */ }
    }
  }`;

  source = replaceOnce(
    source,
    originalBootstrap,
`  await prismaReady;
  const { id } = await params;
  ${resumeBootstrapBlock().trimStart()}`,
    "streaming resume bootstrap",
  );

  source = replaceOnce(
    source,
`        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
        if (existingContentHash && existingContentHash !== contentHash) {
          startFromChunk = undefined;
        }`,
    contentHashResumeBlock(),
    "streaming content-hash auto resume",
  );

  source = replaceOnce(
    source,
`        emit({ phase: "analyzing", chunk: 1, totalChunks: estimatedChunks, message: \`Analyzing chunk 1 of \${estimatedChunks}…\` });`,
`        const initialChunk = Math.min((startFromChunk ?? 0) + 1, estimatedChunks);
        emit({ phase: "analyzing", chunk: initialChunk, totalChunks: estimatedChunks, resumedFromChunk: startFromChunk ?? 0, message: startFromChunk ? \`Resuming at chunk \${initialChunk} of \${estimatedChunks}…\` : \`Analyzing chunk 1 of \${estimatedChunks}…\` });`,
    "streaming initial progress",
  );

  source = replaceOnce(
    source,
`                analyzeWithAI(tenderContent, { deadlineAt, startFromChunk }),`,
`                analyzeWithAI(tenderContent, { deadlineAt, startFromChunk, previousChunkResults }),`,
    "streaming analyzeWithAI resume cache",
  );

  source = replaceOnce(
    source,
`                  output: JSON.stringify({ isPartial: aiMeta.isPartial, totalChunks: aiMeta.totalChunks, completedChunks: aiMeta.completedChunks, failedChunks: aiMeta.failedChunks, skippedChunks: aiMeta.skippedChunks, chunkProviders: aiMeta.chunkProviders, contentHash, analysisSource: "AI", nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null }),`,
`                  output: JSON.stringify({ isPartial: aiMeta.isPartial, totalChunks: aiMeta.totalChunks, completedChunks: aiMeta.completedChunks, failedChunks: aiMeta.failedChunks, skippedChunks: aiMeta.skippedChunks, chunkProviders: aiMeta.chunkProviders, chunkResults: aiMeta.chunkResults, contentHash, resumedFromJobId: continueJobId, analysisSource: "AI", nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null }),`,
    "streaming output stores chunk results",
  );

  const originalPostBootstrap = `  const reqUrl = new URL(req.url);
  const force = reqUrl.searchParams.get("force") === "true";
  const continueJobId = reqUrl.searchParams.get("continue");
  let startFromChunk: number | undefined;
  let existingContentHash: string | undefined;
  if (continueJobId) {
    const existingJob = await prisma.aiJob.findFirst({
      where: { id: continueJobId, tenderId: id, userId },
    });
    if (existingJob?.output) {
      try {
        const savedOutput = JSON.parse(existingJob.output) as { completedChunks?: number; contentHash?: string };
        startFromChunk = savedOutput.completedChunks ?? 0;
        existingContentHash = savedOutput.contentHash;
      } catch { /* ignore parse errors — do a full re-run */ }
    }
  }`;

  source = replaceOnce(
    source,
    originalPostBootstrap,
    resumeBootstrapBlock(),
    "non-streaming resume bootstrap",
  );

  source = replaceOnce(
    source,
`        // Compute content hash for continuation validation
        const contentHash = crypto.createHash("sha256").update(tenderContent).digest("hex").slice(0, 16);
        // Validate content hash if continuing from a previous job
        if (existingContentHash && existingContentHash !== contentHash) {
          // Content changed — do a full re-run, ignore startFromChunk
          startFromChunk = undefined;
        }`,
`        // Compute content hash for continuation validation and auto-resume discovery
${contentHashResumeBlock().replace(/^/gm, "        ").trimEnd()}`,
    "non-streaming content hash auto resume",
  );

  source = replaceOnce(
    source,
`              analyzeWithAI(tenderContent, { deadlineAt, startFromChunk }),`,
`              analyzeWithAI(tenderContent, { deadlineAt, startFromChunk, previousChunkResults }),`,
    "non-streaming analyzeWithAI resume cache",
  );

  source = replaceOnce(
    source,
`              output: JSON.stringify({
                isPartial: aiMeta.isPartial,
                totalChunks: aiMeta.totalChunks,
                completedChunks: aiMeta.completedChunks,
                failedChunks: aiMeta.failedChunks,
                skippedChunks: aiMeta.skippedChunks,
                chunkProviders: aiMeta.chunkProviders,
                contentHash,
                analysisSource: "AI",
                nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null,
              }),`,
`              output: JSON.stringify({
                isPartial: aiMeta.isPartial,
                totalChunks: aiMeta.totalChunks,
                completedChunks: aiMeta.completedChunks,
                failedChunks: aiMeta.failedChunks,
                skippedChunks: aiMeta.skippedChunks,
                chunkProviders: aiMeta.chunkProviders,
                chunkResults: aiMeta.chunkResults,
                contentHash,
                resumedFromJobId: continueJobId,
                analysisSource: "AI",
                nextAction: aiMeta.isPartial ? "CONTINUE_AI_ANALYSIS" : null,
              }),`,
    "non-streaming output stores chunk results",
  );

  write(path, source);
}

function patchTenderDetailClient() {
  const path = "app/dashboard/tenders/[id]/tender-detail.tsx";
  let source = read(path);
  // Early-exit: all changes already integrated into the source file
  if (source.includes("continueJobId") && source.includes("ai-analyze?continue=")) {
    console.log("[patch-resumable-ai-analyze] patchTenderDetailClient: already applied, skipping.");
    return;
  }

  source = replaceOnce(
    source,
`      const res = await fetch(\`/api/tenders/\${tender.id}/ai-analyze\`, {
        method: "POST",
        headers: { "Accept": "text/event-stream" },
      });`,
`      const analyzeUrl = continueJobId
        ? \`/api/tenders/\${tender.id}/ai-analyze?continue=\${encodeURIComponent(continueJobId)}\`
        : \`/api/tenders/\${tender.id}/ai-analyze\`;
      const res = await fetch(analyzeUrl, {
        method: "POST",
        headers: { "Accept": "text/event-stream" },
      });`,
    "streaming client passes continue job id",
  );

  source = replaceOnce(
    source,
`              if (event.jobId) setContinueJobId(event.jobId);
              done = true;`,
`              if (event.jobId) setContinueJobId(event.jobId);
              done = true;`,
    "noop complete event guard",
  );

  write(path, source);
}

patchAiLibrary();
patchAnalyzeRoute();
patchTenderDetailClient();
console.log("[patch-resumable-ai-analyze] Applied resumable AI Analyze patch.");
