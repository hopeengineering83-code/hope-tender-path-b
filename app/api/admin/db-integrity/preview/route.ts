// GET /api/admin/db-integrity/preview
//
// ADMIN-only dry-run repair preview. Shows what a repair WOULD do without
// performing any writes. No automatic repair endpoint exists — this is
// purely informational for the operator.
//
// The preview covers:
//   • Companies missing AppSettings rows (would be created with defaults)
//   • AppSettings rows with invalid values (would be corrected to defaults)
//   • Companies missing required branding assets (would need manual upload)
//   • GeneratedDocument rows with empty storagePath AND empty fileContent
//     (orphaned — would be flagged for manual review, NOT auto-deleted)
//
// This endpoint performs ZERO database writes. It is safe to run against
// production at any time.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  // ADMIN-only.
  let actor;
  try {
    actor = await requireRole("ADMIN");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;

  // ── 1. Companies missing AppSettings (would be created) ──────────
  const companiesMissingSettings: Array<{ companyId: string; wouldCreate: Record<string, unknown> }> = [];
  try {
    const companies = await prisma.company.findMany({
      select: { id: true, settings: { select: { id: true } } },
    });
    for (const c of companies) {
      if (!c.settings) {
        companiesMissingSettings.push({
          companyId: c.id,
          wouldCreate: {
            companyId: c.id,
            defaultCurrency: "USD",
            aiStrictMode: true,
            allowBrandingDefault: true,
            allowSignatureDefault: true,
            allowStampDefault: true,
            exportFormat: "DOCX",
            pageNumbering: true,
            includeTableOfContents: false,
            language: "en",
          },
        });
      }
    }
  } catch {
    // Non-fatal.
  }

  // ── 2. AppSettings with invalid values (would be corrected) ──────
  const settingsCorrections: Array<{ companyId: string; field: string; currentValue: string; wouldChangeTo: string }> = [];
  try {
    const allSettings = await prisma.appSettings.findMany({
      select: { id: true, companyId: true, defaultCurrency: true, exportFormat: true, language: true },
    });
    const validCurrencies = new Set(["USD","EUR","GBP","AED","SAR","KWD","QAR","OMR","EGP","ETB","NGN","ZAR","KES"]);
    const validFormats = new Set(["DOCX","PDF"]);
    const validLanguages = new Set(["en","fr","ar","es","pt"]);
    for (const s of allSettings) {
      if (s.defaultCurrency && !validCurrencies.has(s.defaultCurrency)) {
        settingsCorrections.push({ companyId: s.companyId, field: "defaultCurrency", currentValue: s.defaultCurrency, wouldChangeTo: "USD" });
      }
      if (s.exportFormat && !validFormats.has(s.exportFormat)) {
        settingsCorrections.push({ companyId: s.companyId, field: "exportFormat", currentValue: s.exportFormat, wouldChangeTo: "DOCX" });
      }
      if (s.language && !validLanguages.has(s.language)) {
        settingsCorrections.push({ companyId: s.companyId, field: "language", currentValue: s.language, wouldChangeTo: "en" });
      }
    }
  } catch {
    // Non-fatal.
  }

  // ── 3. Companies missing branding assets (would need manual upload) ──
  const brandingGaps: Array<{ companyId: string; missingTypes: string[]; action: string }> = [];
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
      if (missing.length > 0) {
        brandingGaps.push({
          companyId: c.id,
          missingTypes: missing,
          action: "manual_upload_required — cannot auto-create branding assets",
        });
      }
    }
  } catch {
    // Non-fatal.
  }

  // ── 4. Orphaned GeneratedDocuments (empty storage + empty fileContent) ──
  let orphanedDocuments: Array<{ documentId: string; tenderId: string; exactFileName: string | null; action: string }> = [];
  try {
    // Use a lightweight query — only check for NULL/empty both, no char_length
    const orphans = await prisma.$queryRawUnsafe<Array<{ id: string; tenderId: string; exactFileName: string | null }>>(
      `SELECT id, "tenderId", "exactFileName"
       FROM "GeneratedDocument"
       WHERE ("storagePath" IS NULL OR btrim("storagePath") = '')
         AND ("fileContent" IS NULL OR btrim("fileContent") = '')
         AND "generationStatus" != 'SUPERSEDED'
       LIMIT 50`,
    );
    orphanedDocuments = orphans.map((o) => ({
      documentId: o.id,
      tenderId: o.tenderId,
      exactFileName: o.exactFileName,
      action: "flag_for_manual_review — NOT auto-deleted (may be PLANNED stubs)",
    }));
  } catch {
    // Non-fatal.
  }

  return NextResponse.json({
    diagnosticId: `repair_preview_${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    mode: "DRY_RUN — no writes performed",
    summary: {
      companiesMissingSettings: companiesMissingSettings.length,
      settingsCorrections: settingsCorrections.length,
      companiesMissingBranding: brandingGaps.length,
      orphanedDocuments: orphanedDocuments.length,
      totalActions: companiesMissingSettings.length + settingsCorrections.length + brandingGaps.length + orphanedDocuments.length,
    },
    details: {
      wouldCreateSettings: companiesMissingSettings,
      wouldCorrectSettings: settingsCorrections,
      brandingGaps,
      orphanedDocuments,
    },
    // Explicitly state that NO writes were performed.
    writesPerformed: 0,
    note: "This is a dry-run preview. No database writes were performed. No automatic repair endpoint exists. To apply repairs, an operator must run the existing /api/admin/repair?step=appsettings endpoint manually after reviewing this preview.",
  });
}
