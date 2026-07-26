import type { PrismaClient } from "@prisma/client";

export type StageCheckpoint = { stage: string; sourceRevision: string; completedItemIds: string[]; updatedAt: string };

export function parseStageCheckpoint(output: string | null | undefined, stage: string, sourceRevision: string): StageCheckpoint {
  try {
    const parsed = JSON.parse(output ?? "{}") as { checkpoint?: StageCheckpoint };
    if (parsed.checkpoint?.stage === stage && parsed.checkpoint.sourceRevision === sourceRevision && Array.isArray(parsed.checkpoint.completedItemIds)) {
      return { ...parsed.checkpoint, completedItemIds: [...new Set(parsed.checkpoint.completedItemIds.filter((id) => typeof id === "string"))] };
    }
  } catch { /* fail closed to an empty checkpoint */ }
  return { stage, sourceRevision, completedItemIds: [], updatedAt: new Date(0).toISOString() };
}

export async function persistStageCheckpoint(client: PrismaClient, jobId: string, checkpoint: StageCheckpoint): Promise<void> {
  await client.aiJob.update({
    where: { id: jobId },
    data: { output: JSON.stringify({ checkpoint: { ...checkpoint, completedItemIds: [...new Set(checkpoint.completedItemIds)], updatedAt: new Date().toISOString() } }) },
  });
}
