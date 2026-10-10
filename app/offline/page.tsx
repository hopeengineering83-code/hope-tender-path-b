// Dedicated offline page served by the service worker (PR #246) when
// the network fails on a navigation request and the requested URL
// isn't in the cache. Replaces the generic browser "page can't be
// loaded" error with branded, helpful messaging.
//
// This page is precached at service-worker install time. It must be
// fully self-contained (no async data fetching) so it renders
// instantly when the network is down.
//
// PR #250 — Server component (so metadata export works AND the page
// is statically prerendered for the service-worker cache). The retry
// button is split into a small "use client" sub-component so the
// onClick handler doesn't break prerendering.

import Link from "next/link";
import { RetryButton } from "./_components/retry-button";

export const metadata = {
  title: "Offline — Hope Tender",
  description: "You are currently offline. Hope Tender will reconnect automatically.",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7 text-amber-600"
            aria-hidden="true"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <h1 className="mt-5 text-center text-xl font-semibold text-slate-900">
          You&apos;re offline
        </h1>
        <p className="mt-2 text-center text-sm text-slate-600">
          Hope Tender needs a network connection for AI analysis, document generation, and ZIP export. Reconnect to resume work.
        </p>

        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-xs text-slate-600">
          <p className="font-medium text-slate-700">What still works offline</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Browsing tenders you previously visited</li>
            <li>Reading cached dashboard pages</li>
            <li>Reviewing already-downloaded files</li>
          </ul>
        </div>

        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          <p className="font-medium">What requires connection</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            <li>Uploading new tender files</li>
            <li>Running AI analysis or matching</li>
            <li>Generating proposal documents</li>
            <li>Downloading the ZIP submission package</li>
          </ul>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <RetryButton />
          <Link
            href="/dashboard"
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Go to dashboard (cached)
          </Link>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-600">
        Hope Tender Proposal Generator &middot; Offline mode
      </p>
    </div>
  );
}
