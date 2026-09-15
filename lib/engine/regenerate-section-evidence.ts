export type ReviewedEvidenceRecord = {
  trustLevel?: string | null;
};

export type SectionEvidenceResolution<TExpert, TProject> = {
  experts: TExpert[];
  projects: TProject[];
  /** Historical enum values retained for API/test compatibility; both mean authoritative evidence. */
  expertSource: "SELECTED_REVIEWED" | "VAULT_REVIEWED" | "NONE";
  projectSource: "SELECTED_REVIEWED" | "VAULT_REVIEWED" | "NONE";
};

function authoritativeTrustLevel(value: string | null | undefined): boolean {
  return value === "REVIEWED" || value === "SOURCE_VERIFIED";
}

/**
 * Section regeneration may use runtime-authoritative expert/project evidence.
 * That includes authenticated human REVIEWED records and durable machine
 * SOURCE_VERIFIED records. Draft/unverified rows are deliberately ignored;
 * they never become prompt facts merely because no authoritative record exists.
 *
 * The caller is responsible for loading only current tenant-owned records. The
 * normal generation gate remains responsible for durable provenance checks.
 */
export function resolveReviewedSectionEvidence<
  TExpert extends ReviewedEvidenceRecord,
  TProject extends ReviewedEvidenceRecord,
>(args: {
  selectedExperts: TExpert[];
  selectedProjects: TProject[];
  vaultExperts: TExpert[];
  vaultProjects: TProject[];
}): SectionEvidenceResolution<TExpert, TProject> {
  const selectedExperts = args.selectedExperts.filter((item) => authoritativeTrustLevel(item.trustLevel));
  const selectedProjects = args.selectedProjects.filter((item) => authoritativeTrustLevel(item.trustLevel));
  const vaultExperts = args.vaultExperts.filter((item) => authoritativeTrustLevel(item.trustLevel));
  const vaultProjects = args.vaultProjects.filter((item) => authoritativeTrustLevel(item.trustLevel));

  return {
    experts: selectedExperts.length > 0 ? selectedExperts : vaultExperts,
    projects: selectedProjects.length > 0 ? selectedProjects : vaultProjects,
    expertSource: selectedExperts.length > 0
      ? "SELECTED_REVIEWED"
      : vaultExperts.length > 0
        ? "VAULT_REVIEWED"
        : "NONE",
    projectSource: selectedProjects.length > 0
      ? "SELECTED_REVIEWED"
      : vaultProjects.length > 0
        ? "VAULT_REVIEWED"
        : "NONE",
  };
}

export function sectionEvidenceBlocker(args: {
  sectionId: string;
  expertCount: number;
  projectCount: number;
}): { code: string; message: string } | null {
  if (args.sectionId === "technical-approach" && args.expertCount === 0) {
    return {
      code: "NO_REVIEWED_EXPERT_EVIDENCE",
      message: "Technical-approach regeneration requires at least one authoritative REVIEWED or SOURCE_VERIFIED expert in the selected matches or Company Vault.",
    };
  }
  if (args.sectionId === "company-and-experience" && args.projectCount === 0) {
    return {
      code: "NO_REVIEWED_PROJECT_EVIDENCE",
      message: "Company-and-experience regeneration requires at least one authoritative REVIEWED or SOURCE_VERIFIED project in the selected matches or Company Vault.",
    };
  }
  return null;
}