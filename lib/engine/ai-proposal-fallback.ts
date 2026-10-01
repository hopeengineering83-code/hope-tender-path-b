import { canUseVaultRecord, type ReviewRecordState } from "../vault-review-provenance";

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
    ? params.requirements.map((requirement) => `- ${requirement}`).join("\n")
    : "- No detailed requirements have been extracted yet. Run analysis or add tender requirements before final submission.";

  const expertSection = params.expertLines.length
    ? params.expertLines.map((expert) => `- ${expert}`).join("\n")
    : "- No source-verified expert evidence is available yet. Reprocess the Company Vault before final submission.";

  const projectSection = params.projectLines.length
    ? params.projectLines.map((project) => `- ${project}`).join("\n")
    : "- No source-verified project evidence is available yet. Reprocess the Company Vault before final submission.";

  const requiresTechnical = params.requirements.some((requirement) => /technical|methodology|approach/i.test(requirement));
  const requiresExperts = params.requirements.some((requirement) => /expert|cv|personnel|team leader|specialist/i.test(requirement));
  const requiresProjects = params.requirements.some((requirement) => /project experience|similar project|reference project/i.test(requirement));

  return [
    `# ${params.tenderTitle} — Tender-Aligned Draft`,
    "",
    params.companyProfile
      ? `Prepared using available source-verified company evidence for ${params.companyName}.`
      : null,
    params.aiError ? "Generation note: automated generation was unavailable in this run." : null,
    "",
    "## Extracted Tender Requirements",
    reqText,
    "",
    requiresExperts ? `## Proposed Team\n${expertSection}` : null,
    "",
    requiresProjects ? `## Relevant Experience\n${projectSection}` : null,
    "",
    requiresTechnical
      ? "## Technical Response\nThe technical response must be completed against the extracted tender requirements above, using only current source-verified company evidence and approved tender scope."
      : null,
    "",
    params.submissionRules.length > 0
      ? `## Submission Instructions\n${params.submissionRules.map((rule) => `- ${rule}`).join("\n")}`
      : null,
    "",
    requiresTechnical && params.differentiators.length > 0
      ? `## Evidence-Backed Differentiators\n${params.differentiators.map((differentiator) => `- ${differentiator}`).join("\n")}`
      : null,
  ].filter(Boolean).join("\n");
}

/**
 * Chooses evidence the interactive proposal draft may quote. Current durable
 * SOURCE_VERIFIED evidence and current authenticated REVIEWED evidence are
 * equally eligible; human review is not a prerequisite. Unsupported labels,
 * changed values, stale extraction revisions, or altered source bytes remain
 * fail-closed through the canonical generation authority.
 */
export function selectReviewedEvidenceForAIDraft<T extends { trustLevel?: string | null }>(
  selected: T[],
  reviewedVault: T[],
): { evidence: T[]; usedReviewedVaultFallback: boolean } {
  const usable = (row: T) => canUseVaultRecord(row as unknown as ReviewRecordState, "GENERATION");
  const usableSelected = selected.filter(usable);
  if (usableSelected.length > 0) return { evidence: usableSelected, usedReviewedVaultFallback: false };
  const usableVault = reviewedVault.filter(usable);
  if (usableVault.length > 0) return { evidence: usableVault, usedReviewedVaultFallback: true };
  return { evidence: [], usedReviewedVaultFallback: false };
}
