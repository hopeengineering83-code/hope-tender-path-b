import type { ReactNode } from "react";

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="analytics-responsive min-w-0 max-w-full overflow-x-hidden">
      <style>{`
        .analytics-responsive :where(section, article, div) { min-width: 0; }
        .analytics-responsive :where(p, a, span) { overflow-wrap: anywhere; }
        .analytics-responsive :where(svg, canvas) { max-width: 100%; }
      `}</style>
      {children}
    </div>
  );
}
