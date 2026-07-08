// Database Recovery status — a SANITIZED, read-only health snapshot for a
// restored (e.g. Neon point-in-time) database.
//
// SECURITY: this module NEVER returns DATABASE_URL, host, database name,
// credentials, user records, file bytes, or document content. It returns only
// booleans, counts, and field-name/enum-level compatibility flags. Everything
// here is safe to render to an ADMIN operator.
//
// It performs NO writes and NO migrations. It only reads counts and
// information_schema to describe whether a restored database is usable, and
// what an operator must initialise or repair. Any repair is a DRY-RUN preview
// (see buildRepairPreview) — it is never applied automatically.

import type { PrismaClient } from "@prisma/client";

/** Tables the application requires to function. Kept in sync with schema.prisma. */
export const REQUIRED_TABLES: readonly string[] = [
  "User", "Company", "AppSettings", "CompanyAsset", "CompanyDocument",
  "Tender", "TenderFile", "Requirement", "GeneratedDocument",
  "BuildPlan", "TenderMetadataOverride", "Session",
];

/** Allowed enum-ish values used to detect unsupported/invalid restored settings. */
const VALID_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "AED", "SAR", "KWD", "QAR", "OMR", "EGP", "ETB", "NGN", "ZAR", "KES",
]);
const VALID_EXPORT_FORMATS = new Set(["DOCX", "PDF"]);
const VALID_LANGUAGES = new Set(["en", "fr", "ar", "es", "pt"]);
const BRANDING_ASSET_TYPES = ["LETTERHEAD", "SIGNATURE", "STAMP"] as const;

