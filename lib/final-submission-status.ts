export type FinalSubmissionStepState = "done" | "blocked" | "unknown";

export type FinalSubmissionInputs = {
  analysisSourceGate?: string | null;
  generationReady?: boolean | null;
  generationBlockerCount?: number | null;
  exportChecked?: boolean | null;
  exportReady?: boolean | null;
};

export type FinalSubmissionStatus = {
  analysis: FinalSubmissionStepState;
  generation: FinalSubmissionStepState;
  exportGate: FinalSubmissionStepState;
  zip: FinalSubmissionStepState;
};

export function getFinalSubmissionStatus(input: FinalSubmissionInputs): FinalSubmissionStatus {
  const analysisBlocked = input.analysisSourceGate === "BLOCKED_REGEX_FALLBACK";
  const generationBlocked = analysisBlocked || (input.generationBlockerCount ?? 0) > 0;
  const generation = input.generationReady && !generationBlocked ? "done" : generationBlocked ? "blocked" : "unknown";
  const exportGate = input.exportChecked ? (input.exportReady ? "done" : "blocked") : "unknown";
  return {
    analysis: analysisBlocked ? "blocked" : "unknown",
    generation,
    exportGate,
    zip: input.exportReady ? "done" : "blocked",
  };
}
