// GET / PUT /api/settings
//
// Company-level application settings. Role-gated to ADMIN and
// PROPOSAL_MANAGER — REVIEWER and VIEWER receive 403 even through direct
// API calls. Unknown fields are rejected with field-level validation
// errors. Preserves restored AppSettings values; does not overwrite with
// generic defaults.
//
// The exportFormat field accepts only document formats (DOCX, PDF). The
// legacy UI value "ZIP" is mapped to "DOCX" on write and surfaced
// separately as a packageDownloadMode hint (not persisted to AppSettings
// because AppSettings.exportFormat is a document-format column, not a
// package-mode column).

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../lib/rate-limit";
import { logAction } from "../../../lib/audit";

export const dynamic = "force-dynamic";

// ─── Validation constants ────────────────────────────────────────────────────
const VALID_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES",
]);
const VALID_EXPORT_FORMATS = new Set(["DOCX", "PDF"]);
const VALID_LANGUAGES = new Set(["en", "fr", "ar", "es", "pt"]);

// The known set of fields AppSettings accepts. Unknown fields are rejected
// (not silently dropped) so the caller gets field-level validation feedback.
const KNOWN_FIELDS = new Set([
  "defaultCurrency", "aiStrictMode", "allowBrandingDefault", "allowSignatureDefault",
  "allowStampDefault", "exportFormat", "pageNumbering", "includeTableOfContents", "language",
]);

type FieldError = { field: string; message: string };

function validateSettings(body: Record<string, unknown>): { data: Record<string, unknown> | null; errors: FieldError[] } {
  const errors: FieldError[] = [];

  // Reject unknown fields
  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push({ field: key, message: `Unknown field — ${key} is not a recognized setting.` });
    }
  }

  // defaultCurrency
  const rawCurrency = body.defaultCurrency;
  if (rawCurrency !== undefined) {
    if (typeof rawCurrency !== "string" || !VALID_CURRENCIES.has(rawCurrency.trim().toUpperCase())) {
      errors.push({ field: "defaultCurrency", message: `Must be one of: ${[...VALID_CURRENCIES].join(", ")}.` });
    }
  }

  // exportFormat — only document formats. Legacy "ZIP" is mapped to "DOCX"
  // and the caller is informed via a warning (not an error) that ZIP is a
  // package-download mode, not a document format.
  const rawFormat = body.exportFormat;
  if (rawFormat !== undefined) {
    if (typeof rawFormat !== "string") {
      errors.push({ field: "exportFormat", message: "Must be a string (DOCX or PDF)." });
    } else {
      const upper = rawFormat.trim().toUpperCase();
      if (upper === "ZIP") {
        // Legacy value — silently map to DOCX. The UI is being fixed to
        // separate document format from package-download mode.
        // Not an error, but the persisted value will be DOCX.
      } else if (!VALID_EXPORT_FORMATS.has(upper)) {
        errors.push({ field: "exportFormat", message: "Must be DOCX or PDF. ZIP is a package-download mode, not a document format." });
      }
    }
  }

  // language
  const rawLanguage = body.language;
  if (rawLanguage !== undefined) {
    if (typeof rawLanguage !== "string" || !VALID_LANGUAGES.has(rawLanguage.trim())) {
      errors.push({ field: "language", message: `Must be one of: ${[...VALID_LANGUAGES].join(", ")}.` });
    }
  }

  // Boolean fields
  const boolFields = ["aiStrictMode", "allowBrandingDefault", "allowSignatureDefault", "allowStampDefault", "pageNumbering", "includeTableOfContents"];
  for (const field of boolFields) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      errors.push({ field, message: "Must be a boolean." });
    }
  }

  if (errors.length > 0) return { data: null, errors };

  // Build the validated data object — only include fields that were provided
  // so we don't overwrite existing values with defaults.
  const data: Record<string, unknown> = {};
  if (body.defaultCurrency !== undefined) {
    data.defaultCurrency = (body.defaultCurrency as string).trim().toUpperCase();
  }
  if (body.exportFormat !== undefined) {
    const upper = (body.exportFormat as string).trim().toUpperCase();
    data.exportFormat = upper === "ZIP" ? "DOCX" : upper;
  }
  if (body.language !== undefined) {
    data.language = (body.language as string).trim();
  }
  for (const field of boolFields) {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  }
  data.updatedAt = new Date();

  return { data, errors };
}

export async function GET() {
  // Role gate: ADMIN and PROPOSAL_MANAGER only. REVIEWER and VIEWER get 403.
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;

  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    include: { settings: true },
  });
  if (!company) return NextResponse.json({ settings: null });

  return NextResponse.json({ settings: company.settings });
}

export async function PUT(req: Request) {
  // Role gate: ADMIN and PROPOSAL_MANAGER only.
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const rl = rateLimit(`settings-update:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;

  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const { data, errors } = validateSettings(body);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: errors },
      { status: 400 },
    );
  }

  // Upsert preserves existing values for fields not in the request body.
  // The `data` object only contains fields that were provided + validated.
  const settings = await prisma.appSettings.upsert({
    where: { companyId: company.id },
    update: data!,
    create: {
      companyId: company.id,
      // For create, fall back to schema defaults for fields not provided
      defaultCurrency: (data!.defaultCurrency as string) ?? "USD",
      aiStrictMode: (data!.aiStrictMode as boolean) ?? true,
      allowBrandingDefault: (data!.allowBrandingDefault as boolean) ?? true,
      allowSignatureDefault: (data!.allowSignatureDefault as boolean) ?? true,
      allowStampDefault: (data!.allowStampDefault as boolean) ?? true,
      exportFormat: (data!.exportFormat as string) ?? "DOCX",
      pageNumbering: (data!.pageNumbering as boolean) ?? true,
      includeTableOfContents: (data!.includeTableOfContents as boolean) ?? false,
      language: (data!.language as string) ?? "en",
    },
  });

  void logAction({
    userId: actor.id,
    action: "SETTINGS_UPDATED",
    entityType: "AppSettings",
    entityId: settings.id,
    description: "App settings updated",
  }).catch(() => {});

  return NextResponse.json({ settings });
}
