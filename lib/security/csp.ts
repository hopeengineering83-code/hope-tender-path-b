export function getProductionCSP(): string {
  // Production CSP is emitted from middleware as the single runtime authority.
  // Keep unsafe-eval disabled; unsafe-inline remains temporarily required for
  // Next.js/React hydration and existing inline styles.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
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
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}
