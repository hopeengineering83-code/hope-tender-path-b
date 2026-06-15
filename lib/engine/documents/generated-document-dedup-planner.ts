// Generated-document lifecycle dedup planner (L).
//
// PRODUCTION SYMPTOM
// ──────────────────
// Screenshots showed 15 current outputs + 304 superseded/historical rows
// hidden, multiple planned rows that looked duplicate (financial capacity,
// audited statements), and 0 active export candidates. The
// /deduplicate-documents endpoint already existed but its grouping logic
// was inline and not unit-tested, and the canonical-key normaliser was
// thin — variants like "Audited Statements (Copy).docx" / "audited
// statements v2.docx" / "AuditedStatements_FINAL_v3.docx" landed in
// different groups and stuck around as duplicates.
//
// WHAT THIS MODULE DOES
// ─────────────────────
// Pure planner: given the active-document rows, returns a deterministic
// keep/supersede plan with EXPLICIT reasons per row so:
//   • the endpoint can persist the result + audit it cleanly,
//   • the same logic is unit-testable across the variant patterns that
//     appear in production tenders,
//   • the canonical-key normaliser is one place for everyone to read.
//
// Hard guarantees: never invents content, only supersedes within the
// SAME canonical group, preserves history (caller still sets the row's
// generationStatus to SUPERSEDED — this module never deletes anything).

export type DedupRowInput = {
  id: string;
  name: string;
  exactFileName?: string | null;
  documentType?: string | null;
  reviewStatus?: string | null;
  generationStatus?: string | null;
  validationStatus?: string | null;
  fileContent?: string | null;
  storagePath?: string | null;
  exactOrder?: number | null;
  updatedAt: Date;
};

export type DedupRowDecision = {
  id: string;
  action: "KEEP" | "SUPERSEDE";
  /** Group key the row belongs to. */
  groupKey: string;
  /** Reason for the action — surfaced in audit-log metadata. */
  reason: string;
};

export type DedupPlan = {
  /** Per-row decisions, in the same order as the input. */
  decisions: DedupRowDecision[];
  /** Convenience aggregate. */
  summary: {
    totalRows: number;
    duplicateGroups: number;
    keptRows: number;
    supersededRows: number;
  };
  /** IDs to supersede. Endpoint can pass directly into updateMany. */
  supersedeIds: string[];
};

const VARIANT_SUFFIX_PATTERNS: RegExp[] = [
  /\s*\((?:copy|duplicate|dup|backup|tmp|temp)(?:\s*\d+)?\)/i, // "(Copy)", "(Copy 2)", "(backup)"
  /\s*[-_\s]+(?:copy|duplicate|dup|backup|final|draft|tmp|temp|wip)(?:[-_\s]*v?\d{1,3})?$/i, // "_copy", " final v2"
  /[-_\s]+v\d{1,3}$/i,                          // "_v2", " v10"
  /[-_\s]+\d{1,3}$/i,                           // "_2", " - 3"
  /\s*-?\s*final$/i,                            // " final"
  /\s*-?\s*draft$/i,                            // " draft"
];

const EXT_PATTERN = /\.(docx?|pdf|xlsx?|zip|ppt[xm]?)$/i;

/**
 * Canonical key derived from the row's exactFileName/name + documentType.
 *
 * Strips: file extension, common variant suffixes, multi-space runs. Keeps
 * meaningful alpha/numeric content so two rows with the same canonical
 * filename land in the same group regardless of " (Copy)" / "_v2" cruft.
 */
export function canonicalKey(row: Pick<DedupRowInput, "name" | "exactFileName" | "documentType">): string {
  const raw = (row.exactFileName ?? row.name ?? "").toString().trim();
  let key = raw.replace(EXT_PATTERN, "");
  // Iteratively strip variant suffixes — handles "Audited Statements (Copy) v2" etc.
  let changed = true;
  let safety = 5;
  while (changed && safety-- > 0) {
    changed = false;
    for (const rx of VARIANT_SUFFIX_PATTERNS) {
      const next = key.replace(rx, "");
      if (next !== key) { key = next; changed = true; }
    }
  }
  key = key
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const typeKey = (row.documentType ?? "").toString().toUpperCase().trim();
  return `${key}||${typeKey}`;
}

