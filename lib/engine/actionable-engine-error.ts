function shortDetail(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
}

function withDetail(summary: string, message: string): string {
  const detail = shortDetail(message);
  return detail ? `${summary} Detail: ${detail}` : summary;
}

export function actionableEngineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Engine failed");
  const lower = message.toLowerCase();

  if (/timeout|timed out|abort|function_invocation_timeout/i.test(message)) {
    return {
      status: 504,
      body: {
        error: withDetail("Engine run timed out before completion.", message),
        code: "ENGINE_TIMEOUT",
        detail: message,
        // For Vercel Hobby (60s function cap) the right answer for large
        // tenders is always the async queue, not "retry sync". The
        // ENGINE_RUN job handler runs in its own 60s budget AND can be
        // split across multiple worker invocations if needed.
        nextAction: "RETRY_AS_BACKGROUND_JOB",
        hint: "Click \"Run in background\" — the async ENGINE_RUN job has its own 60s function budget per chunk and survives chunked sub-jobs. For very large tenders this is the only reliable path on Vercel Hobby.",
      },
    };
  }

  if (/database|prisma|connection|prepared statement|transaction/i.test(message)) {
    return {
      status: 503,
      body: {
        error: withDetail("Engine run failed because the database layer was unavailable or rejected the operation.", message),
        code: "ENGINE_DATABASE_ERROR",
        detail: message,
        nextAction: "RETRY_AFTER_DATABASE_CHECK",
        hint: "Check DATABASE_URL/Vercel database availability, then retry. If this repeats, open the latest server log for the failed request.",
      },
    };
  }

  if (lower.includes("no tender") || lower.includes("tender not found")) {
    return {
      status: 404,
      body: {
        error: withDetail("Tender could not be loaded for engine execution.", message),
        code: "TENDER_NOT_FOUND",
        detail: message,
        nextAction: "OPEN_TENDER_LIST",
      },
    };
  }

  return {
    status: 500,
    body: {
      error: withDetail("Engine run failed before completion.", message),
      code: "ENGINE_FAILED",
      detail: message,
      nextAction: "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY",
      hint: "Review Extraction Quality, Analysis Quality, and Matching Quality panels. The original server error is included in detail.",
    },
  };
}
