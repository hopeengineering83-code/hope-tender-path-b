import { prisma, prismaReady } from "./prisma";
import { logger } from "./observability";

export interface UsageRecordInput {
  userId: string;
  tenderId?: string | null;
  jobId?: string | null;
  provider: string;
  useCase: string;
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  success: boolean;
  failureCategory?: string | null;
}

export async function recordAiUsage(input: UsageRecordInput): Promise<void> {
  try {
    await prismaReady;
    await prisma.aiUsageRecord.create({
      data: {
        userId: input.userId,
        tenderId: input.tenderId ?? null,
        jobId: input.jobId ?? null,
        provider: input.provider,
        useCase: input.useCase,
        model: input.model ?? null,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        latencyMs: input.latencyMs ?? 0,
        success: input.success,
        failureCategory: input.failureCategory ?? null,
      },
    });
  } catch (e) {
    // Usage tracking is best-effort — never block the AI call path — but
    // surface failures so AI cost/usage tracking gaps are visible to
    // operators. Previously bare `catch {}` — gaps were invisible.
    logger.warn("[ai-usage-tracker] recordAiUsage failed", {
      detail: e,
      provider: input.provider,
      useCase: input.useCase,
      success: input.success,
    });
  }
}

export async function getTenantUsageSummary(
  userId: string,
  since: Date,
): Promise<{
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byProvider: Record<string, { calls: number; tokens: number }>;
}> {
  await prismaReady;
  const records = await prisma.aiUsageRecord.findMany({
    where: { userId, createdAt: { gte: since } },
    select: {
      provider: true,
      success: true,
      inputTokens: true,
      outputTokens: true,
    },
  });
  const byProvider: Record<string, { calls: number; tokens: number }> = {};
  let totalCalls = 0,
    successfulCalls = 0,
    failedCalls = 0,
    totalInputTokens = 0,
    totalOutputTokens = 0;
  for (const r of records) {
    totalCalls++;
    if (r.success) successfulCalls++;
    else failedCalls++;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    const p = byProvider[r.provider] ?? { calls: 0, tokens: 0 };
    p.calls++;
    p.tokens += r.inputTokens + r.outputTokens;
    byProvider[r.provider] = p;
  }
  return {
    totalCalls,
    successfulCalls,
    failedCalls,
    totalInputTokens,
    totalOutputTokens,
    byProvider,
  };
}
