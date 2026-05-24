"use client";

import { useEffect } from "react";
import { GeneratedOutputListCleaner } from "./generated-output-list-cleaner";

const DUPLICATE_ACTIONS = new Set(["Run Engine", "Running…", "Running...", "⚡ Generate Docs", "Generating…", "Generating..."]);

function normalizeButtonText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function hideDuplicateLegacyActions(root: HTMLElement | null) {
  if (!root) return;
  const buttons = Array.from(root.querySelectorAll("button"));
  for (const button of buttons) {
    const text = normalizeButtonText(button.textContent ?? "");
    if (DUPLICATE_ACTIONS.has(text)) {
      button.setAttribute("data-hidden-duplicate-action", "true");
      button.classList.add("hidden");
    }
  }
}

export function LegacyTenderActionHider({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    hideDuplicateLegacyActions(root);
    if (!root) return;

    const observer = new MutationObserver(() => hideDuplicateLegacyActions(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [targetId]);

  return <GeneratedOutputListCleaner targetId={targetId} />;
}
