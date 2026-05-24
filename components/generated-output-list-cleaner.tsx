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

function clean(root: HTMLElement | null) {
  if (!root) return;
  const panel = findOutputsPanel(root);
  if (!panel) return;

  const rows = Array.from(panel.querySelectorAll("li")) as HTMLElement[];
  const visible = new Set<string>();
  let oldCount = 0;
  let plannedCount = 0;
  let duplicateCount = 0;
  let shownCount = 0;

  for (const row of rows) {
    const text = textOf(row);
    const title = textOf(row.querySelector("p")) || text.slice(0, 120);
    const key = keyOf(title);
    const historical = /\b(SUPSERSEDED|SUPERSEDED)\b/i.test(text) || /marked\s+superseded|superseded\s+by/i.test(text);
    const plannedOnly = /\bPLANNED\b/i.test(text) && !/\bGENERATED\b/i.test(text);

    row.classList.remove("hidden");
    if (historical) {
      row.classList.add("hidden");
      oldCount += 1;
      continue;
    }
    if (plannedOnly) {
      row.classList.add("hidden");
      plannedCount += 1;
      continue;
    }
    if (key && visible.has(key)) {
      row.classList.add("hidden");
      duplicateCount += 1;
      continue;
    }
    if (key) visible.add(key);
    shownCount += 1;
  }

  const previous = panel.querySelector("[data-generated-clean-summary]");
  if (previous) previous.remove();

  const cleanedCount = oldCount + plannedCount + duplicateCount;
  const headerRow = panel.querySelector("h2")?.parentElement;
  if (cleanedCount > 0 && headerRow) {
    const summary = document.createElement("p");
    summary.setAttribute("data-generated-clean-summary", "true");
    summary.className = "mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800";
    summary.textContent = `Showing ${shownCount} current output(s). Hidden ${oldCount} historical/superseded, ${plannedCount} planned-only, and ${duplicateCount} duplicate row(s). Use Export Readiness for final ZIP blockers.`;
    headerRow.insertAdjacentElement("afterend", summary);
  }
}

export function GeneratedOutputListCleaner({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    clean(root);
    if (!root) return;

    const observer = new MutationObserver(() => clean(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [targetId]);

  return null;
}
