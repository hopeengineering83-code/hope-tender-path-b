"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

type Notification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_ICON: Record<string, string> = {
  TENDER_ANALYZED: "🔎",
  TENDER_GENERATED: "📄",
  TENDER_DEADLINE_SOON: "⏰",
  KNOWLEDGE_IMPORTED: "🧠",
  BID_OUTCOME_RECORDED: "🏆",
  COMPLIANCE_GAP_FOUND: "⚠️",
  SYSTEM: "ℹ️",
};

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadNotifications() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (res.ok) {
        const data = await res.json() as { notifications: Notification[]; unreadCount: number };
        setNotifications(data.notifications);
        setUnread(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAll: true }) });
    setUnread(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }

  async function markRead(id: string) {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    setUnread((c) => Math.max(0, c - 1));
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  }

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) void loadNotifications();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        aria-label="Notifications"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-2xl border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button onClick={() => void markAllRead()} className="text-xs text-blue-600 hover:text-blue-800">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>}
            {!loading && notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No notifications yet.</p>
            )}
            {!loading && notifications.map((n) => (
              <div
                key={n.id}
                className={`flex gap-3 border-b px-4 py-3 last:border-b-0 ${n.readAt ? "bg-white" : "bg-blue-50"}`}
              >
                <span className="mt-0.5 text-base shrink-0">{TYPE_ICON[n.type] ?? "🔔"}</span>
                <div className="flex-1 min-w-0">
                  {n.link ? (
                    <Link href={n.link} onClick={() => { void markRead(n.id); setOpen(false); }} className="block text-sm font-medium text-slate-900 hover:text-blue-700 truncate">
                      {n.title}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-slate-900 truncate">{n.title}</p>
                  )}
                  {n.body && <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{n.body}</p>}
                  <p className="mt-1 text-[10px] text-slate-400">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <button onClick={() => void markRead(n.id)} className="mt-0.5 shrink-0 text-xs text-slate-400 hover:text-slate-600">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
