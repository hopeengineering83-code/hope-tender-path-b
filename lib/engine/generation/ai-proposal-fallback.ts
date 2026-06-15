export function fallbackProposal(params: {
  tenderTitle: string;
  requirements: string[];
  companyName: string;
  companyProfile: string;
  serviceLines: string;
  expertLines: string[];
  projectLines: string[];
  differentiators: string[];
  submissionRules: string[];
  aiError?: string;
}) {
  const reqText = params.requirements.length
    ? params.requirements.map((r) => `- ${r}`).join("\n")
    : "- No detailed requirements have been extracted yet. Run analysis or add tender requirements before final submission.";

  const expertSection = params.expertLines.length
    ? params.expertLines.map((e) => `- ${e}`).join("\n")
    : "- Expert CVs and role assignments must be reviewed and confirmed before submission.";

  const projectSection = params.projectLines.length
    ? params.projectLines.map((p) => `- ${p}`).join("\n")
    : "- Project references must be reviewed and selected in the application before final submission.";

  const requiresTechnical = params.requirements.some((r) => /technical|methodology|approach/i.test(r));
  const requiresExperts = params.requirements.some((r) => /expert|cv|personnel|team leader|specialist/i.test(r));
  const requiresProjects = params.requirements.some((r) => /project experience|similar project|reference project/i.test(r));

  return [
    `# ${params.tenderTitle} — Tender-Aligned Draft`,
    "",
    params.companyProfile
      ? `Prepared using available reviewed company evidence for ${params.companyName}.`
      : null,
    params.aiError ? "Generation note: automated generation was unavailable in this run." : null,
    "",
    "## Extracted Tender Requirements",
    reqText,
    "",
    requiresExperts ? "## Proposed Team\n" + expertSection : null,
    "",
    requiresProjects ? "## Relevant Experience\n" + projectSection : null,
    "",
    requiresTechnical ? "## Technical Response\nThe technical response must be completed against the extracted tender requirements above, using only reviewed company evidence and approved tender scope." : null,
    "",
    params.submissionRules.length > 0 ? "## Submission Instructions\n" + params.submissionRules.map((r) => `- ${r}`).join("\n") : null,
    "",
    requiresTechnical && params.differentiators.length > 0
      ? "## Evidence-Backed Differentiators\n" + params.differentiators.map((d) => `- ${d}`).join("\n")
      : null,
  ].filter(Boolean).join("\n");
}

export function selectReviewedEvidenceForAIDraft<T extends { trustLevel?: string | null }>(
  selected: T[],
  reviewedVault: T[],
): { evidence: T[]; usedReviewedVaultFallback: boolean } {
  const reviewedSelected = selected.filter((row) => row.trustLevel === "REVIEWED");
  if (reviewedSelected.length > 0) return { evidence: reviewedSelected, usedReviewedVaultFallback: false };
  if (reviewedVault.length > 0) return { evidence: reviewedVault, usedReviewedVaultFallback: true };
  return { evidence: [], usedReviewedVaultFallback: false };
}

