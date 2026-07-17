/**
 * Reusable empty state component for lists, panels, and dashboards.
 *
 * Usage:
 *   <EmptyState icon={<DocumentIcon />} title="No tenders yet" description="Upload your first tender document to get started." actionLabel="Upload Tender" onAction={() => router.push('/dashboard/tenders/new')} />
 */
"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  // A rendered icon element (inline SVG), not a raw emoji/Unicode string —
  // see components/icons.tsx for why.
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-4xl" aria-hidden="true">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
