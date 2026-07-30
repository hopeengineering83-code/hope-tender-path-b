/**
 * Stage Checkpoint Recovery
 *
 * Provides resumable checkpoint state for long-running stages that can
 * exceed the 60-second Vercel function limit. Each stage persists its
 * progress so a worker can resume from the last checkpoint instead of
 * restarting from scratch.
 *
 * Stages: EXTRACT_TEXT, VAULT_INGEST, AI_ANALYZE, ENGINE_RUN, PROPOSAL_GENERATION
 */

export type StageCheckpoint = {
  stage: string;
  sourceRevision: string;
  completedItemIds: string[];
  updatedAt: string;
};

/**
 * Parse a stage checkpoint from a JSON string.
 * Returns a safe default if the string is malformed or the stage/revision
 * doesn't match.
 */
export function parseStageCheckpoint(
  raw: string,
  expectedStage: string,
  expectedRevision: string,
): StageCheckpoint {
  try {
    const parsed = JSON.parse(raw) as { checkpoint?: StageCheckpoint };
    if (
      parsed.checkpoint &&
      parsed.checkpoint.stage === expectedStage &&
      parsed.checkpoint.sourceRevision === expectedRevision
    ) {
      return {
        ...parsed.checkpoint,
        completedItemIds: [...new Set(parsed.checkpoint.completedItemIds)],
      };
    }
  } catch {
    // Malformed JSON — return empty checkpoint
  }
  return {
    stage: expectedStage,
    sourceRevision: expectedRevision,
    completedItemIds: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Serialize a stage checkpoint to a JSON string for persistence.
 */
export function serializeStageCheckpoint(checkpoint: StageCheckpoint): string {
  return JSON.stringify({
    checkpoint: {
      ...checkpoint,
      completedItemIds: [...new Set(checkpoint.completedItemIds)],
      updatedAt: new Date().toISOString(),
    },
  });
}

/**
 * Merge two checkpoints — union the completedItemIds.
 */
export function mergeCheckpoints(
  a: StageCheckpoint,
  b: StageCheckpoint,
): StageCheckpoint {
  if (a.stage !== b.stage || a.sourceRevision !== b.sourceRevision) {
    return a;
  }
  return {
    stage: a.stage,
    sourceRevision: a.sourceRevision,
    completedItemIds: [...new Set([...a.completedItemIds, ...b.completedItemIds])],
    updatedAt: new Date().toISOString(),
  };
}
