import { ChevronDownIcon, WarningIcon } from "./icons";

export type SelectedEvidenceCandidate = {
  id: string;
  name: string;
  subtitle: string | null;
  score: number;
  rationale: string | null;
  isSelected: boolean;
  trustLevel: string;
};

const ELIGIBLE_EVIDENCE_TRUST_LEVELS = new Set(["SOURCE_VERIFIED", "REVIEWED"]);

export function isEligibleSelectedEvidence(row: SelectedEvidenceCandidate): boolean {
  return ELIGIBLE_EVIDENCE_TRUST_LEVELS.has(row.trustLevel);
}

function EvidenceList({ title, rows }: { title: string; rows: SelectedEvidenceCandidate[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">Automatic verification incomplete.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{row.name}</p>
                  {row.subtitle && <p className="text-xs text-slate-600">{row.subtitle}</p>}
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                  Automatically linked · {Math.round(row.score * 100)}%
                </span>
              </div>
              {row.rationale && <p className="mt-2 text-xs text-slate-600">{row.rationale}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MatchingSelectedEvidencePanel({
  experts,
  projects,
  sectionId = "matching-selected-evidence",
}: {
  experts: SelectedEvidenceCandidate[];
  projects: SelectedEvidenceCandidate[];
  sectionId?: string;
}) {
  // A stale selected flag must never make draft, tampered, or otherwise
  // unpromoted Company Vault data visible as selected evidence. Matching uses
  // the same fail-closed trust boundary as the Engine eligibility gate.
  const eligibleExperts = experts.filter(isEligibleSelectedEvidence);
  const eligibleProjects = projects.filter(isEligibleSelectedEvidence);
  const selectedExperts = eligibleExperts.filter((row) => row.isSelected);
  const selectedProjects = eligibleProjects.filter((row) => row.isSelected);
  const candidates = [...eligibleExperts, ...eligibleProjects].filter((row) => !row.isSelected);
  const hasSelection = selectedExperts.length + selectedProjects.length > 0;

  return (
    <section id={sectionId} className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canonical persisted selection</p>
        <h2 className="mt-1 text-lg font-bold text-slate-900">Matching and Selected Evidence</h2>
        <p className="mt-1 text-sm text-slate-600">
          Run Engine scores, verifies, and persists the strongest eligible company-owned experts and projects automatically.
        </p>
      </div>

      {!hasSelection && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <WarningIcon className="mt-0.5 shrink-0" />
          <span>Automatic verification incomplete.</span>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EvidenceList title={`Selected experts (${selectedExperts.length})`} rows={selectedExperts} />
        <EvidenceList title={`Selected projects (${selectedProjects.length})`} rows={selectedProjects} />
      </div>

      <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
          <span className="text-sm font-semibold text-slate-800">Candidates and matching diagnostics ({candidates.length})</span>
          <ChevronDownIcon className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-200 p-4">
          {candidates.length === 0 ? (
            <p className="text-sm text-slate-600">No additional eligible candidates.</p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((row) => (
                <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    <span className="text-slate-600">{Math.round(row.score * 100)}% fit</span>
                  </div>
                  {row.rationale && <p className="mt-1 text-xs text-slate-600">{row.rationale}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}
