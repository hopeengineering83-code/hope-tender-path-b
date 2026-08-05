import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 text-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white text-xl mb-4">
            H
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hope Tender</h1>
          <p className="mt-1 text-sm text-slate-700">Hope Urban Planning Architectural and Engineering Consultancy</p>
        </div>
        <div className="space-y-5 rounded-2xl border bg-white p-8 shadow-sm">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-700">404</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Page not found</h2>
            <p className="mt-2 text-sm text-slate-600">
              The page you requested does not exist or is no longer available.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Return home
          </Link>
        </div>
        <p className="text-center text-xs text-slate-600">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </div>
    </main>
  );
}
