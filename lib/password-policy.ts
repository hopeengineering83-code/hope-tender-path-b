export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters" };
  if (password.length > 1024) return { ok: false, error: "Password too long (max 1024 characters)" };
  if (!/[a-zA-Z]/.test(password)) return { ok: false, error: "Password must contain at least one letter" };
  if (!/[0-9]/.test(password)) return { ok: false, error: "Password must contain at least one number" };
  return { ok: true };
}
