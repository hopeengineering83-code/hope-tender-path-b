"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/icons";
import { formatTenderStatus } from "../../../lib/tender-workflow";

type TenderItem = {
  id: string;
  title: string;
  clientName: string | null;
  status: string;
  deadline: string | null;
  readinessScore: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  INTAKE: "border-indigo-200 bg-indigo-50 text-indigo-700",
  ANALYZED: "border-sky-200 bg-sky-50 text-sky-700",
  AI_ANALYZED: "border-sky-200 bg-sky-50 text-sky-700",
  AI_ANALYSIS_PARTIAL: "border-yellow-200 bg-yellow-50 text-yellow-700",
  FALLBACK_DRAFT_CREATED: "border-orange-200 bg-orange-50 text-orange-700",
  ANALYSIS_REQUIRES_REVIEW: "border-red-200 bg-red-50 text-red-700",
  MATCHED: "border-violet-200 bg-violet-50 text-violet-700",
  COMPLIANCE_REVIEW: "border-amber-200 bg-amber-50 text-amber-800",
  READY_FOR_GENERATION: "border-cyan-200 bg-cyan-50 text-cyan-700",
  GENERATED: "border-blue-200 bg-blue-50 text-blue-700",
  IN_REVIEW: "border-orange-200 bg-orange-50 text-orange-700",
  APPROVED: "border-green-200 bg-green-50 text-green-700",
  EXPORTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CLOSED: "border-rose-200 bg-rose-50 text-rose-700",
  NO_BID: "border-neutral-800 bg-neutral-800 text-neutral-100",
};

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function urgencyColor(deadline: string): string {
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return "bg-red-500";
  if (days <= 3) return "bg-red-400";
  if (days <= 7) return "bg-amber-400";
  return "bg-blue-400";
}

