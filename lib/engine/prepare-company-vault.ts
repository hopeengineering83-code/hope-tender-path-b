import { prisma } from "../prisma";
import { remapUnlinkedVaultSources } from "../company-vault-source-remap";
import { autoVerifyCompanyKnowledge } from "../company-auto-verification";

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

  const sourceRemap = await remapUnlinkedVaultSources(company.id);
  const sourceVerification = await autoVerifyCompanyKnowledge(company.id);

  return { companyId: company.id, sourceRemap, sourceVerification };
}
