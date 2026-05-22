/**
 * Centralised bootstrap-admin policy.
 *
 * Used by both the login route (which can repair a missing password
 * hash on the bootstrap account) and the runtime seed code in
 * lib/prisma.ts. The policy is the SAME across every entry point so a
 * production deployment can never accidentally:
 *   - create the bootstrap admin with the built-in "Admin123!" default
 *   - silently rebind the bootstrap account from a weak default
 *   - log the bootstrap password to stdout
 *
 * Resolution order in DEVELOPMENT:
 *   BOOTSTRAP_ADMIN_PASSWORD || ADMIN_PASSWORD || "Admin123!"
 *
 * Resolution order in PRODUCTION (NODE_ENV=production):
 *   - allowRepair = false unless BOOTSTRAP_ADMIN_ENABLED=true
 *   - when allowRepair=true, BOOTSTRAP_ADMIN_PASSWORD is REQUIRED
 *   - the password must be ≥16 chars and not be in BANNED_PASSWORDS
 *   - failing any of the above, allowRepair returns false and a
 *     warning is emitted (but no real password is logged)
 */

export const BOOTSTRAP_ADMIN_EMAIL = "admin@hope.local";
export const MIN_PRODUCTION_PASSWORD_LENGTH = 16;
export const BANNED_PASSWORDS = ["Admin123!", "admin123!", "changeme", "password", "secret"];

export type BootstrapAdminPolicy = {
  /** Whether the login route / seed is allowed to set/repair the admin password. */
  allowRepair: boolean;
  /** The required password the user must supply for repair to fire. May be empty when allowRepair=false. */
  password: string;
  /** Human-readable reason allowRepair is false (used by tooling/logs; never echoed to clients). */
  reason: string | null;
};

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  return raw;
}

function envFlag(name: string): boolean {
  const raw = readEnv(name);
  if (!raw) return false;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/** Validation for production-grade bootstrap passwords. Returns reason or null. */
export function validateProductionBootstrapPassword(value: string | undefined): string | null {
  if (!value) return "BOOTSTRAP_ADMIN_PASSWORD is required in production when BOOTSTRAP_ADMIN_ENABLED=true.";
  // Banned-default check FIRST so callers see the clearest possible message
  // for the most dangerous failure mode (using a literal known weak value).
  if (BANNED_PASSWORDS.includes(value)) {
    return "BOOTSTRAP_ADMIN_PASSWORD is a banned default — pick a unique high-entropy password.";
  }
  if (value.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
    return `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PRODUCTION_PASSWORD_LENGTH} characters in production.`;
  }
  return null;
}

/**
 * Resolve the current bootstrap-admin policy from env. Pure function —
 * safe to call in both edge and node runtimes. Never logs the password
 * itself. Emits at most one console.warn per process when the
 * configuration is rejected in production.
 */
let warnedOnce = false;
function warnOnce(message: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[bootstrap-admin] ${message}`);
}

/** Test hook to reset the warn-once state. */
export function _resetBootstrapAdminWarning(): void {
  warnedOnce = false;
}

export function resolveBootstrapAdminPolicy(): BootstrapAdminPolicy {
  const isProduction = process.env.NODE_ENV === "production";
  const enabled = envFlag("BOOTSTRAP_ADMIN_ENABLED");
  const envPassword = readEnv("BOOTSTRAP_ADMIN_PASSWORD") ?? readEnv("ADMIN_PASSWORD");

  if (isProduction) {
    if (!enabled) {
      return {
        allowRepair: false,
        password: "",
        reason: "Production deployments do not enable bootstrap-admin repair by default. Set BOOTSTRAP_ADMIN_ENABLED=true if you intentionally need it.",
      };
    }
    const invalid = validateProductionBootstrapPassword(envPassword);
    if (invalid) {
      warnOnce(invalid);
      return { allowRepair: false, password: "", reason: invalid };
    }
    return { allowRepair: true, password: envPassword as string, reason: null };
  }

  // Development / test: keep the legacy convenience default so the
  // first-time `npm run dev` flow still works without ceremony. Banned
  // defaults are NOT rejected here — they are explicitly intended for
  // local development only.
  const password = envPassword || "Admin123!";
  return { allowRepair: true, password, reason: null };
}

/**
 * Returns true when the runtime seed path inside lib/prisma.ts is
 * permitted to create the bootstrap admin row from scratch. In
 * production this requires the same explicit opt-in as login repair.
 */
export function isRuntimeBootstrapAdminAllowed(): boolean {
  return resolveBootstrapAdminPolicy().allowRepair;
}
