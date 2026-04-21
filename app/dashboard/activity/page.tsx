export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Activity Logs</h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload, parsing, matching, generation, override, and export activity will be tracked here.
        </p>
      </div>

      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <p className="text-sm leading-6 text-slate-600">
          This page is reserved for audit trails and user timelines across sensitive tender workflow actions.
        </p>
      </div>
    </div>
  );
}
