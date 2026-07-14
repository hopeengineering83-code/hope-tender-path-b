/**
 * Maps engine-run errors to safe public response bodies.
 *
 * SECURITY: This function MUST NOT include the raw error.message in any
 * response field. Prisma errors include connection strings (DATABASE_URL),
 * AI provider errors include request bodies and sometimes API keys, and
 * Vercel timeout errors include internal request IDs. The raw error is
 * logged server-side via the caller's catch block; the public response
 * carries only a safe summary, a structured code, and a nextAction.
 *
 * The `detail` field was previously set to `message` (raw error.message) —
 * that was a security leak. It is now omitted entirely. Callers that need
 * server-side diagnostics use `logger.error` + `reportError` (which forward
 * the full error to structured logs and Sentry, not to the client).
 */
export function actionableEngineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Engine failed");
  const lower = message.toLowerCase();

  if (/timeout|timed out|abort|function_invocation_timeout/i.test(message)) {
    return {
      status: 504,
      body: {
        error: "Engine run timed out before completion.",
        code: "ENGINE_TIMEOUT",
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
        error: "Engine run failed because the database layer was unavailable or rejected the operation.",
        code: "ENGINE_DATABASE_ERROR",
        nextAction: "RETRY_AFTER_DATABASE_CHECK",
        hint: "Check DATABASE_URL/Vercel database availability, then retry. If this repeats, open the latest server log for the failed request.",
      },
    };
  }

  if (lower.includes("no tender") || lower.includes("tender not found")) {
    return {
      status: 404,
      body: {
        error: "Tender could not be loaded for engine execution.",
        code: "TENDER_NOT_FOUND",
        nextAction: "OPEN_TENDER_LIST",
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "Engine run failed before completion.",
      code: "ENGINE_FAILED",
      nextAction: "OPEN_EXTRACTION_ANALYSIS_MATCHING_QUALITY",
      hint: "Review Extraction Quality, Analysis Quality, and Matching Quality panels. Check server logs for diagnostic details.",
    },
  };
}
