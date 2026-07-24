"use client";

/**
 * BlockerActionLink — renders an actionable recovery button next to a
 * workflow blocker message.
 *
 * The previous pattern across the app was:
 *   <li>{blocker.message}</li>
 *
 * The user saw "blocked because: X" but had to find the right panel
 * manually. This component replaces that pattern with:
 *   <li>
 *     {blocker.message}
 *     <BlockerActionLink tenderId={tenderId} actionCode={blocker.nextAction} canMutate={canMutate} />
 *   </li>
 *
 * The component looks up the action in the recovery-command-actions
 * registry and renders the appropriate button:
 *   - api POST/DELETE → fires the mutation, then calls onDone so the
 *     parent can refresh.
 *   - api GET → navigates to the endpoint (used for download-style reads).
 *   - navigate → router.push to the path.
 *   - scroll → calls onScrollAnchor with the anchorId so the parent can
 *     open the parent disclosure and scroll. (The parent owns the scroll
 *     because it knows which disclosures wrap the target panel.)
 *   - refresh → calls onDone so the parent can re-fetch.
 *   - download → navigates to the path (triggers browser download).
 *
 * For REVIEWER users (canMutate=false), mutation actions are HIDDEN
 * (not disabled) per the rule in lib/recovery-command-actions.ts: a
 * disabled control the user can't use is the frozen/silent pattern.
 *
 * Accessibility:
 *   - aria-busy during in-flight mutations
 *   - title attribute carries the spec's message so screen readers get
 *     the longer explanation
 *   - keyboard-accessible (it's a <button>)
 *   - disabled state uses opacity-60 (≥60% per the disabled-readable rule)
 */

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  getRecoveryCommandActionSpec,
  isMutationAction,
  renderRecoveryActionPath,
} from "@/lib/recovery-command-actions";
import {
  ArrowRightIcon,
  BoltIcon,
  RefreshIcon,
  DownloadIcon,
  ClockIcon,
} from "./icons";

export interface BlockerActionLinkProps {
  /** The tender the blocker applies to. */
  tenderId: string;
  /** The action code from blocker.nextAction (e.g. "REPAIR_EXTRACTION"). */
  actionCode: string;
  /** True if the current user can mutate (ADMIN/PROPOSAL_MANAGER). */
  canMutate: boolean;
  /** Called after a successful mutation or refresh — parent should re-fetch. */
  onDone?: () => void;
  /** Called for scroll actions with the anchorId — parent owns disclosure
   * opening because it knows which <details> wraps the target. */
  onScrollAnchor?: (anchorId: string, fallbackMessage: string) => void;
  /** Optional label override. Defaults to the spec's label. */
  label?: string;
  /** Visual size — sm for inline blocker lists, md for standalone. */
  size?: "sm" | "md";
}

export function BlockerActionLink({
  tenderId,
  actionCode,
  canMutate,
  onDone,
  onScrollAnchor,
  label,
  size = "sm",
}: BlockerActionLinkProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = getRecoveryCommandActionSpec(actionCode);
  if (!spec) return null;

  // Hide mutation actions for users who can't mutate — the frozen/silent
  // disabled-control pattern is exactly what we're eliminating.
  if (isMutationAction(actionCode) && !canMutate) return null;

  const handleClick = async () => {
    if (busy) return; // double-submit prevention
    setError(null);
    setBusy(true);
    try {
      if (spec.kind === "scroll" && spec.anchorId) {
        onScrollAnchor?.(spec.anchorId, spec.message ?? `Open ${spec.label}.`);
        return;
      }
      if (spec.kind === "navigate" && spec.path) {
        router.push(renderRecoveryActionPath(spec.path, tenderId));
        return;
      }
      if (spec.kind === "download" && spec.path) {
        // Use a synthetic anchor so the browser treats it as a download
        // (same pattern as tender-source-files-panel downloadFile).
        const a = document.createElement("a");
        a.href = renderRecoveryActionPath(spec.path, tenderId);
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      if (spec.kind === "refresh") {
        await onDone?.();
        return;
      }
      if (spec.kind === "api" && spec.path) {
        const res = await fetch(renderRecoveryActionPath(spec.path, tenderId), {
          method: spec.method ?? "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(body.error ?? body.message ?? `${spec.label} failed (HTTP ${res.status})`);
        }
        await onDone?.();
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${spec.label} failed`);
    } finally {
      setBusy(false);
    }
  };

  const sizeClasses = size === "sm"
    ? "px-2 py-0.5 text-[11px] gap-1"
    : "px-3 py-1.5 text-xs gap-1.5";

  // Pick an icon based on the action kind. The verb → icon mapping is
  // kept consistent with lib/ui/workflow-action-icons.ts so the visual
  // language matches the rest of the app.
  let Icon = ArrowRightIcon;
  if (spec.kind === "api" && (spec.method === "POST" || spec.method === "DELETE")) Icon = BoltIcon;
  else if (spec.kind === "api" && spec.method === "GET") Icon = DownloadIcon;
  else if (spec.kind === "download") Icon = DownloadIcon;
  else if (spec.kind === "refresh") Icon = RefreshIcon;
  else if (spec.kind === "scroll") Icon = ArrowRightIcon;
  else if (spec.kind === "navigate") Icon = ArrowRightIcon;

  const visibleLabel = label ?? spec.label;
  const titleText = spec.message ?? spec.label;

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={busy}
        aria-busy={busy}
        title={titleText}
        className={`inline-flex items-center rounded border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 ${sizeClasses}`}
      >
        {busy ? <ClockIcon /> : <Icon />}
        {busy ? "Working…" : visibleLabel}
      </button>
      {error && (
        <span role="alert" className="text-[10px] font-medium text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
