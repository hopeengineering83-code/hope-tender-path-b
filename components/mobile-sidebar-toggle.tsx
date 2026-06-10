"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type NavLink = { href: string; label: string; icon: string };
type NavGroup = { title: string; links: NavLink[] };

type Props = {
  groups: NavGroup[];
  user: { email: string; role: string; name: string | null };
  company: { name: string } | null;
};

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function MobileSidebarToggle({ groups, user, company }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  }

  function closeDrawer() {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm"
        aria-label="Open navigation"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="text-lg leading-none" aria-hidden="true">☰</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            onClick={closeDrawer}
            aria-label="Close navigation"
            tabIndex={-1}
          />

          <div
            ref={drawerRef}
            className="relative z-10 flex h-full w-72 flex-col bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-title"
          >
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <p id="mobile-navigation-title" className="text-sm font-bold text-slate-900">Hope Tender</p>
                <p className="text-xs text-slate-400 truncate max-w-[180px]">
                  {company?.name ?? "Hope Urban Planning"}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDrawer}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Close navigation"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto space-y-5 px-4 py-4" aria-label="Mobile primary navigation">
              {groups.map((group) => (
                <div key={group.title}>
                  <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {group.title}
                  </p>
                  <div className="space-y-0.5">
                    {group.links.map((link) => {
                      const active = isActive(link.href);
                      return (
                        <Link
                          key={link.href}
                          href={link.href}
                          onClick={closeDrawer}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                            active
                              ? "bg-slate-900 text-white font-medium"
                              : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                          }`}
                        >
                          <span className="text-base leading-none" aria-hidden="true">{link.icon}</span>
                          <span>{link.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            <div className="border-t px-4 py-4">
              <div className="rounded-xl bg-slate-50 px-3 py-3 mb-3">
                <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Signed in as</p>
                <p className="mt-0.5 truncate text-sm font-medium text-slate-900">{user.name ?? user.email}</p>
                <p className="text-xs text-slate-500">{user.role.replaceAll("_", " ")}</p>
              </div>
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
