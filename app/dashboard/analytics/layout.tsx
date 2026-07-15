import type { ReactNode } from "react";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-hidden">
      <style>{`
        .analytics-responsive :where(section, article, div) { min-width: 0; }
        .analytics-responsive :where(p, a, span) { overflow-wrap: anywhere; }
        .analytics-responsive :where(svg, canvas) { max-width: 100%; }
        @media (max-width: 639px) {
          .analytics-responsive :where([class*="w-36"]) {
            width: auto !important;
            min-width: 7rem;
          }
        }
      `}</style>
      <div className="analytics-responsive min-w-0 max-w-full">{children}</div>
    </div>
  );
}