/** True when the row carries usable content / storage — used to prefer the
 *  "best" row when multiple duplicates exist. */
function hasContent(row: DedupRowInput): boolean {
  return Boolean((row.fileContent ?? "").trim() || (row.storagePath ?? "").trim());
}

function isControlOrSuperseded(row: DedupRowInput): boolean {
  const rev = (row.reviewStatus ?? "").toString().toUpperCase();
  const gen = (row.generationStatus ?? "").toString().toUpperCase();
  return gen === "SUPERSEDED" || rev === "NOT_EXPORTABLE" || rev === "REPLACE_WITH_ORIGINAL";
}

/**
 * Pure dedup planner. Groups input rows by `canonicalKey`; within each group
 * with >1 row, keeps the strongest candidate (has content, then latest by
 * updatedAt) and marks the rest as SUPERSEDE with a reason.
 *
 * Control / official-original placeholder rows are never auto-superseded —
 * they're intentional ledger entries even when they share a canonical key
 * with a generated narrative.
 */
export function planDeduplication(rows: DedupRowInput[]): DedupPlan {
  const decisions: DedupRowDecision[] = [];
  const groups = new Map<string, DedupRowInput[]>();
  for (const row of rows) {
    const key = canonicalKey(row);
    let bucket = groups.get(key);
    if (!bucket) { bucket = []; groups.set(key, bucket); }
    bucket.push(row);
  }

  let duplicateGroups = 0;
  let supersededRows = 0;

  for (const [groupKey, bucket] of groups) {
    if (bucket.length === 1) {
      decisions.push({ id: bucket[0].id, action: "KEEP", groupKey, reason: "Only row in canonical group." });
      continue;
    }
    // Within each group, separate control/official-original placeholders from
    // generated narratives. Control rows are always kept (they're intentional).
    const controlRows = bucket.filter(isControlOrSuperseded);
    const narrativeRows = bucket.filter((r) => !isControlOrSuperseded(r));
    for (const r of controlRows) {
      decisions.push({ id: r.id, action: "KEEP", groupKey, reason: "Control / official-original placeholder — never auto-superseded." });
    }
    if (narrativeRows.length <= 1) {
      // Either no narrative dupes or exactly one — keep it.
      for (const r of narrativeRows) {
        decisions.push({ id: r.id, action: "KEEP", groupKey, reason: controlRows.length > 0 ? "Sole narrative row in group containing controls." : "Only narrative row in group." });
      }
      continue;
    }
    // Multiple narrative rows compete. Sort: has-content first, then latest updatedAt.
    const sorted = [...narrativeRows].sort((a, b) => {
      const ah = hasContent(a) ? 1 : 0;
      const bh = hasContent(b) ? 1 : 0;
      if (bh !== ah) return bh - ah;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    duplicateGroups += 1;
    const [keep, ...losers] = sorted;
    decisions.push({
      id: keep.id,
      action: "KEEP",
      groupKey,
      reason: hasContent(keep)
        ? `Kept: has file content / storage path; latest updatedAt (${keep.updatedAt.toISOString()}). ${losers.length} sibling(s) superseded.`
        : `Kept: latest updatedAt (${keep.updatedAt.toISOString()}); no content present in any group row. ${losers.length} sibling(s) superseded.`,
    });
    for (const loser of losers) {
      supersededRows += 1;
      const explain = hasContent(loser)
        ? `Older content version (updatedAt ${loser.updatedAt.toISOString()}); newer sibling kept.`
        : `Empty/missing content (updatedAt ${loser.updatedAt.toISOString()}); sibling with content kept.`;
      decisions.push({ id: loser.id, action: "SUPERSEDE", groupKey, reason: explain });
    }
  }

  return {
    decisions,
    summary: {
      totalRows: rows.length,
      duplicateGroups,
      keptRows: decisions.filter((d) => d.action === "KEEP").length,
      supersededRows,
    },
    supersedeIds: decisions.filter((d) => d.action === "SUPERSEDE").map((d) => d.id),
  };
}
