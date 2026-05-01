export type ProvisionalEvidenceCandidate = {
  label: string;
  detail?: string | null;
  score: number;
};

function clean(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function scoreAgainstTender(text: string, tenderText: string): number {
  const lowerText = text.toLowerCase();
  const lowerTender = tenderText.toLowerCase();
  let score = 0;
  const signals = [
    "health",
    "hospital",
    "medical",
    "clinic",
    "radiology",
    "laboratory",
    "pharmacy",
    "opd",
    "emergency",
    "in-patient",
    "mep",
    "biomedical",
    "renovation",
    "assessment",
    "design",
    "supervision",
    "water",
    "infrastructure",
    "urban",
    "structural",
    "electrical",
    "mechanical",
  ];
  for (const signal of signals) {
    if (lowerText.includes(signal) && lowerTender.includes(signal)) score += 4;
    else if (lowerText.includes(signal)) score += 1;
  }
  if (/hospital|medical|health|clinic/i.test(`${text}\n${tenderText}`)) score += 3;
  return score;
}

export function rankProvisionalEvidence<T extends { label: string; detail?: string | null }>(
  items: T[],
  tenderText: string,
  limit = 8,
): ProvisionalEvidenceCandidate[] {
  return items
    .map((item) => ({ ...item, label: clean(item.label), detail: clean(item.detail), score: scoreAgainstTender(`${item.label}\n${item.detail ?? ""}`, tenderText) }))
    .filter((item) => item.label)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export function provisionalEvidenceNote(hasSelected: boolean, evidenceType: "experts" | "projects"): string | null {
  if (hasSelected) return null;
  return evidenceType === "experts"
    ? "No tender-specific expert match was selected yet, so the quick draft is using highest-relevance reviewed company expert candidates as provisional evidence. Confirm final CV selection before submission."
    : "No tender-specific project match was selected yet, so the quick draft is using highest-relevance reviewed company project candidates as provisional evidence. Confirm final project references before submission.";
}
