import "./globals.css";
import type { ReactNode } from "react";
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

export default function RootLayout({ children }: { children: ReactNode }) {
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
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.getRegistrations().then(function(registrations){registrations.forEach(function(reg){reg.unregister().catch(function(){});});}).catch(function(){});if(window.caches&&caches.keys){caches.keys().then(function(keys){keys.forEach(function(key){caches.delete(key).catch(function(){});});}).catch(function(){});}})}`,
          }}
        />
      </body>
    </html>
  );
}
