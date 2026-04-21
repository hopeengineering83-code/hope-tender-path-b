export default function AnalysisPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tender Analysis</h1>
        <p className="mt-1 text-sm text-slate-500">
          Structured requirement extraction, submission rules, and risk review will surface here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Phase 1 foundation</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          This module is now reserved for parsed tender summaries, exact file naming rules, exact file order,
          page limits, mandatory templates, and extracted requirement records from uploaded tender files.
        </p>
      </div>
    </div>
  );
}
