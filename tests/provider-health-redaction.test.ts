import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recordProviderFailure, getProviderHealth, resetProviderHealth } from "../lib/ai-provider-health";

describe("Provider Health Redaction", () => {
  it("redaction protects all required key formats", () => {
    resetProviderHealth();

    const errors = [
      "Anthropic: sk-ant-abcdef123456",
      "OpenRouter: sk-or-v1-abcdef123456",
      "OpenAI: sk-abcdef123456",
      "Groq: gsk_abcdef123456",
      "DeepSeek: dsk-abcdef123456",
      "Gemini: AIzaSyAbcdef1234567890abcd",
      "Gemini New: AQabcdef1234567890abcdef1234567890",
      "Bearer: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "Auth: authorization: sk-ant-abcdef123456"
    ];

    for (const msg of errors) {
      recordProviderFailure("mistral", new Error(msg));
      const health = getProviderHealth("mistral");
      const lastMsg = health.lastFailureMessage!;

      assert.ok(!lastMsg.includes("sk-ant-"), `Failed to redact Anthropic in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("sk-or-"), `Failed to redact OpenRouter in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("gsk_"), `Failed to redact Groq in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("dsk-"), `Failed to redact DeepSeek in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("AIza"), `Failed to redact Gemini in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("AQ"), `Failed to redact Gemini New in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("Bearer eyJ"), `Failed to redact Bearer in: ${lastMsg}`);
      assert.ok(!lastMsg.includes("authorization: sk-"), `Failed to redact Auth header in: ${lastMsg}`);

      // Asserts that SOMETHING was redacted, not which placeholder was used.
      // The shared redactor writes [KEY_REDACTED]; the private copy this
      // replaced wrote [REDACTED]. Pinning the exact marker made a correct,
      // strictly-broader redactor look like a regression — the assertions above
      // are the ones that state the actual requirement.
      assert.match(lastMsg, /REDACTED/);
    }
  });
});
