export type QuickDraftEvidenceItem = {
  label: string;
  detail?: string | null;
};

export type QuickDraftEvidenceContextInput = {
  experts: QuickDraftEvidenceItem[];
  projects: QuickDraftEvidenceItem[];
  projectEvidence: QuickDraftEvidenceItem[];
  companyEvidence: QuickDraftEvidenceItem[];
};

function clean(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function trim(value: string, max = 420): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatItems(title: string, items: QuickDraftEvidenceItem[], empty: string, limit: number): string[] {
  const lines = [`## ${title}`];
  const selected = items
    .filter((item) => clean(item.label) || clean(item.detail))
    .slice(0, limit);

  if (selected.length === 0) {
    lines.push(`- ${empty}`);
    return lines;
  }

  for (const item of selected) {
    const label = clean(item.label);
    const detail = clean(item.detail);
    lines.push(`- ${trim([label, detail].filter(Boolean).join(" — "), 520)}`);
  }

  return lines;
}

export function buildQuickDraftEvidenceContext(input: QuickDraftEvidenceContextInput): string {
  return [
    ...formatItems(
      "Selected Expert / CV Evidence",
      input.experts,
      "Bid-team confirmation: select reviewed expert/CV records and map them to tender responsibilities before final submission.",
      8,
    ),
    "",
    ...formatItems(
      "Selected Comparable Project Evidence",
      input.projects,
      "Bid-team confirmation: select the strongest comparable project references before final submission.",
      8,
    ),
    "",
    ...formatItems(
      "Project Evidence Attachments",
      input.projectEvidence,
      "Bid-team confirmation: attach project photos/drawings, testimony, completion certificates, contracts or other proof where required.",
      8,
    ),
    "",
    ...formatItems(
      "Company Evidence Attachments",
      input.companyEvidence,
      "Bid-team confirmation: attach registration, licence, tax/legal records, certificates, policies/manuals and other company evidence required by the tender.",
      8,
    ),
  ].join("\n");
}
