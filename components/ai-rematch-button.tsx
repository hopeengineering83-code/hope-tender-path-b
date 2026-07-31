import { CheckIcon, InfoIcon } from "./icons";

interface AIRematchButtonProps {
  tenderId: string;
  experts?: Array<{ id: string; fullName: string }>;
  projects?: Array<{ id: string; name: string }>;
  onRematchComplete?: () => void;
}

/**
 * Compatibility export retained because the tender workspace already imports
 * AIRematchButton. The Engine now owns re-scoring and selection application;
 * this component is therefore a truthful status surface, not a second mutation
 * owner or a manual step in the workflow.
 */
export function AIRematchButton({
  tenderId,
  experts = [],
  projects = [],
}: AIRematchButtonProps) {
  return (
    <section
      className="rounded-2xl border border-blue-100 bg-white p-5 shadow-sm"
      data-tender-id={tenderId}
      aria-labelledby={`automatic-rematch-${tenderId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`automatic-rematch-${tenderId}`} className="text-sm font-semibold text-slate-900">
            Automatic AI Multi-Perspective Rematch
          </h3>
          <p className="mt-1 max-w-4xl text-xs text-slate-600">
            Each Engine run automatically re-scores eligible source-verified experts and projects through 12 evaluator lenses, performs 20 portfolio-selection passes with critical-floor risk control, and persists the strongest safe selection.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          <CheckIcon className="h-3.5 w-3.5" /> Automatic
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Eligible expert candidates</p>
          <p className="mt-0.5 font-semibold text-slate-900">{experts.length}</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-slate-500">Eligible project candidates</p>
          <p className="mt-0.5 font-semibold text-slate-900">{projects.length}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
          <p className="text-blue-700">Selection authority</p>
          <p className="mt-0.5 font-semibold text-blue-900">Engine persisted state</p>
        </div>
      </div>

      <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-slate-600">
        <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>No re-score, apply-selection, approval, or confirmation action is required. Match Dimension Scores display the latest persisted result and genuine capability gaps remain fail-closed.</span>
      </p>
    </section>
  );
}
