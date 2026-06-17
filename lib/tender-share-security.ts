import { randomBytes } from "crypto";

const MAX_LABEL_LENGTH = 120;
const MAX_SHARE_LIFETIME_DAYS = 365;
const MAX_ACCESS_LIMIT = 10_000;
const LEGACY_OR_CURRENT_TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

export type ShareCreateInput = {
  label: string | null;
  expiresAt: Date | null;
  maxDownloads: number | null;
};

export function createTenderShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidTenderShareToken(token: string): boolean {
  return LEGACY_OR_CURRENT_TOKEN.test(token);
}

export function parseTenderShareCreateInput(value: unknown, now = new Date()):
  | { ok: true; value: ShareCreateInput }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const body = value as Record<string, unknown>;
  let label: string | null = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string") return { ok: false, error: "label must be text" };
    label = body.label.trim() || null;
    if (label && label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: `label must not exceed ${MAX_LABEL_LENGTH} characters` };
    }
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== "") {
    if (typeof body.expiresAt !== "string") return { ok: false, error: "expiresAt must be an ISO date string" };
    expiresAt = new Date(body.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) return { ok: false, error: "expiresAt is invalid" };
    if (expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expiresAt must be in the future" };
    const latest = now.getTime() + MAX_SHARE_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
    if (expiresAt.getTime() > latest) {
      return { ok: false, error: `expiresAt must be within ${MAX_SHARE_LIFETIME_DAYS} days` };
    }
  }

  let maxDownloads: number | null = null;
  if (body.maxDownloads !== undefined && body.maxDownloads !== null && body.maxDownloads !== "") {
    const parsed = typeof body.maxDownloads === "number"
      ? body.maxDownloads
      : typeof body.maxDownloads === "string"
        ? Number(body.maxDownloads)
        : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ACCESS_LIMIT) {
      return { ok: false, error: `maxDownloads must be an integer from 1 to ${MAX_ACCESS_LIMIT}` };
    }
    maxDownloads = parsed;
  }

  return { ok: true, value: { label, expiresAt, maxDownloads } };
}
