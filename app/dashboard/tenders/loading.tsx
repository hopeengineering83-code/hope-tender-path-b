/**
 * Loading skeleton for tender pages.
 * Shown via Next.js streaming/suspense while server components load.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl p-4 lg:p-8">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-64 rounded-lg bg-slate-200" />
        <div className="h-4 w-96 rounded bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-32 rounded-lg border border-slate-200 bg-slate-100" />
          <div className="h-32 rounded-lg border border-slate-200 bg-slate-100" />
        </div>
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
        <div className="h-48 rounded-lg border border-slate-200 bg-slate-100" />
      </div>
    </div>
  );
}
