"use client";

import Link from "next/link";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Application error</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-4 text-slate-600">
          The page could not be rendered. You can retry or return to the dashboard.
        </p>
        {error?.digest ? (
          <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Error digest: {error.digest}</p>
        ) : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
