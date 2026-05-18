/**
 * Deep-reasoning telemetry collector.
 *
 * Tracks AI calls + durations + success/failure across the
 * deep-reasoning pipeline (comprehension, alignment, critique,
 * rewrite, tool-use). Designed for a single per-tender lifecycle:
 * create an instance at generation start, pass it to each
 * deep-reasoning module, format a human-readable summary at the
 * end. No global state, no persistence — telemetry is logged
 * once per tender and discarded.
 *
 * Why this exists: each deep-reasoning iteration adds 2 Claude
 * calls (critique + rewrite). On a tender that hits two iterations
 * with comprehension + alignment, total per-tender Claude calls
 * jump from 1 to ~7. Without per-step tracking, operators have no
 * visibility into where the cost is going. This collector lets
 * the generator log a single line:
 *
 *   [deep-reasoning] tender XYZ used 7 Claude calls totalling 42.3s:
 *     comprehension (1x, 4.1s), alignment (1x, 5.8s),
 *     critique (2x, 14.2s), rewrite (2x, 17.6s), tools (0x, 0s).
 *
 * Pure in-process accounting — no telemetry leaves the process
 * boundary. If you want centralised cost tracking, ship the
 * `format()` output to your log aggregator.
 */

export type TelemetryStep =
  | "comprehension"
  | "alignment"
  | "critique"
  | "critique-with-tools"
  | "rewrite"
  | "tools"
  | "other";

export type TelemetryRecord = {
  step: TelemetryStep;
  durationMs: number;
  succeeded: boolean;
  /** Optional small metadata bag for the call. Keep values short. */
  metadata?: Record<string, string | number>;
};

/**
 * Per-tender collector. Not thread-safe — meant to live inside a
 * single async generation pipeline.
 */
export class DeepReasoningTelemetry {
  private records: TelemetryRecord[] = [];
  private startedAt = Date.now();

  /**
   * Record a completed call. Use `track()` for the common
   * wrap-and-time pattern instead of calling this directly.
   */
  record(record: TelemetryRecord): void {
    this.records.push(record);
  }

  /**
   * Wrap an async call, time it, and record the result. Errors
   * propagate to the caller after recording a failed entry.
   */
  async track<T>(step: TelemetryStep, fn: () => Promise<T>, metadata?: Record<string, string | number>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      this.records.push({
        step,
        durationMs: Date.now() - startedAt,
        succeeded: true,
        metadata,
      });
      return result;
    } catch (err) {
      this.records.push({
        step,
        durationMs: Date.now() - startedAt,
        succeeded: false,
        metadata,
      });
      throw err;
    }
  }

  /**
   * Read-only snapshot of recorded steps. Exposed for tests and
   * advanced consumers; most callers should use `summary()` or
   * `format()` instead.
   */
  getRecords(): readonly TelemetryRecord[] {
    return this.records;
  }

  /**
   * Aggregate metrics. `byStep[step]` is null when no calls of
   * that step were recorded — distinguishes "ran zero times" from
   * "ran with zero duration".
   */
  summary(): {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalMs: number;
    elapsedMs: number;
    byStep: Record<TelemetryStep, { count: number; totalMs: number; succeeded: number; failed: number } | null>;
  } {
    const byStep: Record<TelemetryStep, { count: number; totalMs: number; succeeded: number; failed: number } | null> = {
      comprehension: null,
      alignment: null,
      critique: null,
      "critique-with-tools": null,
      rewrite: null,
      tools: null,
      other: null,
    };
    let totalCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;
    let totalMs = 0;
    for (const record of this.records) {
      totalCalls += 1;
      totalMs += record.durationMs;
      if (record.succeeded) successfulCalls += 1;
      else failedCalls += 1;
      const existing = byStep[record.step] ?? { count: 0, totalMs: 0, succeeded: 0, failed: 0 };
      existing.count += 1;
      existing.totalMs += record.durationMs;
      if (record.succeeded) existing.succeeded += 1;
      else existing.failed += 1;
      byStep[record.step] = existing;
    }
    return {
      totalCalls,
      successfulCalls,
      failedCalls,
      totalMs,
      elapsedMs: Date.now() - this.startedAt,
      byStep,
    };
  }

  /**
   * Human-readable summary line for logging. Returns an empty
   * string when nothing was recorded — the caller can simply
   * skip the log line.
   */
  format(): string {
    if (this.records.length === 0) return "";
    const s = this.summary();
    const parts: string[] = [];
    const orderedSteps: TelemetryStep[] = ["comprehension", "alignment", "critique-with-tools", "critique", "rewrite", "tools", "other"];
    for (const step of orderedSteps) {
      const entry = s.byStep[step];
      if (!entry) continue;
      const seconds = (entry.totalMs / 1000).toFixed(1);
      const failedTag = entry.failed > 0 ? ` failed=${entry.failed}` : "";
      parts.push(`${step} (${entry.count}x, ${seconds}s${failedTag})`);
    }
    const totalSeconds = (s.totalMs / 1000).toFixed(1);
    const elapsedSeconds = (s.elapsedMs / 1000).toFixed(1);
    return `[deep-reasoning-telemetry] ${s.totalCalls} call(s) totalling ${totalSeconds}s of AI time (${elapsedSeconds}s wall): ${parts.join(", ")}.`;
  }
}
