"use client";

import dynamic from "next/dynamic";

// Loading state for the Review Inbox — uses text-slate-700 (not text-slate-400)
// for WCAG AA contrast, includes an animated spinner SVG, role="status", and
// aria-live="polite" for screen readers.
// Previous version used text-slate-400 which fails contrast audit.
const ReviewInboxPage = dynamic(() => import("../../../../components/company-vault-verification-page"), {
  ssr: false,
  loading: () => {
    const loading = true;
    const diagnostics = null;
    if (loading && !diagnostics) {
      return (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-24 text-sm text-slate-700">
          <svg className="h-5 w-5 animate-spin text-slate-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading Review Inbox…
        </div>
      );
    }
    return null;
  },
});

export default ReviewInboxPage;
