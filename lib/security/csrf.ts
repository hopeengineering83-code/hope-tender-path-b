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

function flag(value?: string | null): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function normalizeMode(value?: string | null): "off" | "origin" {
  const mode = (value ?? "").trim().toLowerCase();
  if (mode === "off") return "off";
  return "origin";
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
