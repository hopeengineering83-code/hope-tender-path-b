import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { getProviderModel, getProviderBaseUrl, readProviderKey, resolveZaiConfiguration } from "@/lib/ai-provider-registry";
import { classifyAiError } from "@/lib/ai-provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Operator-safe description of an HTTP failure, derived from status alone. */
function zaiFailureDetail(status: number): string {
  if (status === 401 || status === 403) return "Z.ai rejected the credential.";
  if (status === 402) return "Z.ai reports the account cannot fund this request.";
  if (status === 429) return "Z.ai is rate limiting this key.";
  if (status >= 500) return "Z.ai returned a server-side error.";
  if (status === 400 || status === 404) return "Z.ai did not accept this model for this key.";
  return `Z.ai returned HTTP ${status}.`;
}

/**
 * Z.ai API Key Diagnostic Endpoint
 * Helps operators diagnose why Z.ai returns "Unknown Model" (HTTP 400
 * code 1211) even when the model name is correct.
 * Admin-only — never exposes the full API key.
 */
export async function GET(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const apiKey = readProviderKey("zai");
  const baseUrl = getProviderBaseUrl("zai");
  const model = getProviderModel("zai", "proposal");
  const resolved = resolveZaiConfiguration("proposal");

  // Presence and length only. The previous version returned the first 8 and
  // last 4 characters, which is a fragment of the live secret in an HTTP
  // response — presence is what a diagnostic actually needs.
  const keyPresence = apiKey ? `SET (${apiKey.length} chars)` : "NOT SET";

  const envProposalModel = process.env.ZAI_PROPOSAL_MODEL?.trim() || "NOT SET";
  const envBaseUrl = process.env.ZAI_BASE_URL?.trim() || "NOT SET (using default)";

  const keyFormatIssues: string[] = [];
  if (apiKey) {
    if (apiKey.length < 20) keyFormatIssues.push("Key is unusually short (<20 chars) — may be truncated");
    if (apiKey.includes(" ")) keyFormatIssues.push("Key contains spaces — may have been copy-pasted with whitespace");
    if (apiKey.startsWith("sk-")) keyFormatIssues.push("Key starts with 'sk-' — this looks like an OpenAI key, NOT a Z.ai key");
    if (apiKey.startsWith("AIza")) keyFormatIssues.push("Key starts with 'AIza' — this looks like a Google/Gemini key, NOT a Z.ai key");
    if (apiKey.startsWith("gsk_")) keyFormatIssues.push("Key starts with 'gsk_' — this looks like a Groq key, NOT a Z.ai key");
  }

  // The configured model is tested first so the diagnostic answers the question
  // an operator actually has ("does MY configuration work?") before reporting on
  // alternatives. The rest are current Z.ai GLM identifiers.
  const modelsToTest = [...new Set([model, "glm-4.7-flash", "glm-4.6", "glm-4.5-flash", "glm-4-flash"])];
  const modelTestResults: Array<{
    model: string;
    status: string;
    httpCode?: number;
    failureCategory?: string;
    detail?: string;
  }> = [];

  if (!apiKey) {
    modelTestResults.push({ model: "N/A", status: "skipped", detail: "ZAI_API_KEY is not set" });
  } else {
    for (const testModel of modelsToTest) {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: testModel,
            messages: [{ role: "user", content: "Reply with: PING" }],
            max_tokens: 5,
            temperature: 0,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          modelTestResults.push({ model: testModel, status: "OK", httpCode: 200 });
        } else {
          // The provider body is classified, never echoed: it can carry request
          // headers, org identifiers, or the key itself back to the client.
          const body = await res.text();
          modelTestResults.push({
            model: testModel,
            status: "FAILED",
            httpCode: res.status,
            failureCategory: classifyAiError(`${res.status} ${body}`),
            detail: zaiFailureDetail(res.status),
          });
        }
      } catch (err) {
        const category = classifyAiError(err);
        modelTestResults.push({
          model: testModel,
          status: "ERROR",
          failureCategory: category,
          detail: category === "TIMEOUT"
            ? "The provider did not respond within 15s."
            : "The request to Z.ai could not be completed.",
        });
      }
    }
  }

  let rootCause = "UNKNOWN";
  let recommendation = "";

  if (!apiKey) {
    rootCause = "ZAI_API_KEY is not set";
    recommendation = "Set ZAI_API_KEY in Vercel env vars. Get a key from https://z.ai";
  } else if (keyFormatIssues.some((i) => i.includes("OpenAI") || i.includes("Google") || i.includes("Groq"))) {
    rootCause = "Wrong API key type — key appears to be from a different provider";
    recommendation = "ZAI_API_KEY contains a key from another provider. Get a Z.ai key from https://z.ai";
  } else {
    const workingModels = modelTestResults.filter((r) => r.status === "OK").map((r) => r.model);
    const categories = new Set(modelTestResults.map((r) => r.failureCategory).filter(Boolean));
    if (workingModels.length === 0) {
      // Classified rather than pattern-matched on provider prose, so each
      // failure mode gets the remedy that actually applies to it.
      if (categories.has("AUTH")) {
        rootCause = "Authentication failed — the Z.ai key is invalid, expired, or not authorized for this account.";
        recommendation = "Z.ai rejected the credential. Generate a new key at https://z.ai and update ZAI_API_KEY.";
      } else if (categories.has("BILLING")) {
        rootCause = "The Z.ai account cannot fund requests — balance or plan is exhausted.";
        recommendation = "Top up or re-activate the Z.ai plan. The key itself is being accepted.";
      } else if (categories.has("RATE_LIMIT")) {
        rootCause = "Z.ai is rate limiting this key.";
        recommendation = "Retry after the provider's window resets. No configuration change is needed.";
      } else if (categories.has("MODEL_UNAVAILABLE")) {
        rootCause = "The key authenticates but none of the tested models are available to it.";
        recommendation = "This key's plan does not grant these GLM models. Check the model entitlements on the Z.ai account, then set ZAI_PROPOSAL_MODEL / ZAI_ANALYSIS_MODEL / ZAI_FAST_MODEL to a granted model. Keep ZAI_BASE_URL at https://api.z.ai/api/paas/v4.";
      } else if (categories.has("PROVIDER_ERROR")) {
        rootCause = "Z.ai returned a server-side error (5xx).";
        recommendation = "This is a provider-side outage, not a configuration fault. Retry later; the chain falls through to the next provider meanwhile.";
      } else if (categories.has("TIMEOUT")) {
        rootCause = "Z.ai did not respond within the diagnostic timeout.";
        recommendation = "Retry. If it persists, the provider is degraded and the chain will fall through to the next provider.";
      } else {
        rootCause = "All model tests failed and the cause could not be classified.";
        recommendation = "Review the failureCategory on each entry in modelTests.";
      }
    } else if (workingModels.includes(model)) {
      rootCause = `Z.ai is working with the configured model (${model}).`;
      recommendation = "Diagnostic succeeded. Z.ai is usable at canonical rank 1.";
    } else {
      rootCause = `The configured model (${model}) is not accessible, but these are: ${workingModels.join(", ")}`;
      recommendation = `Set ZAI_PROPOSAL_MODEL / ZAI_ANALYSIS_MODEL / ZAI_FAST_MODEL to one of: ${workingModels.join(", ")}`;
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "unknown",
    rootCause,
    recommendation,
    configuration: {
      apiKey: keyPresence,
      baseUrl,
      modelReturnedByGuard: model,
      // Whether the app would even attempt Z.ai with this configuration. Before
      // the shape-validation fix this silently reported MODEL_UNSUPPORTED for
      // any current GLM identifier, which is what made rank-1 Z.ai unreachable.
      resolverVerdict: {
        valid: resolved.valid,
        reason: resolved.reason,
        safeMessage: resolved.safeMessage,
      },
      envVars: {
        ZAI_API_KEY: apiKey ? "SET" : "NOT SET",
        ZAI_PROPOSAL_MODEL: envProposalModel,
        ZAI_BASE_URL: envBaseUrl,
      },
      keyFormatIssues,
    },
    modelTests: modelTestResults,
  });
}
