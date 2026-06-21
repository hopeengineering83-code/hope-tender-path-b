export function getProductionCSP(): string {
  // Remove unsafe-eval from the production CSP.
  // Reduce unsafe-inline where possible (currently some required for Next.js/React hydration).
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // Removed 'unsafe-eval'
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.googleusercontent.com",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // AI provider endpoints (canonical registry order): zai, cerebras, mistral,
    // groq, openrouter, gemini(googleapis), openai, together, deepseek, anthropic.
    "connect-src 'self' https://*.googleapis.com https://*.z.ai https://*.cerebras.ai https://*.mistral.ai https://*.groq.com https://*.openrouter.ai https://*.openai.com https://*.together.xyz https://*.deepseek.com https://*.anthropic.com",
  ].join("; ");
}
