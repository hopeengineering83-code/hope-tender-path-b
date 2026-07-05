"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logger } from "../../../lib/observability";

export default function CompanyVaultError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("[CompanyVaultError]", { detail: error });
  }, [error]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 text-lg font-bold">!</span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Something went wrong</h2>
            <p className="text-sm text-slate-500">We couldn&apos;t load the company vault.</p>
          </div>
        </div>

        {process.env.NODE_ENV === "development" && error?.message && (
          <div className="mb-4 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5">
            <p className="text-xs font-mono text-rose-700 break-all">{error.message}</p>
            {error.digest && (
              <p className="mt-1 text-[10px] text-rose-400">Digest: {error.digest}</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={reset}
            className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-center text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
