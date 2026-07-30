import { ingestCompanyVault } from "./company-vault-ingestion";
import { shouldScanForExperts, shouldScanForProjects } from "./company-document-classifier";

/**
 * Compatibility entry point for older callers.
 *
 * Company Vault ingestion has one authority: ingestCompanyVault(). The legacy
 * importer previously deleted mixed-document drafts and diverged from the
 * deterministic fallback. Keeping this thin redirect prevents another
 * orchestration owner from reappearing while preserving the public function
 * name used by older tests and routes.
 */
export async function importCompanyKnowledgeFromDocuments(companyId: string) {
  return ingestCompanyVault(companyId);
}
