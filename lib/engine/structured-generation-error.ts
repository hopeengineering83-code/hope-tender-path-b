// Structured error mapping for generation routes (Gap 7).
//
// PROBLEM
// ───────
// `POST /api/tenders/[id]/generate` (and sibling generation endpoints)
// used to return `{ error: "Document generation failed" }` with HTTP 500
// when something failed in the inner pipeline. The UI rendered that as
// the literal text "Generation failed." with no diagnostic ID, no
// failure stage, no next action.
//
// FIX
// ───
// One helper that converts any caught Error/unknown into a structured
// response body the UI can render. Always emits:
//   • code           — short uppercase identifier (timeout, auth, ai, db, etc.)
//   • message        — clean user-facing sentence
//   • nextAction     — actionable hint the UI can render as a button label
//   • diagnosticId   — short request-scoped ID for Vercel log search
//   • failedStage    — caller-supplied stage tag ("AI_RENDER", "DB_WRITE", …)
//   • blockerSummary — optional one-liner explaining the underlying blocker
//
// Sibling helper `actionableEngineError` in lib/engine/actionable-engine-error.ts
// covers the analyse/match pipeline. This one covers generation routes.

export type GenerationErrorBody = {
  success: false;
  code: string;
  message: string;
  nextAction: string;
  diagnosticId: string;
  failedStage: string;
  blockerSummary?: string;
};

export type GenerationErrorMapped = {
  status: number;
  body: GenerationErrorBody;
};

function newDiagnosticId(prefix: string = "gen"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function lower(value: string): string {
  return value.toLowerCase();
}

/**
 * Map an arbitrary caught error into a structured 5xx response body.
 *
 * Resolution order (first match wins):
 *   1. Explicit rate-limit / 429
 *   2. AI provider errors (Anthropic / Gemini / OpenAI)
 *   3. Timeout / aborted
 *   4. DB / Prisma errors
 *   5. Permission / auth
 *   6. Generic 500
 *
 * Caller can override the inferred stage via `failedStage`.
 */
export function mapGenerationError(error: unknown, opts?: {
  failedStage?: string;
  diagnosticId?: string;
  blockerSummary?: string;
}): GenerationErrorMapped {
  const failedStage = opts?.failedStage ?? "GENERATION";
  const diagnosticId = opts?.diagnosticId ?? newDiagnosticId();
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const m = lower(raw);

  // 1. Rate limit
  if (/rate\s*limit|too\s*many\s*requests|429/.test(m)) {
    return {
      status: 429,
      body: {
        success: false,
        code: "RATE_LIMITED",
        message: "Generation hit a provider rate limit. Wait ~60s and retry.",
        nextAction: "RETRY_AFTER_BACKOFF",
        diagnosticId,
        failedStage,
        // SECURITY: blockerSummary is a safe static string, NOT raw error.message.
        // The raw error is logged server-side via the route's catch block.
        blockerSummary: "Provider rate limit reached.",
      },
    };
  }

  // 2. AI provider errors
  if (/anthropic|claude/.test(m)) {
    return {
      status: 502,
      body: {
        success: false,
        code: "AI_PROVIDER_CLAUDE_FAILED",
        message: "Claude (Anthropic) provider failed during generation.",
        nextAction: "RETRY_OR_REDUCE_INPUT",
        diagnosticId,
        failedStage,
        blockerSummary: "Claude (Anthropic) provider error.",
      },
    };
  }
  if (/gemini|google.*generative/.test(m)) {
    return {
      status: 502,
      body: {
        success: false,
        code: "AI_PROVIDER_GEMINI_FAILED",
        message: "Gemini (Google) provider failed during generation.",
        nextAction: "RETRY_OR_REDUCE_INPUT",
        diagnosticId,
        failedStage,
        blockerSummary: "Gemini (Google) provider error.",
      },
    };
  }
  if (/openai|gpt/.test(m)) {
    return {
      status: 502,
      body: {
        success: false,
        code: "AI_PROVIDER_OPENAI_FAILED",
        message: "OpenAI provider failed during generation.",
        nextAction: "RETRY_OR_REDUCE_INPUT",
        diagnosticId,
        failedStage,
        blockerSummary: "OpenAI provider error.",
      },
    };
  }

  // 3. Database — check BEFORE timeout because Prisma connection-pool
  //    errors include the word "timeout" but are really DB issues. The
  //    actionable fix is different (check DB/connection pool, not
  //    "switch to background job"), so DB-specific patterns win.
  if (/prisma|database|connection\s*pool|p1\d{3}|p2\d{3}|sqlstate/.test(m)) {
    return {
      status: 503,
      body: {
        success: false,
        code: "DB_ERROR",
        message: "Database error during generation.",
        nextAction: "RETRY_AFTER_DATABASE_CHECK",
        diagnosticId,
        failedStage,
        blockerSummary: "Database error during generation.",
      },
    };
  }

  // 4. Timeout / abort (Vercel function budget, not DB)
  if (/timeout|timed\s*out|aborted|abort.*signal|abortcontroller/.test(m)) {
    return {
      status: 504,
      body: {
        success: false,
        code: "GENERATION_TIMEOUT",
        message: "Generation exceeded the 60s function budget.",
        nextAction: "RETRY_AS_BACKGROUND_JOB",
        diagnosticId,
        failedStage,
        blockerSummary: "Vercel function exceeded its 60s limit. Use the async background queue (PROPOSAL_GENERATION job) or reduce input size.",
      },
    };
  }

  // 5. Auth / permission
  if (/unauthorized|forbidden|permission|not\s*allowed|access\s*denied/.test(m)) {
    return {
      status: 403,
      body: {
        success: false,
        code: "AUTHZ_FAILED",
        message: "You don't have permission to perform this generation.",
        nextAction: "LOGIN_AGAIN_OR_CHECK_ROLE",
        diagnosticId,
        failedStage,
        blockerSummary: "Permission denied for this operation.",
      },
    };
  }

  // 6. Generic fallback
  return {
    status: 500,
    body: {
      success: false,
      code: "GENERATION_FAILED",
      // SECURITY: do NOT include raw error.message in the public response.
      // The raw error is logged server-side via the route's catch block.
      message: "Document generation failed.",
      nextAction: "RETRY_OR_CONTACT_SUPPORT",
      diagnosticId,
      failedStage,
      blockerSummary: opts?.blockerSummary,
    },
  };
}
