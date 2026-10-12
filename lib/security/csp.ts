/**
 * Generate a per-request nonce for CSP script-src.
 * Uses Web Crypto API (compatible with both edge and node runtimes).
 */
export function generateCspNonce(): string {
  // Web Crypto API is available in both edge and node runtimes
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convert to base64
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Production CSP with nonce-based script-src.
 * Style-src still requires 'unsafe-inline' because Next.js injects inline styles
 * during hydration that don't carry the nonce.
 */
export function getProductionCSP(nonce?: string): string {
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}'`
    : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    scriptSrc,
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
