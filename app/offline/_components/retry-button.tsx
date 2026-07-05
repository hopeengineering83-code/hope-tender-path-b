"use client";

// Retry button for the offline page (PR #246, fixed in PR #250).
//
// Originally lived inline in app/offline/page.tsx with an onClick
// handler. That broke prerendering because Next.js 15 disallows
// passing event handlers from a server component (which page.tsx
// is, by default, when it exports metadata) into HTML elements.
//
// Splitting the interactive piece out into its own "use client"
// component is the canonical Next.js fix: the page stays
// server-rendered (so metadata works AND the page is precached
// statically), and only this small button hydrates on the client.

export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.location.reload();
      }}
      className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
    >
      Retry connection
    </button>
  );
}