export type DbRecoveryStatus = {
  reachable: boolean;
  // "OK" when the Prisma client can read the expected columns; "INCOMPATIBLE"
  // when a required table/column is missing; "UNKNOWN" when unreachable.
  schemaCompatibility: "OK" | "INCOMPATIBLE" | "UNKNOWN";
  missingTables: string[];
  presentTableCount: number;
  requiredTableCount: number;
  companySettings: {
    companyExists: boolean;
    appSettingsExists: boolean;
    // True when a Company row exists but its AppSettings row does not — the
    // operator must initialise settings (never auto-overwritten with defaults).
    initializationRequired: boolean;
  };
  // Counts only — never the records themselves.
  counts: Record<string, number>;
  branding: {
    // Branding asset types that have no ACTIVE asset for the company.
    missingActiveAssetTypes: string[];
    inactiveAssetCount: number;
  };
  // Field-name + reason only — never the offending value beyond an enum-safe echo.
  invalidRestoredSettings: Array<{ field: string; reason: string }>;
  checkedAt: string;
};

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS "exists"`,
      table,
    );
    return Boolean(rows?.[0]?.exists);
  } catch {
    return false;
  }
}

async function safeCount(fn: () => Promise<number>): Promise<number> {
  try { return await fn(); } catch { return -1; }
}

/**
 * Compute a sanitized recovery status for the given user's company. Returns
 * only booleans/counts/field-names — never secrets, records, or content.
 */
export async function getDbRecoveryStatus(prisma: PrismaClient, userId: string): Promise<DbRecoveryStatus> {
  const checkedAt = new Date().toISOString();

  // 1. Reachability — a trivial read. On failure everything downstream is UNKNOWN.
  let reachable = false;
  try {
    await prisma.$queryRawUnsafe(`SELECT 1`);
    reachable = true;
  } catch {
    reachable = false;
  }

  if (!reachable) {
    return {
      reachable: false,
      schemaCompatibility: "UNKNOWN",
      missingTables: [],
      presentTableCount: 0,
      requiredTableCount: REQUIRED_TABLES.length,
      companySettings: { companyExists: false, appSettingsExists: false, initializationRequired: false },
      counts: {},
      branding: { missingActiveAssetTypes: [], inactiveAssetCount: 0 },
      invalidRestoredSettings: [],
      checkedAt,
    };
  }

  // 2. Required tables present.
  const presence = await Promise.all(REQUIRED_TABLES.map((t) => tableExists(prisma, t)));
  const missingTables = REQUIRED_TABLES.filter((_, i) => !presence[i]);
  const presentTableCount = REQUIRED_TABLES.length - missingTables.length;

  // 3. Schema compatibility — can the Prisma client read the expected columns?
  let schemaCompatibility: DbRecoveryStatus["schemaCompatibility"] = "OK";
  if (missingTables.length > 0) schemaCompatibility = "INCOMPATIBLE";
  else {
    try {
      // Touch a representative column set through the client; a drift (missing
      // column) throws and marks the schema incompatible.
      await prisma.appSettings.findFirst({ select: { id: true, exportFormat: true, defaultCurrency: true, language: true } });
    } catch {
      schemaCompatibility = "INCOMPATIBLE";
    }
  }

  // 4. Company / AppSettings existence for this operator.
  const company = await prisma.company
    .findUnique({ where: { userId }, include: { settings: true } })
    .catch(() => null);
  const companyExists = Boolean(company);
  const appSettingsExists = Boolean(company?.settings);
  const initializationRequired = companyExists && !appSettingsExists;

  // 5. Core counts only.
  const counts: Record<string, number> = {
    users: await safeCount(() => prisma.user.count()),
    companies: await safeCount(() => prisma.company.count()),
    appSettings: await safeCount(() => prisma.appSettings.count()),
    tenders: await safeCount(() => prisma.tender.count()),
    generatedDocuments: await safeCount(() => prisma.generatedDocument.count()),
    companyAssets: await safeCount(() => prisma.companyAsset.count()),
  };

  // 6. Branding: which branding asset types lack an ACTIVE asset; how many are inactive.
  let missingActiveAssetTypes: string[] = [];
  let inactiveAssetCount = 0;
  if (companyExists && company) {
    const assets = await prisma.companyAsset
      .findMany({ where: { companyId: company.id }, select: { assetType: true, isActive: true } })
      .catch(() => [] as Array<{ assetType: string; isActive: boolean }>);
    inactiveAssetCount = assets.filter((a) => !a.isActive).length;
    const activeByType = new Set(assets.filter((a) => a.isActive).map((a) => a.assetType.toUpperCase()));
    missingActiveAssetTypes = BRANDING_ASSET_TYPES.filter((t) => !activeByType.has(t));
  }

  // 7. Invalid/unsupported restored settings — field-name + reason only.
  const invalidRestoredSettings: Array<{ field: string; reason: string }> = [];
  const s = company?.settings;
  if (s) {
    if (!VALID_CURRENCIES.has((s.defaultCurrency ?? "").toUpperCase())) {
      invalidRestoredSettings.push({ field: "defaultCurrency", reason: "unsupported currency code" });
    }
    if (!VALID_EXPORT_FORMATS.has((s.exportFormat ?? "").toUpperCase())) {
      invalidRestoredSettings.push({ field: "exportFormat", reason: "unsupported document format (expected DOCX or PDF)" });
    }
    if (!VALID_LANGUAGES.has((s.language ?? "").trim())) {
      invalidRestoredSettings.push({ field: "language", reason: "unsupported language code" });
    }
  }

  return {
    reachable,
    schemaCompatibility,
    missingTables,
    presentTableCount,
    requiredTableCount: REQUIRED_TABLES.length,
    companySettings: { companyExists, appSettingsExists, initializationRequired },
    counts,
    branding: { missingActiveAssetTypes, inactiveAssetCount },
    invalidRestoredSettings,
    checkedAt,
  };
}

/**
 * DRY-RUN repair preview. Describes what an operator-initiated repair WOULD do,
 * without performing any write. Production repair is never automatic; this only
 * powers a preview so the operator can decide.
 */
export function buildRepairPreview(status: DbRecoveryStatus): Array<{ action: string; detail: string }> {
  const preview: Array<{ action: string; detail: string }> = [];
  if (status.companySettings.initializationRequired) {
    preview.push({
      action: "INITIALIZE_APP_SETTINGS",
      detail: "Create an AppSettings row for this company using schema defaults. Existing restored settings are never overwritten.",
    });
  }
  for (const f of status.invalidRestoredSettings) {
    preview.push({
      action: "REVIEW_INVALID_SETTING",
      detail: `Field "${f.field}" holds an ${f.reason}; an operator must choose a supported value (no automatic change).`,
    });
  }
  for (const t of status.branding.missingActiveAssetTypes) {
    preview.push({
      action: "UPLOAD_OR_ACTIVATE_ASSET",
      detail: `No active ${t} asset — upload or re-activate one before enabling ${t.toLowerCase()} on generated documents.`,
    });
  }
  return preview;
}
