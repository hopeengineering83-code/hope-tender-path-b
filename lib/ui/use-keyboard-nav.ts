/**
 * Keyboard navigation hooks for accessibility.
 * useEscapeKey: close expandable sections/modals on Escape
 * useFocusTrap: trap focus within an element (for modals)
 */
"use client";
import { useEffect, useRef } from "react";

export function useEscapeKey<T extends HTMLElement>(onEscape: () => void) {
  const ref = useRef<T | null>(null);
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

export function useFocusTrap<T extends HTMLElement>(isActive: boolean) {
  const ref = useRef<T | null>(null);
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
