import type { ReactNode } from "react";
import Link from "next/link";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="analytics-responsive min-w-0 max-w-full">
      <style>{`
        .analytics-responsive :where(section, article, div) { min-width: 0; }
        .analytics-responsive :where(p, a, span) { overflow-wrap: anywhere; }
        .analytics-responsive :where(svg, canvas) { max-width: 100%; height: auto; }
      `}</style>
      <aside
        aria-label="Analytics score interpretation"
        className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm"
      >
        <p className="font-semibold">Readiness score interpretation</p>
        <p className="mt-1 leading-6">
          Percentages labelled <strong>Readiness Score</strong> on this analytics page are legacy workflow-completion scores. A score of 100% does not mean the final submission package is ready, approved, or exportable.
        </p>
        <p className="mt-2 leading-6">
          Use each tender&apos;s canonical final-package status, blockers, and export-readiness checks before release. <Link href="/dashboard/tenders" className="font-semibold text-amber-900 underline underline-offset-2">Open tender workspaces</Link>.
        </p>
      </aside>
      {children}
    </div>
  );
}
