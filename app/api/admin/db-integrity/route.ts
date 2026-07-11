// GET /api/admin/db-integrity
//
// ADMIN-only read-only database integrity diagnostic. Never exposes
// DATABASE_URL, host, users, credentials, raw documents, or file contents.
// Returns sanitized counts + connection/schema/app-settings/branding status.
//
// This endpoint is READ-ONLY. It does not perform any repair — use the
// dry-run preview endpoint (/api/admin/db-integrity/preview) to see what
// a repair WOULD do. No automatic repair endpoint exists.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { logger } from "../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Required tables — every table created by migrations must be present.
const REQUIRED_TABLES = [
  "User", "Company", "AppSettings", "Tender", "TenderFile", "TenderRequirement",
  "GeneratedDocument", "AiJob", "AiAnalyzeChunk", "AuditLog", "BuildPlan",
  "CompanyDocument", "CompanyAsset", "Expert", "Project", "TenderMetadataOverride",
  "TenderFactsLedger", "TenderSubmissionEmail", "Session", "Role",
];

// Sanitized count — just a number, no row data.
async function safeCount(tableName: string): Promise<{ table: string; count: number | null; error: string | null }> {
  try {
    const result = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "${tableName}"`,
    );
    return { table: tableName, count: Number(result[0]?.count ?? 0), error: null };
  } catch (err) {
    return {
      table: tableName,
      count: null,
      error: "Query failed",
    };
  }
}

export async function GET() {
  // ADMIN-only — no other role may access database diagnostics.
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;

  // ── 1. Connection reachable ──────────────────────────────────────
  let connectionReachable = false;
  let connectionError: string | null = null;
  let dbVersion: string | null = null;
  try {
    const versionResult = await prisma.$queryRawUnsafe<Array<{ version: string }>>(
      "SELECT version() AS version",
    );
    dbVersion = versionResult[0]?.version.split(",")[0] ?? null;
    connectionReachable = true;
  } catch (err) {
    // SECURITY: never expose the raw Postgres connection error — it can
    // contain host/port/db name/user (e.g. "password authentication failed
    // for user tender_app", "ECONNREFUSED 10.0.0.5:5432", Neon endpoint
    // hostnames). The route header promises "NEVER exposes DATABASE_URL,
    // host, users, credentials". Log the raw detail server-side only.
    logger.error("[db-integrity] connection check failed", {
      detail: err instanceof Error ? err.constructor.name : typeof err,
    });
    connectionError = "Connection check failed (see server logs).";
  }

  // ── 2. Schema compatibility — required tables present ────────────
  const tablePresence: Array<{ table: string; present: boolean }> = [];
  let missingTables: string[] = [];
  if (connectionReachable) {
    for (const table of REQUIRED_TABLES) {
      try {
        await prisma.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`);
        tablePresence.push({ table, present: true });
      } catch {
        tablePresence.push({ table, present: false });
        missingTables.push(table);
      }
    }
  }

  // ── 3. Sanitized counts (no row data) ────────────────────────────
  const counts: Array<{ table: string; count: number | null; error: string | null }> = [];
  if (connectionReachable) {
    for (const table of REQUIRED_TABLES) {
      counts.push(await safeCount(table));
    }
  }

  // ── 4. Company / AppSettings status ──────────────────────────────
  let companyStatus: { total: number; withSettings: number; withoutSettings: number } | null = null;
  let appSettingsInvalid: Array<{ companyId: string; issues: string[] }> = [];
  if (connectionReachable) {
    try {
      const total = await prisma.company.count();
      const withSettings = await prisma.appSettings.count();
      companyStatus = {
        total,
        withSettings,
        withoutSettings: Math.max(0, total - withSettings),
      };

      // Check for invalid settings (exportFormat not in DOCX/PDF, etc.)
      const allSettings = await prisma.appSettings.findMany({
        select: { id: true, companyId: true, defaultCurrency: true, exportFormat: true, language: true },
      });
      const validCurrencies = new Set(["USD","EUR","GBP","AED","SAR","KWD","QAR","OMR","EGP","ETB","NGN","ZAR","KES"]);
      const validFormats = new Set(["DOCX","PDF"]);
      const validLanguages = new Set(["en","fr","ar","es","pt"]);
      for (const s of allSettings) {
        const issues: string[] = [];
        if (s.defaultCurrency && !validCurrencies.has(s.defaultCurrency)) issues.push(`invalid defaultCurrency: ${s.defaultCurrency}`);
        if (s.exportFormat && !validFormats.has(s.exportFormat)) issues.push(`invalid exportFormat: ${s.exportFormat}`);
        if (s.language && !validLanguages.has(s.language)) issues.push(`invalid language: ${s.language}`);
        if (issues.length > 0) appSettingsInvalid.push({ companyId: s.companyId, issues });
      }
    } catch {
      // Non-fatal — the counts above already captured table-level errors.
    }
  }

  // ── 5. Branding assets status (sanitized — no file contents) ─────
  let brandingStatus: { logo: number; letterhead: number; signature: number; stamp: number; inactive: number } | null = null;
  if (connectionReachable) {
    try {
      const [logo, letterhead, signature, stamp, inactive] = await Promise.all([
        prisma.companyAsset.count({ where: { assetType: "LOGO", isActive: true } }),
        prisma.companyAsset.count({ where: { assetType: "LETTERHEAD", isActive: true } }),
        prisma.companyAsset.count({ where: { assetType: "SIGNATURE", isActive: true } }),
        prisma.companyAsset.count({ where: { assetType: "STAMP", isActive: true } }),
        prisma.companyAsset.count({ where: { isActive: false } }),
      ]);
      brandingStatus = { logo, letterhead, signature, stamp, inactive };
    } catch {
      // Non-fatal.
    }
  }

  // ── 6. Missing/inactive branding assets per company ──────────────
  let brandingGaps: Array<{ companyId: string; missingTypes: string[] }> = [];
  if (connectionReachable) {
    try {
      const companies = await prisma.company.findMany({
        select: {
          id: true,
          assets: { where: { isActive: true }, select: { assetType: true } },
        },
      });
      const requiredTypes = ["LOGO", "LETTERHEAD", "SIGNATURE", "STAMP"];
      for (const c of companies) {
        const present = new Set(c.assets.map((a) => a.assetType));
        const missing = requiredTypes.filter((t) => !present.has(t));
        if (missing.length > 0) brandingGaps.push({ companyId: c.id, missingTypes: missing });
      }
    } catch {
      // Non-fatal.
    }
  }

  return NextResponse.json({
    diagnosticId: `dbint_${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    // ── Connection (sanitized — no host/user/credential) ──
    connection: {
      reachable: connectionReachable,
      // Only expose the Postgres version banner (e.g. "PostgreSQL 16.4") —
      // never the connection string, host, port, user, or database name.
      serverVersion: dbVersion,
      error: connectionError,
    },
    // ── Schema ──
    schema: {
      requiredTables: REQUIRED_TABLES.length,
      present: tablePresence.filter((t) => t.present).length,
      missing: missingTables,
      tablePresence,
    },
    // ── Counts (sanitized — just numbers, no row data) ──
    counts,
    // ── Company / AppSettings ──
    companyStatus,
    invalidSettings: appSettingsInvalid,
    // ── Branding assets (sanitized — counts only, no file contents) ──
    brandingStatus,
    brandingGaps,
    // ── Summary ──
    summary: {
      healthy: connectionReachable && missingTables.length === 0 && appSettingsInvalid.length === 0,
      blockers: [
        ...(!connectionReachable ? ["Database connection not reachable"] : []),
        ...(missingTables.length > 0 ? [`${missingTables.length} missing table(s): ${missingTables.join(", ")}`] : []),
        ...(appSettingsInvalid.length > 0 ? [`${appSettingsInvalid.length} company(ies) with invalid settings`] : []),
      ],
    },
  });
}
