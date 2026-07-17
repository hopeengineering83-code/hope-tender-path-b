"use client";
import { useState } from "react";
import { CheckIcon } from "../../../../components/icons";

type DocItem = {
  id: string;
  originalFileName: string;
  size: number;
  aiExtractionStatus: string;
  createdAt: string;
};

type CategoryData = {
  category: string;
  label: string;
  helper: string;
  style: string;
  docs: DocItem[];
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileExt(name: string) {
  return name.toLowerCase().split(".").pop()?.toUpperCase() || "FILE";
}

export function CategoryAccordion({ categories }: { categories: CategoryData[] }) {
  // Start with all categories open so initial UX is same as before
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set(categories.map((c) => c.category))
  );

  function toggle(category: string) {
    setOpenCategories((prev) => {
      const n = new Set(prev);
      n.has(category) ? n.delete(category) : n.add(category);
      return n;
    });
  }

  function collapseAll() {
    setOpenCategories(new Set());
  }

  function expandAll() {
    setOpenCategories(new Set(categories.map((c) => c.category)));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={expandAll} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1">Expand all</button>
        <span className="text-slate-300">|</span>
        <button type="button" onClick={collapseAll} className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1">Collapse all</button>
      </div>
      {categories.map(({ category, label, helper, docs }) => {
        const isOpen = openCategories.has(category);
        return (
          <section key={category} id={category} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => toggle(category)}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-slate-900">{label}</h2>
                <p className="mt-0.5 text-xs text-slate-500 truncate">{helper}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${docs.length > 0 ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}>
                  {docs.length} file{docs.length === 1 ? "" : "s"}
                </span>
                <svg
                  className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-3">
                {docs.length === 0 ? (
                  <p className="text-sm text-slate-400 py-4 text-center">No documents in this category yet.</p>
                ) : (
                  <div className="space-y-2">
                    {docs.map((doc) => (
                      <div key={doc.id} className="rounded-xl border px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-start gap-3">
                          <span className="shrink-0 rounded border bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600">{fileExt(doc.originalFileName)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900">{doc.originalFileName}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                              <span>{formatBytes(doc.size)}</span>
                              {doc.aiExtractionStatus === "EXTRACTED" ? (
                                <span className="text-green-600"><CheckIcon /> Text extracted</span>
                              ) : (
                                <span className="text-slate-400">{doc.aiExtractionStatus === "FAILED" ? "Extraction failed" : "Not extracted"}</span>
                              )}
                              <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
