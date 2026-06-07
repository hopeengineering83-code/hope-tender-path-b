"use client";

interface CollapsiblePanelProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

export function CollapsiblePanel({ title, isOpen, onToggle, badge, children }: CollapsiblePanelProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 active:bg-slate-200 transition-colors min-h-[48px] touch-manipulation"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          {!isOpen && badge}
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </div>
  );
}
