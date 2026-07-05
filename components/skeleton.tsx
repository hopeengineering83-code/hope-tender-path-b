// Shared skeleton loader (PR #253).
//
// Replaces "Loading…" text strings across the app with proper
// shape-preserving skeleton placeholders. Reduces perceived load
// time and prevents layout shift when the real content arrives.
//
// Variants:
//   <Skeleton/>                — generic block (full-width × 1rem height)
//   <Skeleton variant="text"/> — single text line
//   <Skeleton variant="card"/> — card-shaped block (24rem × 12rem)
//   <Skeleton variant="row"/>  — table-row skeleton (height matches a tr)
//   <Skeleton variant="circle"/> — round avatar/icon shape
//
// Custom widths/heights via className tailwind utilities.

import type { CSSProperties } from "react";

interface SkeletonProps {
  variant?: "default" | "text" | "card" | "row" | "circle";
  className?: string;
  style?: CSSProperties;
  // Optional ARIA label for screen readers — defaults to "Loading content"
  ariaLabel?: string;
}

const VARIANT_CLASS: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  default: "h-4 w-full rounded",
  text: "h-3.5 w-3/4 rounded",
  card: "h-48 w-full rounded-2xl",
  row: "h-12 w-full rounded",
  circle: "h-10 w-10 rounded-full",
};

export function Skeleton({ variant = "default", className = "", style, ariaLabel = "Loading content" }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      className={`skeleton ${VARIANT_CLASS[variant]} ${className}`}
      style={style}
    />
  );
}

// Convenience: composed skeleton patterns for common cases.

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={i === lines - 1 ? "w-1/2" : "w-full"}
          ariaLabel={i === 0 ? "Loading text" : undefined}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-sm ${className}`}>
      <Skeleton variant="text" className="w-1/3" />
      <div className="mt-4">
        <SkeletonText lines={4} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm" role="status" aria-label="Loading table">
      <div className="border-b bg-slate-50 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} variant="text" className="flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton key={c} variant="text" className="flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
