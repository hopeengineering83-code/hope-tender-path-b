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
    "connect-src 'self' https://*.googleapis.com https://*.mistral.ai https://*.openai.com https://*.anthropic.com https://*.groq.com https://*.openrouter.ai",
  ].join("; ");
}
