import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Hope Tender Proposal Generator",
  description: "Tender engine foundation"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
