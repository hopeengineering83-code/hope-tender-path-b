export const SAFE_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfDecision = {
  enforce: boolean;
  allowed: boolean;
  reason: string;
};

export type CsrfPolicyInput = {
  method: string;
  pathname: string;
  expectedOrigin: string;
  origin?: string | null;
  referer?: string | null;
  nodeEnv?: string;
  csrfMode?: string | null;
  csrfStrictDev?: string | null;
};

export type RoutedOriginInput = {
  requestUrlOrigin: string;
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

function flag(value?: string | null): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function normalizeMode(value?: string | null): "off" | "origin" {
  const mode = (value ?? "").trim().toLowerCase();
  if (mode === "off") return "off";
  return "origin";
}

function firstForwardedValue(value?: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

/**
 * Derive the origin that the request actually reached.
 *
 * NextRequest.nextUrl may normalize a loopback or reverse-proxy hostname
 * differently from the browser-visible Host header (for example localhost vs
 * 127.0.0.1). CSRF must compare against the routed host/protocol, not that
 * normalized internal URL. The client-supplied Origin is never used to build
 * this value.
 *
 * TRUST BOUNDARY — read before deploying behind a reverse proxy:
 *
 *  `x-forwarded-host` and `x-forwarded-proto` are trusted ONLY if every
 *  hop in front of this app overwrites them. On Vercel the platform strips
 *  and re-sets these from the edge, so they are trustworthy. On self-hosted
 *  or misconfigured reverse-proxy setups (nginx without `proxy_set_header
 *  Host`, Cloudflare Workers without origin-protection, etc.) an attacker
 *  controlling both the browser Origin AND these forwarded headers could
 *  pass the same-origin check.
 *
 *  Mitigation: set `CSRF_TRUSTED_HOSTS` to an explicit allowlist (comma-
 *  separated, e.g. "hope.example.com,hope-staging.example.com"). When set,
 *  `deriveRoutedRequestOrigin` will fall back to `requestUrlOrigin` for any
 *  `x-forwarded-host` value that is NOT in the allowlist — effectively
 *  refusing to trust a forwarded header that doesn't match a known-good host.
 */
export function deriveRoutedRequestOrigin(input: RoutedOriginInput): string {
  const fallback = (() => {
    try {
      return new URL(input.requestUrlOrigin).origin;
    } catch {
      return input.requestUrlOrigin;
    }
  })();

  const routedHost = firstForwardedValue(input.forwardedHost) ?? firstForwardedValue(input.host);
  if (!routedHost || /[\\/\s\u0000-\u001f\u007f]/.test(routedHost)) return fallback;

  // TRUST BOUNDARY — when CSRF_TRUSTED_HOSTS is set (production hardening),
  // any x-forwarded-host value NOT in the allowlist is treated as untrusted
  // and the request falls back to its own URL origin. This closes the
  // spoofed-x-forwarded-host attack vector on self-hosted or misconfigured
  // reverse-proxy deployments.
  const trustedHostsEnv = (typeof process !== "undefined" && process.env?.CSRF_TRUSTED_HOSTS) || "";
  if (trustedHostsEnv) {
    const trustedHosts = trustedHostsEnv.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    const routedHostLower = routedHost.toLowerCase();
    // Strip port for comparison (CSRF_TRUSTED_HOSTS can list with or without port)
    const routedHostNoPort = routedHostLower.split(":")[0];
    if (!trustedHosts.includes(routedHostLower) && !trustedHosts.includes(routedHostNoPort)) {
      // Untrusted forwarded host — fall back to the request URL's own origin
      // rather than trusting an attacker-controlled value.
      return fallback;
    }
  }

  const fallbackProtocol = (() => {
    try {
      return new URL(fallback).protocol.slice(0, -1).toLowerCase();
    } catch {
      return "https";
    }
  })();
  const routedProtocol = (firstForwardedValue(input.forwardedProto) ?? fallbackProtocol).toLowerCase();
  if (routedProtocol !== "http" && routedProtocol !== "https") return fallback;

  try {
    return new URL(`${routedProtocol}://${routedHost}`).origin;
  } catch {
    return fallback;
  }
}

export function shouldEnforceCsrf(input: Pick<CsrfPolicyInput, "method" | "pathname" | "nodeEnv" | "csrfMode" | "csrfStrictDev">): boolean {
  if (!input.pathname.startsWith("/api/")) return false;
  if (SAFE_HTTP_METHODS.has(input.method.toUpperCase())) return false;
  const mode = normalizeMode(input.csrfMode);
  if (mode === "off") return false;
  if (input.nodeEnv === "production") return true;
  return flag(input.csrfStrictDev);
}

export function isSameOrigin(origin: string | null | undefined, referer: string | null | undefined, expectedOrigin: string): boolean {
  if (origin) return origin === expectedOrigin;
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

export function evaluateCsrf(input: CsrfPolicyInput): CsrfDecision {
  const enforce = shouldEnforceCsrf(input);
  if (!enforce) return { enforce: false, allowed: true, reason: "CSRF enforcement not required for this request." };
  if (isSameOrigin(input.origin, input.referer, input.expectedOrigin)) {
    return { enforce: true, allowed: true, reason: "Same-origin request." };
  }
  return { enforce: true, allowed: false, reason: "Invalid request origin." };
}
