export type AppendixAuthority = { label: string; title: string; sourcePage: number | null; sourceQuote: string; documentType: string | null };

/** Appendix labels are source identifiers only; their contents are never inferred from the letter. */
export function buildAppendixAuthorityRegister(entries: readonly AppendixAuthority[]): AppendixAuthority[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.label.trim().toLowerCase();
    if (!key || !entry.title.trim() || !entry.sourceQuote.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveAppendixDocumentType(entry: AppendixAuthority): string | null {
  return entry.documentType?.trim() || null;
}
