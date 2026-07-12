export type ReviewedEvidenceRecord = {
  trustLevel?: string | null;
};

export type SectionEvidenceResolution<TExpert, TProject> = {
  experts: TExpert[];
  projects: TProject[];
  expertSource: "SELECTED_REVIEWED" | "VAULT_REVIEWED" | "NONE";
  projectSource: "SELECTED_REVIEWED" | "VAULT_REVIEWED" | "NONE";
};

/**
 * Section regeneration may use only REVIEWED expert/project evidence.
 * Selected but unreviewed rows are deliberately ignored; they never become
 * prompt facts merely because no reviewed record is available.
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
  const selectedExperts = args.selectedExperts.filter((item) => item.trustLevel === "REVIEWED");
  const selectedProjects = args.selectedProjects.filter((item) => item.trustLevel === "REVIEWED");
  const vaultExperts = args.vaultExperts.filter((item) => item.trustLevel === "REVIEWED");
  const vaultProjects = args.vaultProjects.filter((item) => item.trustLevel === "REVIEWED");

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
      message: "Technical-approach regeneration requires at least one REVIEWED expert in the selected matches or Company Vault.",
    };
  }
  if (args.sectionId === "company-and-experience" && args.projectCount === 0) {
    return {
      code: "NO_REVIEWED_PROJECT_EVIDENCE",
      message: "Company-and-experience regeneration requires at least one REVIEWED project in the selected matches or Company Vault.",
    };
  }
  return null;
}
