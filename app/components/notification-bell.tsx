"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  SearchIcon, DocumentIcon, ClockIcon, BrainIcon, TrophyIcon, WarningIcon,
  InfoIcon, BellIcon, CrossIcon,
} from "../../components/icons";

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

function isSafeInternalLink(link: string): boolean {
  try {
    // Basic prefix checks
    if (!link.startsWith("/") || link.startsWith("//") || link.startsWith("/\\")) {
      return false;
    }

    // Reject backslashes and control characters (ASCII 0-31 and 127)
    if (/[\\\x00-\x1F\x7F]/.test(link)) {
      return false;
    }

    // Reject encoded backslashes, slashes, and CR/LF/control characters to prevent bypasses
    const lowerLink = link.toLowerCase();
    if (
      lowerLink.includes("%5c") ||
      lowerLink.includes("%2f") ||
      lowerLink.includes("%0d") ||
      lowerLink.includes("%0a")
    ) {
      return false;
    }

    // Native URL parser check against a secure dummy origin
    const parsed = new URL(link, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return false;
    }

    // Recheck the parsed pathname to ensure no normalization tricks occurred
    if (
      !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//") ||
      parsed.pathname.startsWith("/\\") ||
      parsed.pathname.includes("\\")
    ) {
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

const TYPE_ICON: Record<string, ReactNode> = {
  TENDER_ANALYZED: <SearchIcon />,
  TENDER_GENERATED: <DocumentIcon />,
  TENDER_DEADLINE_SOON: <ClockIcon />,
  KNOWLEDGE_IMPORTED: <BrainIcon />,
  BID_OUTCOME_RECORDED: <TrophyIcon />,
  COMPLIANCE_GAP_FOUND: <WarningIcon />,
  SYSTEM: <InfoIcon />,
};

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [markingReadIds, setMarkingReadIds] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Synchronous mutex lock to protect against same-tick race conditions
  const isMarkingRef = useRef(false);

  // Derived state to check if any individual markRead request is currently in flight
  const isAnyMarkingRead = Object.values(markingReadIds).some(Boolean);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadNotifications(): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (res.ok) {
        const data = await res.json() as { notifications: Notification[]; unreadCount: number };
        setNotifications(data.notifications);
        setUnread(data.unreadCount);
        return true;
      } else {
        setError("Failed to load notifications.");
        return false;
      }
    } catch (err) {
      setError("Failed to load notifications.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead(): Promise<boolean> {
    if (isMarkingRef.current || markingAllRead || isAnyMarkingRead) return false;
    isMarkingRef.current = true;
    setMarkingAllRead(true);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      if (res.ok) {
        // Authoritatively sync final read state from server (no optimistic client arithmetic)
        const refreshSuccess = await loadNotifications();
        return refreshSuccess;
      } else {
        setError("Failed to mark notifications as read.");
        return false;
      }
    } catch (err) {
      setError("Failed to mark notifications as read.");
      return false;
    } finally {
      setMarkingAllRead(false);
      isMarkingRef.current = false;
    }
  }

  async function markRead(id: string): Promise<boolean> {
    if (isMarkingRef.current || markingReadIds[id]) return false;
    isMarkingRef.current = true;
    setMarkingReadIds((prev) => ({ ...prev, [id]: true }));
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (res.ok) {
        // Authoritatively sync final read state from server (no optimistic client arithmetic)
        const refreshSuccess = await loadNotifications();
        return refreshSuccess;
      } else {
        setError("Failed to mark notification as read.");
        return false;
      }
    } catch (err) {
      setError("Failed to mark notification as read.");
      return false;
    } finally {
      setMarkingReadIds((prev) => ({ ...prev, [id]: false }));
      isMarkingRef.current = false;
    }
  }

  function handleOpen() {
    setOpen((v) => !v);
    if (!open) void loadNotifications();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        aria-controls="notification-popup"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="notification-popup" className="absolute right-0 top-10 z-50 w-80 rounded-2xl border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead()}
                disabled={markingAllRead || isAnyMarkingRead}
                className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {error && (
            <div role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-600 border-b">
              {error}
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {loading && <p className="px-4 py-6 text-center text-sm text-slate-600">Loading…</p>}
            {!loading && notifications.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-600">No notifications yet.</p>
            )}
            {!loading && notifications.map((n) => {
              const isLinkSafe = n.link && isSafeInternalLink(n.link);
              return (
                <div
                  key={n.id}
                  className={`flex gap-3 border-b px-4 py-3 last:border-b-0 ${n.readAt ? "bg-white" : "bg-blue-50"}`}
                >
                  <span className="mt-0.5 text-base shrink-0">{TYPE_ICON[n.type] ?? <BellIcon />}</span>
                  <div className="flex-1 min-w-0">
                    {n.link && isLinkSafe ? (
                      <Link
                        href={n.link}
                        onClick={async (e) => {
                          e.preventDefault();
                          if (isMarkingRef.current || markingAllRead || markingReadIds[n.id]) return;

                          if (n.readAt !== null) {
                            // Already read! Navigate directly without calling markRead() or making a PATCH request
                            setOpen(false);
                            router.push(n.link!);
                          } else {
                            // Unread! Call markRead and wait for it to succeed before navigating
                            const success = await markRead(n.id);
                            if (success) {
                              setOpen(false);
                              router.push(n.link!);
                            }
                          }
                        }}
                        className={`block text-sm font-medium text-slate-900 hover:text-blue-700 truncate ${
                          markingAllRead || markingReadIds[n.id] ? "pointer-events-none opacity-50" : ""
                        }`}
                      >
                        {n.title}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium text-slate-900 truncate">{n.title}</p>
                    )}
                    {n.body && <p className="mt-0.5 text-xs text-slate-700 line-clamp-2">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-slate-600">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <button
                      onClick={() => void markRead(n.id)}
                      disabled={markingAllRead || markingReadIds[n.id]}
                      className="mt-0.5 shrink-0 text-xs text-slate-600 hover:text-slate-600 disabled:opacity-50"
                      aria-label={`Mark "${n.title}" as read`}
                    >
                      <CrossIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
