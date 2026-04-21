export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Generated Documents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Planned outputs, generated files, validation status, and review readiness will appear here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This module is reserved for tender-scoped output planning, generation status, file naming, file order,
          validation state, and regeneration history.
        </p>
      </div>
    </div>
  );
}
