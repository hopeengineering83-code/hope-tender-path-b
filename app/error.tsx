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
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8 text-slate-900">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white text-xl mb-4">
            H
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Hope Tender</h1>
          <p className="mt-1 text-sm text-slate-500">Hope Urban Planning Architectural and Engineering Consultancy</p>
        </div>
        <div className="space-y-5 rounded-2xl border bg-white p-8 shadow-sm">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Application error</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Something went wrong</h2>
            <p className="mt-2 text-sm text-slate-600">
              The page could not be rendered. You can retry or return home.
            </p>
            {error?.digest ? (
              <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">Error digest: {error.digest}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
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
              Return home
            </Link>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400">
          AI-powered tender proposal generation &amp; compliance engine
        </p>
      </div>
    </main>
  );
}
