"use client";

import { useState } from "react";
import { ChevronDownIcon } from "./icons";

const PREVIEW = 5;

export type AuditLogItem = {
  id: string;
  action: string;
  entityType: string | null;
  description: string;
  ts: string;
  actor: string | null;
};

function actionBadge(action: string): { label: string; className: string } {
  const a = action.toUpperCase();
  if (a.includes("CREATE")) return { label: "CREATE", className: "bg-blue-100 text-blue-700" };
  if (a.includes("UPDATE")) return { label: "UPDATE", className: "bg-amber-100 text-amber-800" };
  if (a.includes("DELETE")) return { label: "DELETE", className: "bg-red-100 text-red-700" };
  if (a.includes("ANALYZE") || a.includes("ANALYSIS")) return { label: "ANALYZE", className: "bg-violet-100 text-violet-700" };
  if (a.includes("EXPORT")) return { label: "EXPORT", className: "bg-emerald-100 text-emerald-700" };
  return { label: action.slice(0, 12), className: "bg-slate-100 text-slate-600" };
}

export function AuditTrailList({ items }: { items: AuditLogItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, PREVIEW);

  return (
    <>
      <div className="divide-y">
        {visible.map((log) => {
          const badge = actionBadge(log.action);
          return (
            <div key={log.id} className="flex items-start gap-3 px-5 py-3">
              <div className="mt-0.5 min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}>
                    {badge.label}
                  </span>
                  {log.entityType && (
                    <span className="text-xs font-medium text-slate-500">{log.entityType}</span>
                  )}
                  <span className="text-xs text-slate-400">{log.ts}</span>
                  {log.actor && (
                    <span className="text-xs text-slate-400">by {log.actor}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-slate-700">{log.description}</p>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > PREVIEW && (
        <div className="border-t px-5 py-3">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <span className="inline-flex items-center gap-1">
              <ChevronDownIcon className={showAll ? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"} />
              {showAll ? "Show fewer" : `Show all ${items.length} entries`}
            </span>
          </button>
        </div>
      )}
    </>
  );
}
