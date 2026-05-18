/**
 * Per-tender deep-reasoning summary formatter.
 *
 * Reads the metadata persisted by round 6's audit-log emission
 * (the TENDER_DEEP_REASONING_RUN row created at the end of each
 * deep-reasoning generation) and renders it as a human-readable
 * markdown report. The UI can drop this directly into a panel
 * without further formatting; an operator can read it standalone.
 *
 * Pure function — no DB, no AI. Caller fetches the audit row and
 * passes the parsed metadata.
 */

export type DeepReasoningSummaryMetadata = {
  tenderId?: string;
  comprehension?: {
    criteriaCount: number;
    disqualifierCount: number;
    prohibitionCount: number;
    totalWeightAccountedFor: number | null;
  } | null;
  alignment?: {
    alignmentCount: number;
    criterionCoverageCount: number;
  } | null;
  refinement?: {
    applied: boolean;
    iterations: number;
    scoreLift: number;
  };
  telemetry?: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalMs: number;
    elapsedMs: number;
    byStep: Record<string, { count: number; totalMs: number; succeeded: number; failed: number }>;
  };
  qualityScore?: number;
  weakAxes?: string[];
};

export type DeepReasoningSummaryInput = {
  createdAt: Date | string;
  description: string;
  metadata: DeepReasoningSummaryMetadata | null;
};

/**
 * Render a single TENDER_DEEP_REASONING_RUN audit row as markdown.
 * Returns an empty string when the row's metadata is null / empty
 * so the UI can skip displaying anything.
 */
export function formatDeepReasoningRunAsMarkdown(input: DeepReasoningSummaryInput): string {
  if (!input.metadata) return "";
  const m = input.metadata;
  const lines: string[] = [];

  lines.push("# Deep-reasoning generation summary");
  lines.push("");
  const when = typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString();
  lines.push(`_Generated ${when}_`);
  lines.push("");
  lines.push(input.description);

  if (m.comprehension) {
    lines.push("");
    lines.push("## Tender comprehension");
    const totalWeight = m.comprehension.totalWeightAccountedFor;
    lines.push(`- ${m.comprehension.criteriaCount} evaluation criteria${totalWeight !== null ? ` (${totalWeight}% weight accounted for)` : " (no numeric weights stated)"}`);
    lines.push(`- ${m.comprehension.disqualifierCount} disqualifying condition(s)`);
    lines.push(`- ${m.comprehension.prohibitionCount} structural prohibition(s)`);
  }

  if (m.alignment) {
    lines.push("");
    lines.push("## Match-to-criteria alignment");
    lines.push(`- ${m.alignment.alignmentCount} record-criterion pairs scored`);
    lines.push(`- ${m.alignment.criterionCoverageCount} criterion-coverage entries`);
  }

  if (m.refinement) {
    lines.push("");
    lines.push("## Critic-rewriter refinement");
    if (m.refinement.applied) {
      lines.push(`- Applied: ${m.refinement.iterations} critique→rewrite iteration(s)`);
      lines.push(`- Score lift: +${m.refinement.scoreLift}`);
    } else {
      lines.push("- Not applied (initial score already met the threshold OR no iteration improved the score)");
    }
  }

  if (m.qualityScore !== undefined) {
    lines.push("");
    lines.push("## Quality score");
    lines.push(`- Final score: **${m.qualityScore}/100**`);
    if (m.weakAxes && m.weakAxes.length > 0) {
      lines.push(`- Weak axes: ${m.weakAxes.join(", ")}`);
    } else {
      lines.push("- All axes passing");
    }
  }

  if (m.telemetry) {
    lines.push("");
    lines.push("## AI call telemetry");
    const totalSeconds = (m.telemetry.totalMs / 1000).toFixed(1);
    const elapsedSeconds = (m.telemetry.elapsedMs / 1000).toFixed(1);
    lines.push(`- **${m.telemetry.totalCalls} call(s)** totalling **${totalSeconds}s** of AI time (${elapsedSeconds}s wall)`);
    if (m.telemetry.failedCalls > 0) {
      lines.push(`- ⚠️ ${m.telemetry.failedCalls} failed call(s) — check logs for details`);
    }
    const byStep = m.telemetry.byStep ?? {};
    const stepEntries = Object.entries(byStep).filter(([, v]) => v && v.count > 0);
    if (stepEntries.length > 0) {
      lines.push("");
      lines.push("| Step | Calls | Time | Failed |");
      lines.push("|------|-------|------|--------|");
      for (const [step, stats] of stepEntries) {
        const seconds = (stats.totalMs / 1000).toFixed(1);
        const failed = stats.failed > 0 ? `${stats.failed}` : "—";
        lines.push(`| ${step} | ${stats.count} | ${seconds}s | ${failed} |`);
      }
    }
  }

  return lines.join("\n");
}
