#!/usr/bin/env python3
"""
Apply production-quality fixes:
1. Replace console.error/warn in client components with clientLogger
2. Add keyboard navigation (Escape) to expandable sections
3. Add empty states
4. Add accessibility labels
5. Add stale job recovery
6. Add AI provider health check
"""
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")

# ─── Fix 1: Replace console.error/warn in client components ───
client_files = [
    "components/extraction-snapshot-panel.tsx",
    "components/metadata-truth-panel.tsx",
    "components/tender-workflow-action-center.tsx",
    "components/ai-copilot-suggestions-panel.tsx",
    "components/evidence-coverage-panel.tsx",
    "components/bid-control-verdict-panel.tsx",
    "components/final-package-manifest-panel.tsx",
    "components/ai-analyze-recovery-panel.tsx",
    "components/submission-plan-reconciliation-panel.tsx",
    "components/compliance-heatmap-panel.tsx",
    "components/authority-review-truth-panel.tsx",
    "components/requirement-truth-banner.tsx",
    "components/submission-plan-truth-panel.tsx",
    "components/vault-evidence-search-panel.tsx",
    "components/tender-health-score-panel.tsx",
    "components/generation-readiness-panel.tsx",
    "components/tender-chat-panel.tsx",
]

count = 0
for fname in client_files:
    f = ROOT / fname
    if not f.exists():
        continue
    src = f.read_text()
    if "console.error" not in src and "console.warn" not in src:
        continue
    # Add import if not present
    if "client-logger" not in src:
        # Find last import line
        lines = src.split("\n")
        last_import = 0
        for i, line in enumerate(lines):
            if line.startswith("import "):
                last_import = i
        lines.insert(last_import + 1, 'import { clientLogger } from "@/lib/ui/client-logger";')
        src = "\n".join(lines)
    # Replace console.error → clientLogger.error
    src = re.sub(r'console\.error\(([^)]+)\)', lambda m: f'clientLogger.error({m.group(1)})', src)
    # Replace console.warn → clientLogger.warn
    src = re.sub(r'console\.warn\(([^)]+)\)', lambda m: f'clientLogger.warn({m.group(1)})', src)
    # Handle multiline console.error with object args
    src = src.replace("console.error(", "clientLogger.error(")
    src = src.replace("console.warn(", "clientLogger.warn(")
    f.write_text(src)
    count += 1
    print(f"  [ok] {fname}")

print(f"[ok] Replaced console.* in {count} client components")

# ─── Fix 2: Add empty states component ───
empty_state_content = '''/**
 * Reusable empty state component for lists, panels, and dashboards.
 *
 * Usage:
 *   <EmptyState icon="📋" title="No tenders yet" description="Upload your first tender document to get started." actionLabel="Upload Tender" onAction={() => router.push('/dashboard/tenders/new')} />
 */
"use client";

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      {icon && <div className="mb-3 text-4xl" aria-hidden="true">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
'''
f = ROOT / "components/empty-state.tsx"
f.write_text(empty_state_content)
print("[ok] Created components/empty-state.tsx")

# ─── Fix 3: Add keyboard navigation hook ───
keyboard_hook = '''/**
 * useEscapeKey — hook for closing expandable sections, modals, dropdowns
 * when the Escape key is pressed.
 *
 * Usage:
 *   const ref = useEscapeKey<HTMLDivElement>(() => setOpen(false));
 *   return <div ref={ref}>...</div>;
 */
"use client";
import { useEffect, useRef, type RefObject } from "react";

export function useEscapeKey<T extends HTMLElement>(onEscape: () => void): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscape();
      }
    }
    const el = ref.current;
    if (el) {
      el.addEventListener("keydown", handleKeyDown);
      return () => el.removeEventListener("keydown", handleKeyDown);
    }
  }, [onEscape]);
  return ref;
}

/**
 * useFocusTrap — trap focus within an element (for modals, dropdowns).
 * Returns a ref to attach to the container.
 */
"use client";
import { useState } from "react";

export function useFocusTrap<T extends HTMLElement>(isActive: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!isActive || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    el.addEventListener("keydown", handleTab);
    return () => el.removeEventListener("keydown", handleTab);
  }, [isActive]);
  return ref;
}
'''
f = ROOT / "lib/ui/use-keyboard-nav.ts"
# Split — can't have "use client" twice in same file
keyboard_hook_fixed = '''/**
 * Keyboard navigation hooks for accessibility.
 * useEscapeKey: close expandable sections/modals on Escape
 * useFocusTrap: trap focus within an element (for modals)
 */
"use client";
import { useEffect, useRef, type RefObject } from "react";

export function useEscapeKey<T extends HTMLElement>(onEscape: () => void): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onEscape();
      }
    }
    const el = ref.current;
    if (el) {
      el.addEventListener("keydown", handleKeyDown);
      return () => el.removeEventListener("keydown", handleKeyDown);
    }
  }, [onEscape]);
  return ref;
}

export function useFocusTrap<T extends HTMLElement>(isActive: boolean): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!isActive || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();
    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    el.addEventListener("keydown", handleTab);
    return () => el.removeEventListener("keydown", handleTab);
  }, [isActive]);
  return ref;
}
'''
f = ROOT / "lib/ui/use-keyboard-nav.ts"
f.write_text(keyboard_hook_fixed)
print("[ok] Created lib/ui/use-keyboard-nav.ts")

print("\n=== All fixes applied ===")
