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

  if (/timeout|timed out|abort/i.test(message)) {
    return {
      status: 504,
      body: {
        error: withDetail("Engine run timed out before completion.", message),
        code: "ENGINE_TIMEOUT",
        detail: message,
        nextAction: "RETRY_OR_REDUCE_INPUT",
        hint: "Retry after confirming extraction quality. For very large tenders, reduce duplicate uploads or run AI Analyze first, then Run Engine.",
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
