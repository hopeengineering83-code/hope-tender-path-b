"use client";

import { useEffect, useState } from "react";
import type { TenderReleaseSnapshot } from "../lib/engine/tender-release-snapshot";

/**
 * SnapshotConsistencyBadge — additive "honest UI" overlay.
 *
 * Reads the authoritative release snapshot (the SAME endpoint the metadata
 * panels consume) and surfaces, for any host panel:
 *   - the snapshot's authoritative eligibility for one verdict, and
 *   - the snapshotRevision token (so every panel can be seen to read the same
 *     generation of truth).
 *
 * It NEVER replaces the host panel's own logic or data. When the host passes
 * its locally-computed verdict via `localEligible`, the badge additionally
 * warns when that local verdict disagrees with the authoritative snapshot —
 * making any silent contradiction visible instead of removing the panel's
 * existing (richer) display.
 *
 * Fail-safe: on any fetch/parse failure it renders nothing, so it can never
 * break or block the panel it is mounted in.
 */

type Verdict = "generation" | "export" | "finalZip";

export function SnapshotConsistencyBadge({
  tenderId,
  verdict,
  localEligible,
  localLabel,
}: {
  tenderId: string;
  verdict: Verdict;
  /** The host panel's own verdict, if it has one — enables the mismatch warning. */
  localEligible?: boolean;
  localLabel?: string;
}) {
  const [snapshot, setSnapshot] = useState<TenderReleaseSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tenders/${tenderId}/workflow-center`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { snapshot?: TenderReleaseSnapshot } | null) => {
        if (!cancelled && j?.snapshot) setSnapshot(j.snapshot);
      })
      .catch(() => {
        /* additive overlay — never break the host panel on fetch failure */
      });
    return () => {
      cancelled = true;
    };
  }, [tenderId]);

  if (!snapshot) return null;

  const eligible =
    verdict === "generation"
      ? snapshot.generationEligible
      : verdict === "export"
        ? snapshot.exportEligible
        : snapshot.finalZipEligible;
  const blockers =
    verdict === "generation"
      ? snapshot.generationBlockers
      : verdict === "export"
        ? snapshot.exportBlockers
        : snapshot.finalZipBlockers;

  const verdictLabel = verdict === "finalZip" ? "final ZIP" : verdict;
  const disagree = localEligible !== undefined && localEligible !== eligible;

  return (
    <div className="mt-2 text-[10px]">
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
          eligible ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}
        title="Authoritative release snapshot (single source of truth)"
      >
        snapshot · {verdictLabel}: {eligible ? "eligible" : "blocked"}
        <span className="ml-1 font-mono text-slate-400">rev {snapshot.snapshotRevision.slice(0, 8)}</span>
      </span>
      {disagree && (
        <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
          ⚠ This panel{localLabel ? ` (${localLabel})` : ""} shows{" "}
          <strong>{localEligible ? "ready" : "blocked"}</strong>, but the authoritative release snapshot shows{" "}
          <strong>{eligible ? "eligible" : "blocked"}</strong>
          {!eligible && blockers.length > 0 ? `: ${blockers[0]}` : ""}. Trust the snapshot and resolve before relying on this panel.
        </p>
      )}
    </div>
  );
}