export function CalendarClient({ tenders }: { tenders: TenderItem[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<number | null>(null);

  function previousMonth() {
    setSelected(null);
    if (month === 0) {
      setMonth(11);
      setYear((value) => value - 1);
    } else {
      setMonth((value) => value - 1);
    }
  }

  function nextMonth() {
    setSelected(null);
    if (month === 11) {
      setMonth(0);
      setYear((value) => value + 1);
    } else {
      setMonth((value) => value + 1);
    }
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDay: Record<number, TenderItem[]> = {};
  for (const tender of tenders) {
    if (!tender.deadline) continue;
    const deadline = new Date(tender.deadline);
    if (deadline.getFullYear() === year && deadline.getMonth() === month) {
      (byDay[deadline.getDate()] ??= []).push(tender);
    }
  }

  const todayDate = now.getFullYear() === year && now.getMonth() === month ? now.getDate() : -1;
  const selectedTenders = selected ? byDay[selected] ?? [] : [];
  const upcoming = tenders
    .filter((tender) => tender.deadline && new Date(tender.deadline) >= now)
    .slice(0, 6);

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900">Deadline Calendar</h1>
          <p className="mt-1 text-sm text-slate-500">Advisory view of stored deadlines. Deadline status does not block authoring.</p>
        </div>
        <div className="grid grid-cols-[44px,minmax(0,1fr),44px] items-center gap-2 sm:min-w-[250px]" aria-label="Calendar month navigation">
          <button type="button" onClick={previousMonth} className="flex h-11 w-11 items-center justify-center rounded-lg border bg-white text-sm hover:bg-slate-50" aria-label="Previous month"><ChevronLeftIcon /></button>
          <span className="min-w-0 text-center text-sm font-semibold text-slate-800" aria-live="polite">{MONTHS[month]} {year}</span>
          <button type="button" onClick={nextMonth} className="flex h-11 w-11 items-center justify-center rounded-lg border bg-white text-sm hover:bg-slate-50" aria-label="Next month"><ChevronRightIcon /></button>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2fr),minmax(280px,1fr)]">
        <section className="min-w-0" aria-label={`${MONTHS[month]} ${year} calendar`}>
          <p className="mb-2 text-xs text-slate-500 sm:hidden">Swipe the calendar horizontally to inspect every day.</p>
          <div className="max-w-full overflow-x-auto rounded-2xl border bg-white shadow-sm [overscroll-behavior-inline:contain]">
            <div className="min-w-[700px]">
              <div className="grid grid-cols-7 border-b bg-slate-50">
                {DAYS_OF_WEEK.map((day) => <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500">{day}</div>)}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: firstDay }).map((_, index) => <div key={`pad-${index}`} className="min-h-[88px] border-b border-r bg-slate-50/50" />)}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const dayTenders = byDay[day] ?? [];
                  const isToday = day === todayDate;
                  const isSelected = selected === day;
                  return (
                    <button
                      type="button"
                      key={day}
                      onClick={() => setSelected(isSelected ? null : day)}
                      aria-pressed={isSelected}
                      aria-label={`${MONTHS[month]} ${day}, ${year}${dayTenders.length ? `, ${dayTenders.length} tender deadlines` : ""}`}
                      className={`min-h-[88px] min-w-0 border-b border-r p-1.5 text-left align-top transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${isSelected ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""}`}
                    >
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-blue-600 text-white" : "text-slate-700"}`}>{day}</span>
                      <span className="mt-1 block space-y-0.5">
                        {dayTenders.slice(0, 3).map((tender) => (
                          <span key={tender.id} className={`flex min-w-0 items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-medium ${STATUS_COLORS[tender.status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`} title={`${tender.title} — ${formatTenderStatus(tender.status)}`}>
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${urgencyColor(tender.deadline!)}`} />
                            <span className="truncate">{tender.title}</span>
                          </span>
                        ))}
                        {dayTenders.length > 3 && <span className="block pl-1 text-[10px] text-slate-500">+{dayTenders.length - 3} more</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className="min-w-0 space-y-4">
          {selected !== null && (
            <section className="rounded-2xl border bg-white p-4 shadow-sm" aria-live="polite">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">{MONTHS[month]} {selected} — {selectedTenders.length} tender{selectedTenders.length === 1 ? "" : "s"}</h2>
              {selectedTenders.length === 0 ? (
                <p className="text-xs text-slate-500">No stored deadlines on this day.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedTenders.map((tender) => (
                    <li key={tender.id}>
                      <Link href={`/dashboard/tenders/${tender.id}`} className="block min-h-11 min-w-0 rounded-xl border px-3 py-2.5 transition-colors hover:bg-slate-50">
                        <p className="break-words text-sm font-medium text-slate-900">{tender.title}</p>
                        {tender.clientName && <p className="mt-0.5 break-words text-xs text-slate-500">{tender.clientName}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[tender.status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}>{formatTenderStatus(tender.status)}</span>
                          {tender.readinessScore != null && <span className="text-xs text-slate-600">{tender.readinessScore}% stored workflow score</span>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Upcoming deadlines</h2>
            {upcoming.length === 0 ? (
              <p className="text-xs text-slate-500">No upcoming stored deadlines.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((tender) => {
                  const deadline = new Date(tender.deadline!);
                  const daysRemaining = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
                  return (
                    <li key={tender.id}>
                      <Link href={`/dashboard/tenders/${tender.id}`} className="flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors hover:bg-slate-50">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-slate-900">{tender.title}</span>
                          {tender.clientName && <span className="block truncate text-[10px] text-slate-500">{tender.clientName}</span>}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${daysRemaining <= 3 ? "bg-red-100 text-red-700" : daysRemaining <= 7 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                          {daysRemaining === 0 ? "today" : daysRemaining === 1 ? "tomorrow" : `${daysRemaining}d`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Legend</h2>
            <ul className="space-y-1.5">
              {[
                { color: "bg-red-500", label: "Past stored deadline" },
                { color: "bg-red-400", label: "Due in 3 days or less" },
                { color: "bg-amber-400", label: "Due in 7 days or less" },
                { color: "bg-blue-400", label: "Due later" },
              ].map((item) => <li key={item.label} className="flex items-center gap-2 text-xs text-slate-600"><span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />{item.label}</li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
