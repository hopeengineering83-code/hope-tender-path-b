/**
 * Breadcrumb navigation for tender pages.
 * Shows: Dashboard > Tenders > [Tender Title]
 */
import Link from "next/link";

interface TenderBreadcrumbProps {
  tenderTitle?: string;
}

export function TenderBreadcrumb({ tenderTitle }: TenderBreadcrumbProps) {
  const truncatedTitle = tenderTitle && tenderTitle.length > 50
    ? tenderTitle.slice(0, 50) + "…"
    : tenderTitle;

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-sm text-slate-500">
      <Link href="/dashboard" className="hover:text-slate-900 hover:underline">
        Dashboard
      </Link>
      <span aria-hidden="true">/</span>
      <Link href="/dashboard/tenders" className="hover:text-slate-900 hover:underline">
        Tenders
      </Link>
      {truncatedTitle && (
        <>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-slate-700" title={tenderTitle}>
            {truncatedTitle}
          </span>
        </>
      )}
    </nav>
  );
}
