"use client";

import { useRouter } from "next/navigation";

export function PanelErrorFallback({
  panelName,
  diagnosticId,
  onRetry,
}: {
  panelName: string;
  diagnosticId?: string;
  onRetry?: () => void;
}) {
  const router = useRouter();
  return (
    <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-800">{panelName} unavailable</p>
          <p className="mt-1 text-xs text-amber-800">
            If the problem persists, contact admin.
          </p>
          {diagnosticId && (
            <p className="mt-1 text-[10px] text-amber-500">
              Reference ID: <span className="font-mono">{diagnosticId}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => { if (onRetry) onRetry(); else router.refresh(); }}
            className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    </section>
  );
}
