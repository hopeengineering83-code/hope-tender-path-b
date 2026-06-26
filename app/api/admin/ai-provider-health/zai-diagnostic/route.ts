import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import { getProviderModel, getProviderBaseUrl, readProviderKey } from "@/lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)} (${apiKey.length} chars)`
    : "NOT SET";

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

  const modelsToTest = ["glm-4-flash", "glm-4-air", "glm-4-plus", "glm-4-coding", "glm-4"];
  const modelTestResults: Array<{ model: string; status: string; httpCode?: number; error?: string }> = [];

  if (!apiKey) {
    modelTestResults.push({ model: "N/A", status: "skipped", error: "ZAI_API_KEY is not set" });
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
          const body = await res.text();
          modelTestResults.push({ model: testModel, status: "FAILED", httpCode: res.status, error: body.slice(0, 300) });
        }
      } catch (err) {
        modelTestResults.push({ model: testModel, status: "ERROR", error: err instanceof Error ? err.message : String(err) });
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
    if (workingModels.length === 0) {
      const all1211 = modelTestResults.every((r) => r.error?.includes("1211"));
      const authFailure = modelTestResults.some((r) => r.httpCode === 401 || r.httpCode === 403);
      if (all1211) {
        rootCause = "API key is valid but NO models are accessible — likely a Coding Plan key on wrong endpoint, or expired key";
        recommendation = "Your Z.ai key cannot access ANY model. If you're on the Coding Plan, set ZAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4 and ZAI_PROPOSAL_MODEL=glm-4-coding. Otherwise get a new key from https://z.ai";
      } else if (authFailure) {
        rootCause = "Authentication failed — API key is invalid or expired";
        recommendation = "Z.ai API returned 401/403. Generate a new key at https://z.ai";
      } else {
        rootCause = "All model tests failed — check error details below";
        recommendation = "Review modelTests array for specific error messages";
      }
    } else if (workingModels.includes("glm-4-flash")) {
      rootCause = "Z.ai API is working correctly with glm-4-flash";
      recommendation = "Diagnostic succeeded. Try 'Test provider chain' again from the AI Health panel.";
    } else {
      rootCause = `glm-4-flash not accessible, but these work: ${workingModels.join(", ")}`;
      recommendation = `Set ZAI_PROPOSAL_MODEL to one of: ${workingModels.join(", ")}`;
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || "unknown",
    rootCause,
    recommendation,
    configuration: {
      apiKeyMasked: maskedKey,
      baseUrl,
      modelReturnedByGuard: model,
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
