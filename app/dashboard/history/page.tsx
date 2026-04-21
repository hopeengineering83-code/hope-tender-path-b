export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Tender History</h1>
        <p className="mt-1 text-sm text-slate-500">
          Archived tenders, prior exports, and reusable tender configurations will be available here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This history area is prepared for searching and filtering tenders by client, reference, sector,
          deadline, readiness, completion state, and export history.
        </p>
      </div>
    </div>
  );
}
