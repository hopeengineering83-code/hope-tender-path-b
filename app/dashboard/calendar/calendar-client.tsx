"use client";

import { useState } from "react";
import Link from "next/link";

type TenderItem = {
  id: string;
  title: string;
  clientName: string | null;
  status: string;
  deadline: string | null;
  readinessScore: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-slate-200",
  INTAKE: "bg-blue-50 text-blue-700 border-blue-200",
  ANALYSIS: "bg-indigo-50 text-indigo-700 border-indigo-200",
  MATCHING: "bg-violet-50 text-violet-700 border-violet-200",
  REVIEW: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-green-50 text-green-700 border-green-200",
  EXPORTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CLOSED: "bg-slate-50 text-slate-500 border-slate-200",
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function urgencyColor(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  const days = diff / 86_400_000;
  if (days < 0) return "bg-red-500";
  if (days <= 3) return "bg-red-400";
  if (days <= 7) return "bg-amber-400";
  return "bg-blue-400";
}

export function CalendarClient({ tenders }: { tenders: TenderItem[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay: Record<number, TenderItem[]> = {};
  for (const t of tenders) {
    if (!t.deadline) continue;
    const d = new Date(t.deadline);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const day = d.getDate();
      (byDay[day] ??= []).push(t);
    }
  }

  const todayDate = now.getFullYear() === year && now.getMonth() === month ? now.getDate() : -1;

  const selectedTenders = selected
    ? (byDay[parseInt(selected, 10)] ?? [])
    : [];

  const upcoming = tenders.filter((t) => {
    if (!t.deadline) return false;
    const d = new Date(t.deadline);
    return d >= now;
  }).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Deadline Calendar</h1>
          <p className="mt-0.5 text-slate-500">Active tender deadlines — EXPORTED/CLOSED tenders excluded</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">◀</button>
          <span className="min-w-[140px] text-center text-sm font-semibold text-slate-800">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">▶</button>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(280px,1fr)]">
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b bg-slate-50">
            {DOW.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`pad-${i}`} className="border-b border-r bg-slate-50/50 min-h-[80px]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayTenders = byDay[day] ?? [];
              const isToday = day === todayDate;
              const isSelected = selected === String(day);
              return (
                <button
                  key={day}
                  onClick={() => setSelected(isSelected ? null : String(day))}
                  className={`border-b border-r min-h-[80px] p-1.5 text-left align-top transition-colors hover:bg-blue-50 ${
                    isSelected ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""
                  }`}
                >
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday ? "bg-blue-600 text-white" : "text-slate-700"
                  }`}>{day}</span>
                  <div className="mt-1 space-y-0.5">
                    {dayTenders.slice(0, 3).map((t) => (
                      <div key={t.id} className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium border ${STATUS_COLORS[t.status] ?? "bg-blue-50 text-blue-700 border-blue-200"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${urgencyColor(t.deadline!)}`} />
                        <span className="truncate">{t.title}</span>
                      </div>
                    ))}
                    {dayTenders.length > 3 && (
                      <p className="text-[10px] text-slate-400 pl-1">+{dayTenders.length - 3} more</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          {selected && selectedTenders.length > 0 && (
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {MONTHS[month]} {selected} — {selectedTenders.length} tender{selectedTenders.length > 1 ? "s" : ""}
              </h2>
              <ul className="space-y-2">
                {selectedTenders.map((t) => (
                  <li key={t.id}>
                    <Link href={`/dashboard/tenders/${t.id}`}
                      className="block rounded-xl border px-3 py-2.5 hover:bg-slate-50 transition-colors">
                      <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
                      {t.clientName && <p className="text-xs text-slate-400 mt-0.5">{t.clientName}</p>}
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${STATUS_COLORS[t.status] ?? ""}`}>{t.status}</span>
                        {t.readinessScore != null && (
                          <span className={`text-xs font-medium ${t.readinessScore >= 80 ? "text-green-600" : t.readinessScore >= 50 ? "text-amber-600" : "text-red-500"}`}>
                            {t.readinessScore}% ready
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Upcoming deadlines</h2>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-400">No upcoming deadlines.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((t) => {
                  const d = new Date(t.deadline!);
                  const diff = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
                  return (
                    <li key={t.id}>
                      <Link href={`/dashboard/tenders/${t.id}`}
                        className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2 hover:bg-slate-50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-900 truncate">{t.title}</p>
                          {t.clientName && <p className="text-[10px] text-slate-400">{t.clientName}</p>}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          diff <= 3 ? "bg-red-100 text-red-700" :
                          diff <= 7 ? "bg-amber-100 text-amber-700" :
                          "bg-slate-100 text-slate-600"
                        }`}>
                          {diff === 0 ? "today" : diff === 1 ? "tomorrow" : `${diff}d`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Legend</h2>
            <ul className="space-y-1.5">
              {[
                { color: "bg-red-500", label: "Overdue" },
                { color: "bg-red-400", label: "Due in ≤ 3 days" },
                { color: "bg-amber-400", label: "Due in ≤ 7 days" },
                { color: "bg-blue-400", label: "Due later" },
              ].map((item) => (
                <li key={item.label} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
