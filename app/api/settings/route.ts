// GET / PUT /api/settings
//
// Company-level application settings. Role-gated to ADMIN and
// PROPOSAL_MANAGER — REVIEWER and VIEWER receive 403 even through direct
// API calls. Unknown fields are rejected with field-level validation
// errors. Preserves restored AppSettings values; does not overwrite with
// generic defaults.
//
// These settings are presentation and authoring preferences only. They do
// not populate or override tender-extracted facts, submission requirements,
// client data, or evidence.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../lib/auth";
import { prisma, prismaReady } from "../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../lib/rate-limit";
import { logAction } from "../../../lib/audit";
import { SETTINGS_PRESENTATION_SEMANTICS } from "../../dashboard/settings/settings-contract";

export const dynamic = "force-dynamic";

const VALID_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES",
]);
const VALID_EXPORT_FORMATS = new Set(["DOCX", "PDF"]);
const VALID_LANGUAGES = new Set(["en", "fr", "ar", "es", "pt"]);

const KNOWN_FIELDS = new Set([
  "defaultCurrency", "aiStrictMode", "allowBrandingDefault", "allowSignatureDefault",
  "allowStampDefault", "exportFormat", "pageNumbering", "includeTableOfContents", "language",
]);

type FieldError = { field: string; message: string };

function validateSettings(body: Record<string, unknown>): { data: Record<string, unknown> | null; errors: FieldError[] } {
  const errors: FieldError[] = [];

  for (const key of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push({ field: key, message: `Unknown field — ${key} is not a recognized setting.` });
    }
  }

  const rawCurrency = body.defaultCurrency;
  if (rawCurrency !== undefined) {
    if (typeof rawCurrency !== "string" || !VALID_CURRENCIES.has(rawCurrency.trim().toUpperCase())) {
      errors.push({ field: "defaultCurrency", message: `Must be one of: ${[...VALID_CURRENCIES].join(", ")}.` });
    }
  }

  const rawFormat = body.exportFormat;
  if (rawFormat !== undefined) {
    if (typeof rawFormat !== "string") {
      errors.push({ field: "exportFormat", message: "Must be a string (DOCX or PDF)." });
    } else {
      const upper = rawFormat.trim().toUpperCase();
      if (!VALID_EXPORT_FORMATS.has(upper)) {
        errors.push({ field: "exportFormat", message: "Must be DOCX or PDF. ZIP is a package-download mode, not a document format." });
      }
    }
  }

  const rawLanguage = body.language;
  if (rawLanguage !== undefined) {
    if (typeof rawLanguage !== "string" || !VALID_LANGUAGES.has(rawLanguage.trim())) {
      errors.push({ field: "language", message: `Must be one of: ${[...VALID_LANGUAGES].join(", ")}.` });
    }
  }

  const boolFields = ["aiStrictMode", "allowBrandingDefault", "allowSignatureDefault", "allowStampDefault", "pageNumbering", "includeTableOfContents"];
  for (const field of boolFields) {
    if (body[field] !== undefined && typeof body[field] !== "boolean") {
      errors.push({ field, message: "Must be a boolean." });
    }
  }

  if (errors.length > 0) return { data: null, errors };

  const data: Record<string, unknown> = {};
  if (body.defaultCurrency !== undefined) {
    data.defaultCurrency = (body.defaultCurrency as string).trim().toUpperCase();
  }
  if (body.exportFormat !== undefined) {
    data.exportFormat = (body.exportFormat as string).trim().toUpperCase();
  }
  if (body.language !== undefined) {
    data.language = (body.language as string).trim();
  }
  for (const field of boolFields) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  data.updatedAt = new Date();

  return { data, errors };
}

export async function GET() {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;
  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    include: { settings: true },
  });

  return NextResponse.json({
    settings: company?.settings ?? null,
    presentationSemantics: SETTINGS_PRESENTATION_SEMANTICS,
  });
}

export async function PUT(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
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
  const company = await prisma.company.findUnique({
    where: { userId: actor.id },
    include: { settings: true },
  });
  if (!company) return NextResponse.json({ error: "Company profile required" }, { status: 400 });

  const parsed: unknown = await req.json().catch(() => null);
  const isPlainObject = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  if (!isPlainObject) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const body = parsed as Record<string, unknown>;

  const { data, errors } = validateSettings(body);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: errors },
      { status: 400 },
    );
  }

  const existing = company.settings as Record<string, unknown> | null;
  const changedFields = Object.keys(data!)
    .filter((key) => key !== "updatedAt")
    .filter((key) => !existing || existing[key] !== (data as Record<string, unknown>)[key]);

  const settings = await prisma.appSettings.upsert({
    where: { companyId: company.id },
    update: data!,
    create: {
      companyId: company.id,
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
    description: changedFields.length > 0
      ? `App settings updated: ${changedFields.join(", ")}`
      : "App settings saved (no field changes)",
    metadata: { changedFields },
  }).catch(() => {});

  return NextResponse.json({
    settings,
    changedFields,
    presentationSemantics: SETTINGS_PRESENTATION_SEMANTICS,
  });
}
