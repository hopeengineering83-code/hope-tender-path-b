import "./globals.css";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { AmberContrastGuard } from "../components/amber-contrast-guard";

export const metadata = {
  title: "Hope Tender Proposal Generator",
  description: "AI-powered tender proposal generation and compliance engine for Hope Urban Planning Architectural and Engineering Consultancy",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Hope Tender",
  },
};

export const viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

// ─── CSP nonce propagation ──────────────────────────────────────────────────
//
// The middleware (middleware.ts) generates a per-request nonce and sets it as
// the `x-nonce` downstream header. Reading it here via `headers()` from
// `next/headers` makes this RootLayout a dynamic server component AND —
// critically — Next.js 15 automatically propagates the `nonce` property from
// any <script nonce={...}> tag in the layout to ALL of its own inline
// hydration scripts (the `self.__next_f.push(...)` data pushers). Without
// this, the nonce-based CSP (lib/security/csp.ts) blocks Next.js's inline
// scripts and the page fails to hydrate, producing the "Executing inline
// script violates the following Content Security Policy directive" console
// errors seen in the exact-head screenshot audit.
//
// Ref: https://nextjs.org/docs/app/api-reference/functions/headers
// Ref: https://nextjs.org/docs/app/guides/content-security-policy
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Hope Tender" />
      </head>
      <body className="antialiased">
        <AmberContrastGuard />
        {children}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.getRegistrations().then(function(registrations){registrations.forEach(function(reg){reg.unregister().catch(function(){});});}).catch(function(){});if(window.caches&&caches.keys){caches.keys().then(function(keys){keys.forEach(function(key){caches.delete(key).catch(function(){});});}).catch(function(){});}})}`,
          }}
        />
      </body>
    </html>
  );
}
