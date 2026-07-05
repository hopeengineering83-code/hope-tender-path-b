"use client";

import { useEffect } from "react";

function textOf(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function keyOf(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.(docx?|pdf|xlsx?|zip)$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findOutputsPanel(root: HTMLElement): HTMLElement | null {
  const heading = Array.from(root.querySelectorAll("h2")).find((node) => textOf(node) === "Generated outputs");
  return heading?.closest(".rounded-2xl") as HTMLElement | null;
}

function setHidden(row: HTMLElement, hidden: boolean): boolean {
  const hadHidden = row.classList.contains("hidden");
  if (hadHidden === hidden) return false;
  row.classList.toggle("hidden", hidden);
  return true;
}

function upsertSummary(panel: HTMLElement, text: string | null): boolean {
  const previous = panel.querySelector("[data-generated-clean-summary]") as HTMLElement | null;
  if (!text) {
    if (!previous) return false;
    previous.remove();
    return true;
  }

  if (previous) {
    if (previous.textContent === text) return false;
    previous.textContent = text;
    return true;
  }

  const headerRow = panel.querySelector("h2")?.parentElement;
  if (!headerRow) return false;
  const summary = document.createElement("p");
  summary.setAttribute("data-generated-clean-summary", "true");
  summary.className = "mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800";
  summary.textContent = text;
  headerRow.insertAdjacentElement("afterend", summary);
  return true;
}

function clean(root: HTMLElement | null): boolean {
  if (!root) return false;
  const panel = findOutputsPanel(root);
  if (!panel) return false;

  const rows = Array.from(panel.querySelectorAll("li")) as HTMLElement[];
  const visible = new Set<string>();
  let oldCount = 0;
  let plannedCount = 0;
  let duplicateCount = 0;
  let shownCount = 0;
  let changed = false;

  for (const row of rows) {
    const text = textOf(row);
    const title = textOf(row.querySelector("p")) || text.slice(0, 120);
    const key = keyOf(title);
    const historical = /\b(SUPSERSEDED|SUPERSEDED)\b/i.test(text) || /marked\s+superseded|superseded\s+by/i.test(text);
    const plannedOnly = /\bPLANNED\b/i.test(text) && !/\bGENERATED\b/i.test(text);

    let shouldHide = false;
    if (historical) {
      shouldHide = true;
      oldCount += 1;
    } else if (plannedOnly) {
      shouldHide = true;
      plannedCount += 1;
    } else if (key && visible.has(key)) {
      shouldHide = true;
      duplicateCount += 1;
    } else {
      if (key) visible.add(key);
      shownCount += 1;
    }
    changed = setHidden(row, shouldHide) || changed;
  }

  const cleanedCount = oldCount + plannedCount + duplicateCount;
  const summaryText = cleanedCount > 0
    ? `Showing ${shownCount} current output(s). Hidden ${oldCount} historical/superseded, ${plannedCount} planned-only, and ${duplicateCount} duplicate row(s). Use Export Readiness for final ZIP blockers.`
    : null;
  changed = upsertSummary(panel, summaryText) || changed;
  return changed;
}

export function GeneratedOutputListCleaner({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    clean(root);
    if (!root) return;

    let scheduled = false;
    const observer = new MutationObserver((mutations) => {
      if (mutations.every((m) => (m.target as HTMLElement | null)?.closest?.("[data-generated-clean-summary]"))) return;
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        clean(root);
      });
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: false });
    return () => observer.disconnect();
  }, [targetId]);

  return null;
}
