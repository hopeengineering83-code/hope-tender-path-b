export const BOOTSTRAP_ADMIN_EMAIL = "admin@hope.local";
export const MIN_PRODUCTION_PASSWORD_LENGTH = 16;
export const BANNED_PASSWORDS = ["Admin123!", "admin123!", "changeme", "password", "secret"];

export type BootstrapAdminPolicy = {
  allowRepair: boolean;
  password: string;
  reason: string | null;
};

function readEnv(name: string): string | undefined {
  return process.env[name];
}

function envFlag(name: string): boolean {
  const raw = readEnv(name);
  return Boolean(raw && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase()));
}

export function validateProductionBootstrapPassword(value: string | undefined): string | null {
  if (!value) return "BOOTSTRAP_ADMIN_PASSWORD is required when bootstrap seeding is explicitly enabled.";
  if (BANNED_PASSWORDS.includes(value)) {
    return "BOOTSTRAP_ADMIN_PASSWORD is a banned default.";
  }
  if (value.length < MIN_PRODUCTION_PASSWORD_LENGTH) {
    return `BOOTSTRAP_ADMIN_PASSWORD must be at least ${MIN_PRODUCTION_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function _resetBootstrapAdminWarning(): void {
  // Retained for test compatibility. The login path no longer emits warnings or repairs credentials.
}

/** Login-time bootstrap repair is permanently disabled. */
export function resolveBootstrapAdminPolicy(): BootstrapAdminPolicy {
  return {
    allowRepair: false,
    password: "",
    reason: "Bootstrap credentials must be created by an explicit seed or administrative process, never during login.",
  };
}

/**
 * Resolve runtime seeding independently from the permanently disabled login
 * repair path. Runtime admin creation always requires explicit opt-in and a
 * strong, non-default password, including development and test environments.
 */
export function resolveRuntimeBootstrapAdminPolicy(): BootstrapAdminPolicy {
  if (!envFlag("BOOTSTRAP_ADMIN_ENABLED")) {
    return { allowRepair: false, password: "", reason: "Runtime bootstrap admin seeding is disabled." };
  }

  const password = readEnv("BOOTSTRAP_ADMIN_PASSWORD");
  const passwordError = validateProductionBootstrapPassword(password);
  if (passwordError) {
    return { allowRepair: false, password: "", reason: passwordError };
  }

  return { allowRepair: true, password: password!, reason: null };
}

/** Runtime seed is allowed only through explicit opt-in and a strong password. */
export function isRuntimeBootstrapAdminAllowed(): boolean {
  return resolveRuntimeBootstrapAdminPolicy().allowRepair;
}
