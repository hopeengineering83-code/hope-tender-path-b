"use client";

// Thin client-side wrapper for TenderChatPanel.
// Using next/dynamic with ssr:false here (inside a Client Component) is valid.
// The Server Component page.tsx imports this wrapper instead of using
// next/dynamic directly, which is not allowed in Server Components in Next.js 15.

import dynamic from "next/dynamic";

const TenderChatPanel = dynamic(
  () => import("./tender-chat-panel").then((m) => ({ default: m.TenderChatPanel })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="text-xs text-slate-400">Loading Tender Assistant…</p>
      </div>
    ),
  },
);

export function TenderChatPanelWrapper({ tenderId, canMutate = false }: { tenderId: string; canMutate?: boolean }) {
  return <TenderChatPanel tenderId={tenderId} canMutate={canMutate} />;
}
