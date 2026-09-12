import { prisma } from "../prisma";
import { remapUnlinkedVaultSources } from "../company-vault-source-remap";
import { autoVerifyCompanyKnowledge } from "../company-auto-verification";
import { reconcileCompanyDocumentByteIntegrity } from "../company-document-byte-integrity-reconcile";
import { materializeLegacyImportSources } from "../company-vault-legacy-source-materialize";

export type CompanyVaultEnginePreflight = {
  companyId: string;
  sourceRemap: Awaited<ReturnType<typeof remapUnlinkedVaultSources>>;
  sourceVerification: Awaited<ReturnType<typeof autoVerifyCompanyKnowledge>>;
};

/**
 * Refreshes Company Vault authority immediately before matching.
 *
 * This intentionally uses the canonical Prisma-backed remap and verification
 * services end to end. Accepting an injected client here would imply a single
 * transaction even though those services own their own database work, which
 * can create misleading test and rollback expectations.
 *
 * Valid records are promoted to SOURCE_VERIFIED only when their current exact
 * values are proven against an owned, byte-verified source document. No human
 * REVIEWED metadata is manufactured. Records with missing, stale, tampered,
 * expired, or unmatched evidence remain fail-closed.
 */
export async function prepareCompanyVaultForEngine(
  userId: string,
): Promise<CompanyVaultEnginePreflight | null> {
  const company = await prisma.company.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!company) return null;

  // A Legacy Data Import stages the source text it read but never creates a
  // CompanyDocument, so records imported that way have no source to verify
  // against and the app ends up asking for files it has already read. Persist
  // that staged text as owned evidence first; verification below is unchanged.
  await materializeLegacyImportSources(company.id);

  // Establish byte integrity first. The remapper only accepts VERIFIED
  // documents as evidence sources, so a vault whose documents were never
  // integrity-checked has no eligible sources at all and reconciles to zero —
  // which is exactly what "4 extracted / 0 verified experts / 0 verified
  // projects" looks like from the outside.
  await reconcileCompanyDocumentByteIntegrity(company.id);

  const sourceRemap = await remapUnlinkedVaultSources(company.id);
  const sourceVerification = await autoVerifyCompanyKnowledge(company.id);

  return { companyId: company.id, sourceRemap, sourceVerification };
}
