import type { PrismaClient } from "@prisma/client";
import { assertAnalysisReadyForFinalGeneration } from "./engine/analysis-source";
import {
  getTenderGenerationReadiness,
  type GenerationReadinessItem,
  type TenderGenerationReadiness,
} from "./tender-generation-readiness";

/**
 * Prisma's tagged-template methods rely on the PrismaClient instance as `this`.
 * The legacy readiness helper extracts `$queryRaw` into a local variable before
 * invoking it, which can produce PrismaClientValidationError at runtime when the
 * method loses its receiver. This proxy binds Prisma methods while leaving model
 * delegates untouched.
 */
function bindPrismaMethods(client: PrismaClient): PrismaClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function hasBlocker(items: GenerationReadinessItem[], code: string): boolean {
  return items.some((item) => item.code === code);
}

/**
 * Strict production wrapper for generation readiness.
 *
 * It fixes the unbound Prisma raw-query method used by the legacy helper and
 * re-runs the final-analysis gate without fail-open fallbacks. Database/schema
 * errors intentionally propagate so callers return a diagnostic error instead
 * of presenting false empty metrics or a false green readiness state.
 */
export async function getTenderGenerationReadinessStrict(
  client: PrismaClient,
  userId: string,
  tenderId: string,
): Promise<TenderGenerationReadiness | null> {
  const boundClient = bindPrismaMethods(client);
  const readiness = await getTenderGenerationReadiness(boundClient, userId, tenderId);
  if (!readiness) return null;

  const tender = await client.tender.findFirst({
    where: { id: tenderId, userId },
    select: { notes: true },
  });
  if (!tender) return null;

  // Fail closed: if the analysis-source query fails, the exception propagates.
  // If the analysis is not eligible, ensure the strict result is blocked even
  // when the legacy helper's defensive catch returned an optimistic answer.
  const analysisGate = await assertAnalysisReadyForFinalGeneration(client, tenderId, tender);
  if (analysisGate.ok) return readiness;

  const blocker: GenerationReadinessItem = {
    code: analysisGate.code,
    message: `Full proposal generation is blocked: ${analysisGate.message}`,
    nextAction: analysisGate.nextAction,
  };

  const fullProposalBlockers = hasBlocker(readiness.fullProposalBlockers, blocker.code)
    ? readiness.fullProposalBlockers
    : [blocker, ...readiness.fullProposalBlockers];

  return {
    ...readiness,
    ready: false,
    fullProposalReady: false,
    fullProposalBlockers,
  };
}
